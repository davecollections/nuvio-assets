import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import {
  applyProductionBackgroundDecision,
  fallbackBackgroundDecision,
  loadBackgroundDecisionConfiguration,
  mergeBackgroundDecisionReviewReasons,
  MIXED_CONTRAST_REVIEW_REASON,
  STALE_BACKGROUND_DECISION_REASON,
} from "./background-decision.mjs";
import { createContactSheet, createPagedContactSheets, paginateContactSheetItems } from "./contact-sheet.mjs";
import { compareEntities, RENDERER_VERSION } from "./constants.mjs";
import { classifyEligibilityTier, isAutomaticallyEligible } from "./eligibility.mjs";
import { bufferFingerprint, sourceRecordFingerprint } from "./fingerprints.mjs";
import { analyseLogo } from "./image-analysis.mjs";
import { logoCachePath } from "./logo-cache.mjs";
import { validateOutput } from "./output-validation.mjs";
import {
  buildReviewPriority,
  calculateRunStatistics,
  contactSheetIndexMarkdown,
  generationSummaryMarkdown,
  groupRecordsByStatus,
  statusSummaryMarkdown,
} from "./reports.mjs";
import {
  applyReviewReasonResolutions,
  loadReviewReasonResolutionConfiguration,
} from "./review-reason-resolution.mjs";
import { compareProductionSnapshots, snapshotProductionDirectory } from "./staging-snapshot.mjs";

function stateKey(stableKey) {
  return `${stableKey}|primary`;
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertWorkPath(filePath, packageRoot, label) {
  const workRoot = path.join(packageRoot, ".work");
  if (!isWithin(filePath, workRoot)) throw new Error(`${label} must remain under .work: ${filePath}`);
}

async function hashFile(filePath) {
  return bufferFingerprint(await fs.readFile(filePath));
}

async function readState(statePath) {
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  if (!state?.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    throw new Error(`Invalid production run state: ${statePath}`);
  }
  return state;
}

function expectedOutputPath(packageRoot, presetVersion, entity) {
  const folder = entity.entityType === "company" ? "companies" : "networks";
  return path.join(packageRoot, ".work", "staging", presetVersion, folder, `${entity.tmdbId}.webp`);
}

function stableKeyToRelativePath(stableKey) {
  const match = /^(company|network):([1-9]\d*)$/.exec(stableKey);
  if (!match) throw new Error(`Invalid stable key: ${stableKey}`);
  return `${match[1] === "company" ? "companies" : "networks"}/${match[2]}.webp`;
}

function reviewStatusFor(reasons) {
  return reasons.length ? "needs-review" : "unreviewed";
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function writeProductionSnapshot({ packageRoot, presetVersion, outputPath } = {}) {
  assertWorkPath(outputPath, packageRoot, "Production snapshot");
  const stagingRoot = path.join(packageRoot, ".work", "staging", presetVersion);
  const snapshot = await snapshotProductionDirectory(stagingRoot);
  await atomicWriteJson(outputPath, snapshot);
  return snapshot;
}

export async function validateProductionState({ packageRoot, preset } = {}) {
  const reportsRoot = path.join(packageRoot, ".work", "reports", preset.version);
  const state = await readState(path.join(reportsRoot, "run-state.json"));
  const records = Object.entries(state.entries)
    .filter(([key]) => key.endsWith("|primary"))
    .map(([, record]) => record)
    .sort(compareEntities);
  const validations = await mapConcurrent(records, 8, async (record) => {
    const valid = await validateOutput(record.outputPath, preset);
    if (valid.outputHash !== record.outputHash) {
      throw new Error(`Current output hash differs from state for ${record.stableKey}.`);
    }
    return valid;
  });
  const draftPath = path.join(packageRoot, ".work", "reviews", preset.version, "review-state-draft.json");
  const reviewEntries = JSON.parse(await fs.readFile(draftPath, "utf8"));
  const byKey = new Map(records.map((record) => [record.stableKey, record]));
  const reviewHashMismatches = reviewEntries.filter((entry) => byKey.get(entry.stableKey)?.outputHash !== entry.outputHash);
  if (reviewHashMismatches.length) {
    throw new Error(`Review-state hash mismatch for ${reviewHashMismatches.map((entry) => entry.stableKey).join(", ")}.`);
  }
  return {
    total: records.length,
    companies: records.filter((record) => record.entityType === "company").length,
    networks: records.filter((record) => record.entityType === "network").length,
    decoded1200x675WebP: validations.length,
    decisionVersioned: records.filter((record) => record.backgroundDecisionVersion === preset.backgroundDecision?.version).length,
    unresolvedMixedContrast: records.filter((record) => record.reviewReasons?.includes("mixed-contrast-background-review")).length,
    staleBackgroundDecisions: records.filter((record) => record.reviewReasons?.includes("stale-background-decision")).length,
    reviewEntries: reviewEntries.length,
    reviewHashMismatches: 0,
  };
}

export async function reconcileProductionState({
  packageRoot,
  preset,
  sourceData,
  selectivelyRegeneratedKeys = [],
  eligibility,
  now = () => new Date(),
} = {}) {
  if (sourceData.validationErrors?.length) {
    throw new Error(`Cannot reconcile with ${sourceData.validationErrors.length} source validation error(s).`);
  }
  if (!eligibility) throw new Error("Eligibility policy is required for reconciliation.");
  const reportsRoot = path.join(packageRoot, ".work", "reports", preset.version);
  const statePath = path.join(reportsRoot, "run-state.json");
  const stagingRoot = path.join(packageRoot, ".work", "staging", preset.version);
  const state = await readState(statePath);
  const [configuration, reasonConfiguration] = await Promise.all([
    loadBackgroundDecisionConfiguration(packageRoot, preset),
    loadReviewReasonResolutionConfiguration(packageRoot, preset),
  ]);
  const eligible = sourceData.entities
    .filter((entity) => isAutomaticallyEligible(entity, eligibility))
    .sort(compareEntities);
  const primaryKeys = Object.keys(state.entries).filter((key) => key.endsWith("|primary"));
  const eligibleKeySet = new Set(eligible.map((entity) => stateKey(entity.stableKey)));
  const unexpectedStateKeys = primaryKeys.filter((key) => !eligibleKeySet.has(key));
  if (unexpectedStateKeys.length) {
    throw new Error(`Persistent state contains non-current primary records: ${unexpectedStateKeys.slice(0, 12).join(", ")}`);
  }
  const stateKeySet = new Set(primaryKeys);
  const reconciliationEntities = eligible.filter((entity) => stateKeySet.has(stateKey(entity.stableKey)));
  const deferredNewEligible = eligible.filter((entity) => !stateKeySet.has(stateKey(entity.stableKey)));

  const reconciled = await mapConcurrent(reconciliationEntities, 8, async (entity) => {
    const key = stateKey(entity.stableKey);
    const previous = state.entries[key];
    if (!previous) throw new Error(`Persistent state is missing ${entity.stableKey}.`);
    const outputPath = expectedOutputPath(packageRoot, preset.version, entity);
    if (path.resolve(previous.outputPath) !== path.resolve(outputPath)) {
      throw new Error(`Unexpected staged output path for ${entity.stableKey}.`);
    }
    if ((previous.logoPath ?? "") !== entity.logoPath) {
      throw new Error(`Logo path changed for ${entity.stableKey}; artwork regeneration is required.`);
    }
    if (!entity.logoPath && previous.name !== entity.name) {
      throw new Error(`Fallback text changed for ${entity.stableKey}; artwork regeneration is required.`);
    }
    const valid = await validateOutput(outputPath, preset);
    if (valid.outputHash !== previous.outputHash) {
      throw new Error(`Staged output hash differs from persistent state for ${entity.stableKey}.`);
    }

    let selectedBackground = previous.selectedBackground;
    let decisionMetadata;
    let decisionReasons = [];
    if (entity.logoPath) {
      const cachePath = logoCachePath(path.join(packageRoot, ".work", "cache", "logos"), entity.logoPath);
      let cacheBuffer;
      try {
        cacheBuffer = await fs.readFile(cachePath);
      } catch (error) {
        throw new Error(`Offline reconciliation requires cached logo for ${entity.stableKey}: ${error.message}`);
      }
      const sourceHash = bufferFingerprint(cacheBuffer);
      if (sourceHash !== previous.sourceHash) {
        throw new Error(`Cached source hash changed for ${entity.stableKey}; artwork regeneration is required.`);
      }
      const requiresDecisionRefresh = previous.backgroundDecisionVersion !== configuration.version
        || configuration.manualByKey.has(entity.stableKey)
        || configuration.resolutionByKey.has(entity.stableKey);
      if (requiresDecisionRefresh) {
        const analysis = await analyseLogo(cachePath, preset);
        const decision = applyProductionBackgroundDecision(analysis, preset, {
          stableKey: entity.stableKey,
          sourceLogoHash: sourceHash,
          configuration,
        });
        selectedBackground = decision.selectedBackground;
        decisionMetadata = decision.metadata;
        decisionReasons = decision.reviewReasons;
      } else {
        decisionReasons = (previous.reviewReasons ?? []).filter((reason) =>
          reason === MIXED_CONTRAST_REVIEW_REASON || reason === STALE_BACKGROUND_DECISION_REASON,
        );
      }
    } else {
      const decision = fallbackBackgroundDecision(preset);
      selectedBackground = decision.selectedBackground;
      decisionMetadata = decision.metadata;
    }
    if (selectedBackground !== previous.selectedBackground) {
      throw new Error(`Staged background for ${entity.stableKey} is ${previous.selectedBackground}; decision now requires ${selectedBackground}.`);
    }
    const derivedReviewReasons = mergeBackgroundDecisionReviewReasons(previous.reviewReasons, decisionReasons);
    const veryCloseThreshold = preset.contrast?.veryCloseScoreDifference ?? preset.contrast?.closeScoreDifference;
    if (Number.isFinite(previous.contrastConfidence) && previous.contrastConfidence < veryCloseThreshold) {
      derivedReviewReasons.push("very-close-contrast");
    }
    const baseRecord = {
      ...previous,
      ...valid,
      entityType: entity.entityType,
      tmdbId: entity.tmdbId,
      stableKey: entity.stableKey,
      name: entity.name,
      titleCount: entity.titleCount,
      eligibilityTier: classifyEligibilityTier(entity, eligibility),
      logoPath: entity.logoPath,
      sourceRecordHash: sourceRecordFingerprint(entity),
      selectedBackground,
      backgroundPreset: `${selectedBackground}-flat`,
      ...decisionMetadata,
    };
    const reasonResult = applyReviewReasonResolutions(baseRecord, derivedReviewReasons, reasonConfiguration);
    return {
      ...baseRecord,
      reviewReasons: reasonResult.unresolvedReasons,
      reviewStatus: reviewStatusFor(reasonResult.unresolvedReasons),
      reviewReasonResolutionVersion: reasonConfiguration.version,
      resolvedReviewReasons: reasonResult.resolvedReviewReasons,
      reviewReasonResolutionStatuses: reasonResult.reviewReasonResolutionStatuses,
    };
  });
  for (const record of reconciled) state.entries[stateKey(record.stableKey)] = record;

  await atomicWriteJson(statePath, state);
  const contactSheets = await createPagedContactSheets(
    reconciled,
    packageRoot,
    preset.version,
    preset.contactSheets ?? {},
  );
  const statistics = calculateRunStatistics(reconciled, preset);
  const reviewPriority = buildReviewPriority(reconciled, preset);
  const statusGroups = groupRecordsByStatus(reconciled);
  const completedAt = now();
  const summary = {
    runId: `reconciled-${completedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-")}`,
    mode: "reconciled-current-state",
    dryRun: false,
    force: false,
    refreshLogoCache: false,
    offline: true,
    networkRequestsMade: 0,
    presetVersion: preset.version,
    rendererVersion: RENDERER_VERSION,
    backgroundDecisionVersion: configuration.version,
    reviewReasonResolutionVersion: reasonConfiguration.version,
    reviewReasonResolutions: {
      configured: reasonConfiguration.resolutions.length,
      resolved: reconciled.reduce((sum, record) => sum
        + record.reviewReasonResolutionStatuses.filter((item) => item.status === "resolved").length, 0),
      staleOutput: reconciled.reduce((sum, record) => sum + record.reviewReasonResolutionStatuses.filter((item) => item.status === "stale-output").length, 0),
      staleSource: reconciled.reduce((sum, record) => sum + record.reviewReasonResolutionStatuses.filter((item) => item.status === "stale-source").length, 0),
    },
    sourceDirectory: sourceData.sourceDirectory,
    sourceCacheHashes: {
      company: await hashFile(sourceData.sourceFiles.company),
      network: await hashFile(sourceData.sourceFiles.network),
    },
    sourceFileHashes: null,
    ...statistics,
    selectivelyRegenerated: selectivelyRegeneratedKeys.length,
    selectivelyRegeneratedKeys: [...selectivelyRegeneratedKeys],
    metadataOnlyReconciled: reconciled.length - selectivelyRegeneratedKeys.length,
    contactSheets,
    runStartedAt: null,
    runCompletedAt: completedAt.toISOString(),
    runDurationMs: 0,
    issues: {
      malformedKeys: [], unknownKeys: [], ineligibleKeys: [], removedKeys: [], ineligibleManifestKeys: [],
      deferredNewEligibleKeys: deferredNewEligible.map((entity) => entity.stableKey),
    },
    currentEligibleCount: eligible.length,
    deferredNewEligible: deferredNewEligible.map((entity) => ({
      stableKey: entity.stableKey,
      name: entity.name,
      titleCount: entity.titleCount,
      logoPath: entity.logoPath,
    })),
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
  };
  summary.sourceFileHashes = summary.sourceCacheHashes;
  await Promise.all([
    atomicWrite(path.join(reportsRoot, "entities.jsonl"), `${reconciled.map((record) => JSON.stringify(record)).join("\n")}\n`),
    atomicWriteJson(path.join(reportsRoot, "run-summary.json"), summary),
    atomicWrite(path.join(reportsRoot, "summary.md"), generationSummaryMarkdown(summary, reviewPriority)),
    atomicWriteJson(path.join(reportsRoot, "review-priority.json"), reviewPriority),
    atomicWriteJson(path.join(reportsRoot, "status-groups.json"), statusGroups),
    atomicWrite(path.join(reportsRoot, "review-summary.md"), statusSummaryMarkdown(statusGroups)),
    atomicWriteJson(path.join(reportsRoot, "contact-sheet-index.json"), contactSheets),
    atomicWrite(path.join(reportsRoot, "contact-sheet-index.md"), contactSheetIndexMarkdown(contactSheets)),
    atomicWriteJson(path.join(reportsRoot, "background-reconciliation-summary.json"), summary),
  ]);
  return { records: reconciled, summary, configuration, reasonConfiguration };
}

async function createPendingOpaqueVerification({ packageRoot, preset, records, stableKeys, outputDir } = {}) {
  assertWorkPath(outputDir, packageRoot, "Pending opaque verification directory");
  const byKey = new Map(records.map((record) => [record.stableKey, record]));
  const selected = stableKeys.map((stableKey) => {
    const record = byKey.get(stableKey);
    if (!record) throw new Error(`Pending opaque verification record is missing: ${stableKey}.`);
    if (!record.reviewReasons?.includes("unexpectedly-opaque-source-background")) {
      throw new Error(`Pending opaque reason is no longer unresolved for ${stableKey}.`);
    }
    return record;
  });
  const columns = preset.contactSheets?.columns ?? 8;
  const rows = preset.contactSheets?.rows ?? 8;
  const pages = paginateContactSheetItems(selected, { pageSize: columns * rows });
  const pageResults = [];
  for (const [index, pageRecords] of pages.entries()) {
    const outputPath = path.join(outputDir, `page-${String(index + 1).padStart(2, "0")}.png`);
    const labelled = pageRecords.map((record) => ({
      ...record,
      contactSheetLabelLines: [
        record.name,
        record.stableKey,
        `Background: ${record.selectedBackground}`,
        "Pending: unexpectedly-opaque-source-background",
      ],
    }));
    const result = await createContactSheet(labelled, outputPath, {
      ...preset.contactSheets,
      columns,
      labelHeight: Math.max(108, preset.contactSheets?.labelHeight ?? 0),
    });
    pageResults.push({
      ...result,
      pageNumber: index + 1,
      items: pageRecords.map((record) => ({
        stableKey: record.stableKey,
        name: record.name,
        outputHash: record.outputHash,
        sourceLogoHash: record.sourceHash,
      })),
    });
  }
  const index = {
    presetVersion: preset.version,
    reason: "unexpectedly-opaque-source-background",
    status: "pending",
    count: selected.length,
    pages: pageResults,
    artworkChanged: false,
  };
  const markdown = `# Eligibility-50 pending opaque-source review

- Pending records: ${selected.length}
- Artwork changed: no
- Reason: unexpectedly-opaque-source-background

${pageResults.map((page) => `## Page ${String(page.pageNumber).padStart(2, "0")}

- File: ${path.basename(page.outputPath)}
- Stable keys: ${page.items.map((item) => item.stableKey).join(", ")}`).join("\n\n")}
`;
  await Promise.all([
    atomicWriteJson(path.join(outputDir, "index.json"), index),
    atomicWrite(path.join(outputDir, "index.md"), markdown),
  ]);
  return index;
}

export async function verifySelectiveProductionChange({
  packageRoot,
  preset,
  beforeSnapshotPath,
  afterSnapshotPath,
  summaryPath,
  selectivelyRegeneratedKeys,
  selectivelyAddedKeys = [],
  retainedReviewedKeys,
  records,
  configuration,
  reviewResult,
  verificationSheetPath = null,
  pendingOpaqueKeys = [],
  pendingOpaqueOutputDir = null,
  expectedPendingOpaqueCount = null,
} = {}) {
  for (const [label, filePath] of [["After snapshot", afterSnapshotPath], ["Verification summary", summaryPath]]) {
    assertWorkPath(filePath, packageRoot, label);
  }
  const before = JSON.parse(await fs.readFile(beforeSnapshotPath, "utf8"));
  const after = await snapshotProductionDirectory(path.join(packageRoot, ".work", "staging", preset.version));
  const comparison = compareProductionSnapshots(before, after);
  const expectedChangedPaths = new Set(
    [...selectivelyRegeneratedKeys, ...selectivelyAddedKeys].map(stableKeyToRelativePath),
  );
  const actualChangedPaths = new Set(comparison.changed.map((entry) => entry.path));
  const missingChanges = [...expectedChangedPaths].filter((filePath) => !actualChangedPaths.has(filePath));
  const unexpectedChanges = [...actualChangedPaths].filter((filePath) => !expectedChangedPaths.has(filePath));
  const incompleteChanges = comparison.changed.filter((entry) =>
    expectedChangedPaths.has(entry.path) && (!entry.contentChanged || !entry.mtimeChanged),
  );
  if (missingChanges.length || unexpectedChanges.length || incompleteChanges.length) {
    throw new Error([
      missingChanges.length ? `Expected changes missing: ${missingChanges.join(", ")}` : null,
      unexpectedChanges.length ? `Unexpected staged changes: ${unexpectedChanges.join(", ")}` : null,
      incompleteChanges.length ? `Expected content and mtime changes were incomplete: ${incompleteChanges.map((entry) => entry.path).join(", ")}` : null,
    ].filter(Boolean).join("; "));
  }
  const retainedPaths = new Set(retainedReviewedKeys.map(stableKeyToRelativePath));
  const retainedTouched = comparison.changed.filter((entry) => retainedPaths.has(entry.path));
  if (retainedTouched.length) {
    throw new Error(`Retained reviewed outputs changed unexpectedly: ${retainedTouched.map((entry) => entry.path).join(", ")}`);
  }
  if (expectedPendingOpaqueCount !== null && pendingOpaqueKeys.length !== expectedPendingOpaqueCount) {
    throw new Error(`Expected ${expectedPendingOpaqueCount} pending opaque keys, received ${pendingOpaqueKeys.length}.`);
  }
  const pendingOpaquePaths = new Set(pendingOpaqueKeys.map(stableKeyToRelativePath));
  const pendingOpaqueTouched = comparison.changed.filter((entry) => pendingOpaquePaths.has(entry.path));
  if (pendingOpaqueTouched.length) {
    throw new Error(`Pending opaque outputs changed unexpectedly: ${pendingOpaqueTouched.map((entry) => entry.path).join(", ")}`);
  }

  const byKey = new Map(records.map((record) => [record.stableKey, record]));
  const addedRecords = selectivelyAddedKeys.map((stableKey) => {
    const record = byKey.get(stableKey);
    if (!record) throw new Error(`Reconciled state is missing newly added record ${stableKey}.`);
    const changed = comparison.changed.find((entry) => entry.path === stableKeyToRelativePath(stableKey));
    if (!changed || changed.before !== null || changed.after === null) {
      throw new Error(`Newly added record ${stableKey} was not absent before and present after.`);
    }
    return {
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.name,
      finalBackground: record.selectedBackground,
      decisionSource: record.backgroundDecisionSource,
      regenerated: false,
      added: true,
      outputHash: record.outputHash,
      remainingReviewReasons: record.reviewReasons ?? [],
      outputPath: record.outputPath,
    };
  });
  const reviewedKeys = [...selectivelyRegeneratedKeys, ...retainedReviewedKeys];
  const finalDecisions = reviewedKeys.map((stableKey) => {
    const resolution = configuration.resolutionByKey.get(stableKey);
    if (!resolution) throw new Error(`Background review resolution is missing for ${stableKey}.`);
    const record = byKey.get(stableKey);
    if (!record) throw new Error(`Reconciled state is missing reviewed record ${stableKey}.`);
    if (record.selectedBackground !== resolution.backgroundPreset) {
      throw new Error(`Final background mismatch for ${resolution.stableKey}: expected ${resolution.backgroundPreset}, received ${record.selectedBackground}.`);
    }
    if (record.mixedContrastReviewResolution?.status !== "resolved") {
      throw new Error(`Mixed-contrast review is not resolved for ${resolution.stableKey}.`);
    }
    const regenerated = expectedChangedPaths.has(stableKeyToRelativePath(record.stableKey));
    return {
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.name,
      finalBackground: record.selectedBackground,
      decisionSource: record.backgroundDecisionSource,
      regenerated,
      outputHash: record.outputHash,
      remainingReviewReasons: record.reviewReasons ?? [],
      outputPath: record.outputPath,
    };
  });
  const sheetPath = verificationSheetPath
    ?? path.join(packageRoot, ".work", "contact-sheets", preset.version, "review", "mixed-contrast-approved.png");
  assertWorkPath(sheetPath, packageRoot, "Contrast verification sheet");
  const labelled = [...finalDecisions, ...addedRecords].map((record) => ({
    ...record,
    contactSheetLabelLines: [
      record.name,
      `${record.stableKey} · ${record.finalBackground}`,
      `${record.decisionSource} · ${record.added ? "newly added" : record.regenerated ? "regenerated" : "retained"}`,
      `Remaining: ${record.remainingReviewReasons.length ? record.remainingReviewReasons.join(", ") : "none"}`,
    ],
  }));
  const sheet = await createContactSheet(labelled, sheetPath, {
    columns: 4,
    thumbnailWidth: 300,
    thumbnailHeight: 169,
    labelHeight: 108,
    gap: 16,
    margin: 40,
  });
  const pendingOpaque = pendingOpaqueOutputDir
    ? await createPendingOpaqueVerification({
      packageRoot,
      preset,
      records,
      stableKeys: pendingOpaqueKeys,
      outputDir: pendingOpaqueOutputDir,
    })
    : null;
  const summary = {
    presetVersion: preset.version,
    backgroundDecisionVersion: configuration.version,
    before: {
      count: before.count,
      combinedFingerprint: before.combinedFingerprint,
      mtimeFingerprint: before.mtimeFingerprint,
    },
    after: {
      count: after.count,
      combinedFingerprint: after.combinedFingerprint,
      mtimeFingerprint: after.mtimeFingerprint,
    },
    selectivelyRegeneratedCount: selectivelyRegeneratedKeys.length,
    selectivelyRegeneratedKeys,
    selectivelyAddedCount: selectivelyAddedKeys.length,
    selectivelyAddedKeys,
    retainedReviewedCount: retainedReviewedKeys.length,
    retainedReviewedKeys,
    unchangedOutputCount: comparison.unchanged.length,
    changedFiles: comparison.changed,
    addedRecords,
    finalDecisions,
    review: reviewResult,
    verificationSheet: sheet,
    pendingOpaque,
    fullBatchRegenerated: false,
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
    networkRequestsMade: 0,
  };
  await Promise.all([
    atomicWriteJson(afterSnapshotPath, after),
    atomicWriteJson(summaryPath, summary),
  ]);
  return summary;
}

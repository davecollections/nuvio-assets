import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import {
  applyProductionBackgroundDecision,
  fallbackBackgroundDecision,
  loadBackgroundDecisionConfiguration,
  mergeBackgroundDecisionReviewReasons,
} from "./background-decision.mjs";
import { createContactSheet, createPagedContactSheets } from "./contact-sheet.mjs";
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

function reviewStatusFor(record, reasons) {
  if ((record.renderStatus ?? record.status) === "missing-logo") return "needs-review";
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
  const configuration = await loadBackgroundDecisionConfiguration(packageRoot, preset);
  const eligible = sourceData.entities
    .filter((entity) => isAutomaticallyEligible(entity, eligibility))
    .sort(compareEntities);
  const primaryKeys = Object.keys(state.entries).filter((key) => key.endsWith("|primary"));
  if (primaryKeys.length !== eligible.length) {
    throw new Error(`Persistent state has ${primaryKeys.length} primary records; current eligibility has ${eligible.length}.`);
  }
  const eligibleKeySet = new Set(eligible.map((entity) => stateKey(entity.stableKey)));
  const unexpectedStateKeys = primaryKeys.filter((key) => !eligibleKeySet.has(key));
  if (unexpectedStateKeys.length) {
    throw new Error(`Persistent state contains non-current primary records: ${unexpectedStateKeys.slice(0, 12).join(", ")}`);
  }

  const reconciled = await mapConcurrent(eligible, 8, async (entity) => {
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
      const decision = fallbackBackgroundDecision(preset);
      selectedBackground = decision.selectedBackground;
      decisionMetadata = decision.metadata;
    }
    if (selectedBackground !== previous.selectedBackground) {
      throw new Error(`Staged background for ${entity.stableKey} is ${previous.selectedBackground}; decision now requires ${selectedBackground}.`);
    }
    const reviewReasons = mergeBackgroundDecisionReviewReasons(previous.reviewReasons, decisionReasons);
    const record = {
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
      reviewReasons,
      reviewStatus: reviewStatusFor(previous, reviewReasons),
      ...decisionMetadata,
    };
    return record;
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
    },
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
  return { records: reconciled, summary, configuration };
}

export async function verifySelectiveProductionChange({
  packageRoot,
  preset,
  beforeSnapshotPath,
  afterSnapshotPath,
  summaryPath,
  selectivelyRegeneratedKeys,
  retainedReviewedKeys,
  records,
  configuration,
  reviewResult,
} = {}) {
  for (const [label, filePath] of [["After snapshot", afterSnapshotPath], ["Verification summary", summaryPath]]) {
    assertWorkPath(filePath, packageRoot, label);
  }
  const before = JSON.parse(await fs.readFile(beforeSnapshotPath, "utf8"));
  const after = await snapshotProductionDirectory(path.join(packageRoot, ".work", "staging", preset.version));
  const comparison = compareProductionSnapshots(before, after);
  const expectedChangedPaths = new Set(selectivelyRegeneratedKeys.map(stableKeyToRelativePath));
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
    throw new Error(`Approved-dark outputs changed unexpectedly: ${retainedTouched.map((entry) => entry.path).join(", ")}`);
  }

  const byKey = new Map(records.map((record) => [record.stableKey, record]));
  const finalDecisions = configuration.reviewResolutions.map((resolution) => {
    const record = byKey.get(resolution.stableKey);
    if (!record) throw new Error(`Reconciled state is missing reviewed record ${resolution.stableKey}.`);
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
  const sheetPath = path.join(packageRoot, ".work", "contact-sheets", preset.version, "review", "mixed-contrast-approved.png");
  const labelled = finalDecisions.map((record) => ({
    ...record,
    contactSheetLabelLines: [
      record.name,
      `${record.stableKey} · ${record.finalBackground}`,
      `${record.decisionSource} · ${record.regenerated ? "regenerated" : "retained"}`,
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
    retainedReviewedCount: retainedReviewedKeys.length,
    retainedReviewedKeys,
    unchangedOutputCount: comparison.unchanged.length,
    changedFiles: comparison.changed,
    finalDecisions,
    review: reviewResult,
    verificationSheet: sheet,
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

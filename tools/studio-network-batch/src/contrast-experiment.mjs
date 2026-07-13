import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { createContactSheet } from "./contact-sheet.mjs";
import { analyseLogo } from "./image-analysis.mjs";
import { loadSourceData } from "./load-source.mjs";
import { logoCachePath } from "./logo-cache.mjs";
import {
  applyMixedContrastRule,
  calculateMixedContrastMetrics,
  compareStableKeys,
  experimentRenderPath,
  summariseProjectedImpact,
} from "./mixed-contrast.mjs";
import { renderLogoCover, writeRenderedOutput } from "./render.mjs";
import { resolveSourceDirectory } from "./source-path.mjs";
import { snapshotProductionDirectory } from "./staging-snapshot.mjs";

const VARIANTS = ["current", "forced-dark", "forced-light", "proposed-rule"];

export { snapshotProductionDirectory } from "./staging-snapshot.mjs";

function currentStateMap(state) {
  return new Map(Object.values(state.entries ?? {})
    .filter((entry) => entry.variantName === "primary")
    .map((entry) => [entry.stableKey, entry]));
}

function hasCurrentCloseFlag(record, preset) {
  return record.reviewReasons?.includes("close-background-scores") ||
    (Number.isFinite(record.contrastConfidence) && record.contrastConfidence < preset.contrast.closeScoreDifference);
}

function hasCurrentVeryCloseFlag(record, preset) {
  const threshold = preset.contrast.veryCloseScoreDifference ?? preset.contrast.closeScoreDifference;
  return Number.isFinite(record.contrastConfidence) && record.contrastConfidence < threshold;
}

function strength(record) {
  const current = record.metrics[record.currentSelectedBackground];
  const alternative = record.metrics[record.currentSelectedBackground === "dark" ? "light" : "dark"];
  return (current.below2 - alternative.below2) * 100 + current.below2 * 25 -
    Math.max(0, current.atOrAbove3 - alternative.atOrAbove3) * 20;
}

function ruleSummary(rule, records, candidateKeys, controlKeys, preset) {
  const resultFor = (record) => record.ruleDecisions[rule.id];
  const candidates = records.filter((record) => candidateKeys.has(record.stableKey));
  const controls = records.filter((record) => controlKeys.has(record.stableKey));
  const impacted = records.filter((record) => resultFor(record).decision !== "unchanged");
  const switches = impacted.filter((record) => resultFor(record).decision === "switch");
  const projected = records.map((record) => ({
    ...record,
    proposedDecision: resultFor(record).decision,
    proposedSelectedBackground: resultFor(record).selectedBackground,
  }));
  return {
    id: rule.id,
    type: rule.type,
    thresholds: Object.fromEntries(Object.entries(rule).filter(([key]) => !["id", "type"].includes(key))),
    candidateCorrectionCount: candidates.filter((record) => resultFor(record).decision === "switch" && resultFor(record).selectedBackground === "light").length,
    candidateSuggestedLightCount: candidates.filter((record) => resultFor(record).selectedBackground === "light").length,
    candidateReviewOnlyCount: candidates.filter((record) => resultFor(record).decision === "review-only").length,
    controlChangeCount: controls.filter((record) => resultFor(record).decision !== "unchanged").length,
    controlFalsePositiveCount: controls.filter((record) => resultFor(record).decision !== "unchanged").length,
    fullBatchEstimatedBackgroundFlips: switches.length,
    fullBatchNewlyFlaggedCount: impacted.filter((record) => !record.currentNeedsReview).length,
    overlapWithCurrentCloseContrast: impacted.filter((record) => hasCurrentCloseFlag(record.currentState, preset)).length,
    overlapWithCurrentVeryCloseContrast: impacted.filter((record) => hasCurrentVeryCloseFlag(record.currentState, preset)).length,
    projectedImpact: summariseProjectedImpact(projected),
    questionableNewFlips: switches
      .filter((record) => !candidateKeys.has(record.stableKey))
      .sort((left, right) => strength(right) - strength(left) || compareStableKeys(left, right))
      .slice(0, 8)
      .map((record) => ({ stableKey: record.stableKey, name: record.name, from: record.currentSelectedBackground, to: resultFor(record).selectedBackground })),
  };
}

function rounded(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function serialisableMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([background, values]) => [background,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "number" ? rounded(value, 6) : value])),
  ]));
}

function labelLines(record, variant, background, proposed) {
  const metrics = record.metrics[background];
  return [
    record.name,
    `${record.stableKey} · ${variant}`,
    `${background} · agg ${metrics.aggregateScore.toFixed(2)} · p10 ${metrics.p10.toFixed(2)}`,
    `>=3 ${Math.round(metrics.atOrAbove3 * 100)}% · proposed ${proposed.selectedBackground}${proposed.decision === "review-only" ? " review" : ""}`,
  ];
}

async function renderComparison(record, analysis, preset, packageRoot, group, proposed) {
  const backgrounds = {
    current: record.currentSelectedBackground,
    "forced-dark": "dark",
    "forced-light": "light",
    "proposed-rule": proposed.selectedBackground,
  };
  const items = [];
  for (const variant of VARIANTS) {
    const selectedBackground = backgrounds[variant];
    const outputPath = experimentRenderPath(packageRoot, group, record.stableKey, variant);
    const rendered = await renderLogoCover(analysis, preset, { selectedBackground });
    await writeRenderedOutput(outputPath, rendered.buffer);
    items.push({
      ...record,
      variantName: variant,
      outputPath,
      selectedBackground,
      backgroundPreset: `${selectedBackground}-flat`,
      renderStatus: "experimental",
      contactSheetLabelLines: labelLines(record, variant, selectedBackground, proposed),
    });
  }
  return items;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function ruleCsv(ruleSummaries) {
  const fields = [
    "id", "type", "candidateCorrectionCount", "candidateReviewOnlyCount", "controlChangeCount",
    "controlFalsePositiveCount", "fullBatchEstimatedBackgroundFlips", "fullBatchNewlyFlaggedCount",
    "overlapWithCurrentCloseContrast", "overlapWithCurrentVeryCloseContrast", "unchanged",
    "switchDarkToLight", "switchLightToDark", "reviewOnly", "thresholds",
  ];
  const rows = ruleSummaries.map((summary) => ({ ...summary, ...summary.projectedImpact, thresholds: JSON.stringify(summary.thresholds) }));
  return `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")).join("\n")}\n`;
}

function summaryMarkdown(summary) {
  const impact = summary.fullBatchImpact;
  return `# Mixed-contrast experiment v1

- Analysed: ${impact.totalLogoBearing} logo-bearing records (${summary.population.companyLogoBearing} companies; ${summary.population.networkLogoBearing} networks)
- Known candidates: ${summary.candidates.length}; controls: ${summary.controls.length}
- Recommended rule: \`${summary.recommendedRule.id}\`
- Known candidates corrected: ${summary.recommendedRule.candidateCorrectionCount}/${summary.candidates.length}
- Control changes / false positives: ${summary.recommendedRule.controlChangeCount}/${summary.recommendedRule.controlFalsePositiveCount}
- Projected: ${impact.unchanged} unchanged; ${impact.switchDarkToLight} dark→light; ${impact.switchLightToDark} light→dark; ${impact.reviewOnly} review-only
- Production staging fingerprint unchanged: ${summary.productionVerification.hashesUnchanged}
- Production staging modification times unchanged: ${summary.productionVerification.mtimesUnchanged}
- Final assets written: no

## Recommendation

${summary.recommendation}

## Limitations

${summary.limitations.map((item) => `- ${item}`).join("\n")}

## Exact next step

${summary.exactNextStep}
`;
}

export async function runContrastExperiment({ packageRoot, repoRoot, presetName = "production-v1", sourceDir, reuseAnalysis = false } = {}) {
  if (!packageRoot || !repoRoot) throw new Error("packageRoot and repoRoot are required.");
  const definitionPath = path.join(packageRoot, "presets", "mixed-contrast-v1.json");
  const presetPath = path.join(packageRoot, "presets", `${presetName}.json`);
  const [definition, preset, state] = await Promise.all([
    fs.readFile(definitionPath, "utf8").then(JSON.parse),
    fs.readFile(presetPath, "utf8").then(JSON.parse),
    fs.readFile(path.join(packageRoot, ".work", "reports", presetName, "run-state.json"), "utf8").then(JSON.parse),
  ]);
  if (definition.productionPreset !== preset.version) {
    throw new Error(`Experiment ${definition.version} requires ${definition.productionPreset}, not ${preset.version}.`);
  }
  const ruleById = new Map(definition.rules.map((rule) => [rule.id, rule]));
  const recommendedRule = ruleById.get(definition.recommendedRule);
  if (!recommendedRule) throw new Error(`Unknown recommended rule: ${definition.recommendedRule}`);

  const source = resolveSourceDirectory({ sourceDir, repoRoot });
  const sourceData = await loadSourceData(source.directory);
  const currentMap = currentStateMap(state);
  const eligible = sourceData.entities.filter((entity) => currentMap.has(entity.stableKey));
  const logoBearing = eligible.filter((entity) => entity.logoPath).sort(compareStableKeys);
  const candidateKeys = new Set(definition.candidates);
  const controlDefinitions = new Map(definition.controls.map((control) => [control.stableKey, control]));
  const controlKeys = new Set(controlDefinitions.keys());
  const focusKeys = new Set([...candidateKeys, ...controlKeys]);
  const allKeys = new Set(logoBearing.map((entity) => entity.stableKey));
  const missingFocus = [...focusKeys].filter((stableKey) => !allKeys.has(stableKey));
  if (missingFocus.length) throw new Error(`Configured focus records are absent, ineligible, or missing logos: ${missingFocus.join(", ")}`);

  const cacheDirectory = path.join(packageRoot, ".work", "cache", "logos");
  const cachePaths = new Map(logoBearing.map((entity) => [entity.stableKey, logoCachePath(cacheDirectory, entity.logoPath)]));
  const missingCache = [];
  for (const entity of logoBearing) {
    try { await fs.access(cachePaths.get(entity.stableKey)); }
    catch { missingCache.push(entity.stableKey); }
  }
  if (missingCache.length) {
    throw new Error(`Offline experiment stopped: ${missingCache.length} expected cached logos are absent (${missingCache.slice(0, 12).join(", ")}).`);
  }

  let reusedAnalysis = new Map();
  if (reuseAnalysis) {
    const reusePath = path.join(packageRoot, ".work", "experiments", "mixed-contrast-v1", "reports", "entities.jsonl");
    const lines = (await fs.readFile(reusePath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    reusedAnalysis = new Map(lines.map((record) => [record.stableKey, record]));
    if (reusedAnalysis.size !== logoBearing.length) {
      throw new Error(`Cannot reuse analysis: expected ${logoBearing.length} records but found ${reusedAnalysis.size}.`);
    }
  }

  const productionDirectory = path.join(packageRoot, ".work", "staging", preset.version);
  const productionBefore = await snapshotProductionDirectory(productionDirectory);
  const records = [];
  const candidateItems = [];
  const controlItems = [];
  const projectedItems = [];
  const resolvedInputs = [];
  let recomputedAnalysisCount = 0;

  for (const entity of logoBearing) {
    const currentState = currentMap.get(entity.stableKey);
    if (!currentState) throw new Error(`Persistent production state is missing ${entity.stableKey}.`);
    const cachePath = cachePaths.get(entity.stableKey);
    const reused = reusedAnalysis.get(entity.stableKey);
    if (reused && (reused.sourceHash !== currentState.sourceHash || reused.logoPath !== entity.logoPath ||
      reused.alphaThreshold !== preset.logo.visibleAlphaThreshold)) {
      throw new Error(`Cannot reuse stale analysis for ${entity.stableKey}.`);
    }
    let analysis = !reused || focusKeys.has(entity.stableKey) ? await analyseLogo(cachePath, preset) : null;
    if (analysis) recomputedAnalysisCount += 1;
    let metrics = analysis ? calculateMixedContrastMetrics(analysis, preset) : reused.metrics;
    let calculatedCurrent = metrics.dark.aggregateScore >= metrics.light.aggregateScore ? "dark" : "light";
    if (calculatedCurrent !== currentState.selectedBackground) {
      throw new Error(`Current background mismatch for ${entity.stableKey}: state=${currentState.selectedBackground}, calculated=${calculatedCurrent}.`);
    }
    let ruleDecisions = Object.fromEntries(definition.rules.map((rule) => [
      rule.id,
      applyMixedContrastRule(metrics, calculatedCurrent, rule, { unexpectedlyOpaque: currentState.reviewReasons?.includes("unexpectedly-opaque-source-background") }),
    ]));
    let proposed = ruleDecisions[recommendedRule.id];
    if (!analysis && proposed.decision !== "unchanged" && !candidateKeys.has(entity.stableKey)) {
      analysis = await analyseLogo(cachePath, preset);
      recomputedAnalysisCount += 1;
      metrics = calculateMixedContrastMetrics(analysis, preset);
      calculatedCurrent = metrics.dark.aggregateScore >= metrics.light.aggregateScore ? "dark" : "light";
      ruleDecisions = Object.fromEntries(definition.rules.map((rule) => [
        rule.id,
        applyMixedContrastRule(metrics, calculatedCurrent, rule, { unexpectedlyOpaque: currentState.reviewReasons?.includes("unexpectedly-opaque-source-background") }),
      ]));
      proposed = ruleDecisions[recommendedRule.id];
    }
    const record = {
      stableKey: entity.stableKey,
      entityType: entity.entityType,
      tmdbId: entity.tmdbId,
      name: entity.name,
      titleCount: entity.titleCount,
      logoPath: entity.logoPath,
      cachePath,
      sourceHash: currentState.sourceHash,
      normalisedPixelHash: analysis?.normalisedPixelHash ?? reused.normalisedPixelHash,
      sourceDimensions: analysis
        ? { width: analysis.sourceWidth, height: analysis.sourceHeight }
        : reused.sourceDimensions,
      visibleDimensions: analysis
        ? { width: analysis.visibleWidth, height: analysis.visibleHeight }
        : reused.visibleDimensions,
      visiblePixelCount: analysis?.visiblePixelCount ?? reused.visiblePixelCount,
      alphaThreshold: preset.logo.visibleAlphaThreshold,
      currentSelectedBackground: calculatedCurrent,
      currentAggregateScore: metrics[calculatedCurrent].aggregateScore,
      currentNeedsReview: currentState.reviewStatus === "needs-review",
      currentReviewReasons: currentState.reviewReasons ?? [],
      proposedDecision: proposed.decision,
      proposedSelectedBackground: proposed.selectedBackground,
      proposedReason: proposed.reason,
      metrics: serialisableMetrics(metrics),
      ruleDecisions,
      currentState,
    };
    records.push(record);
    if (focusKeys.has(entity.stableKey)) {
      resolvedInputs.push({
        stableKey: entity.stableKey,
        name: entity.name,
        logoPath: entity.logoPath,
        cachePath,
        sourceHash: currentState.sourceHash,
        normalisedPixelHash: analysis.normalisedPixelHash,
        sourceDimensions: record.sourceDimensions,
        visibleDimensions: record.visibleDimensions,
      });
      const group = candidateKeys.has(entity.stableKey) ? "candidates" : "controls";
      const items = await renderComparison(record, analysis, preset, packageRoot, group, proposed);
      (group === "candidates" ? candidateItems : controlItems).push(...items);
    }
    if (proposed.decision !== "unchanged" && !candidateKeys.has(entity.stableKey)) {
      projectedItems.push(...await renderComparison(record, analysis, preset, packageRoot, "projected", proposed));
    }
  }

  const ruleSummaries = definition.rules.map((rule) => ruleSummary(rule, records, candidateKeys, controlKeys, preset));
  const recommendedSummary = ruleSummaries.find((summary) => summary.id === recommendedRule.id);
  const impacted = records.filter((record) => record.proposedDecision !== "unchanged");
  const newlyFlagged = impacted.filter((record) => !record.currentNeedsReview);
  const newlyIdentified = newlyFlagged.filter((record) => !candidateKeys.has(record.stableKey))
    .sort((left, right) => strength(right) - strength(left) || compareStableKeys(left, right));
  const proposedReviewIds = impacted.map((record) => record.stableKey).sort(compareStableKeys);
  const productionAfter = await snapshotProductionDirectory(productionDirectory);
  const productionVerification = {
    fileCountBefore: productionBefore.count,
    fileCountAfter: productionAfter.count,
    combinedFingerprintBefore: productionBefore.combinedFingerprint,
    combinedFingerprintAfter: productionAfter.combinedFingerprint,
    mtimeFingerprintBefore: productionBefore.mtimeFingerprint,
    mtimeFingerprintAfter: productionAfter.mtimeFingerprint,
    hashesUnchanged: productionBefore.combinedFingerprint === productionAfter.combinedFingerprint,
    mtimesUnchanged: productionBefore.mtimeFingerprint === productionAfter.mtimeFingerprint,
  };
  if (!productionVerification.hashesUnchanged || !productionVerification.mtimesUnchanged) {
    throw new Error("Production staging changed during the analysis-only experiment.");
  }

  const experimentRoot = path.join(packageRoot, ".work", "experiments", "mixed-contrast-v1");
  const reportsDirectory = path.join(experimentRoot, "reports");
  const contactSheetsDirectory = path.join(experimentRoot, "contact-sheets");
  const inputsDirectory = path.join(experimentRoot, "inputs");
  const candidateSheet = path.join(contactSheetsDirectory, "candidates.png");
  const controlSheet = path.join(contactSheetsDirectory, "controls.png");
  const projectedSheet = path.join(contactSheetsDirectory, "projected-changes.png");
  const [candidateSheetResult, controlSheetResult, projectedSheetResult] = await Promise.all([
    createContactSheet(candidateItems, candidateSheet, { columns: 4, thumbnailWidth: 300, thumbnailHeight: 169, labelHeight: 96 }),
    createContactSheet(controlItems, controlSheet, { columns: 4, thumbnailWidth: 300, thumbnailHeight: 169, labelHeight: 96 }),
    createContactSheet(projectedItems, projectedSheet, { columns: 4, thumbnailWidth: 300, thumbnailHeight: 169, labelHeight: 96 }),
  ]);
  const candidateResults = records.filter((record) => candidateKeys.has(record.stableKey)).map((record) => ({
    stableKey: record.stableKey,
    name: record.name,
    current: record.currentSelectedBackground,
    proposed: record.proposedSelectedBackground,
    decision: record.proposedDecision,
    dark: record.metrics.dark,
    light: record.metrics.light,
  }));
  const controlResults = records.filter((record) => controlKeys.has(record.stableKey)).map((record) => ({
    stableKey: record.stableKey,
    name: record.name,
    category: controlDefinitions.get(record.stableKey).category,
    selectionReason: controlDefinitions.get(record.stableKey).reason,
    current: record.currentSelectedBackground,
    proposed: record.proposedSelectedBackground,
    decision: record.proposedDecision,
  }));
  const fullBatchImpact = summariseProjectedImpact(records);
  const summary = {
    experimentVersion: definition.version,
    productionPreset: preset.version,
    sourceDirectory: sourceData.sourceDirectory,
    population: {
      eligibleCompanies: eligible.filter((entity) => entity.entityType === "company").length,
      eligibleNetworks: eligible.filter((entity) => entity.entityType === "network").length,
      eligibleTotal: eligible.length,
      companyLogoBearing: logoBearing.filter((entity) => entity.entityType === "company").length,
      networkLogoBearing: logoBearing.filter((entity) => entity.entityType === "network").length,
      logoBearingTotal: logoBearing.length,
      missingLogoTotal: eligible.length - logoBearing.length,
    },
    alphaHandling: `Pixels below alpha ${preset.logo.visibleAlphaThreshold} are excluded; remaining samples are alpha-weighted after compositing against each production background.`,
    candidates: candidateResults,
    controls: controlResults,
    rules: ruleSummaries,
    recommendedRule: recommendedSummary,
    fullBatchImpact,
    currentNeedsReviewOverlap: impacted.filter((record) => record.currentNeedsReview).length,
    newlyFlaggedTotal: newlyFlagged.length,
    newlyIdentifiedMixedContrastCandidates: newlyIdentified.length,
    top25StrongestNewCandidates: newlyIdentified.slice(0, 25).map((record) => ({
      stableKey: record.stableKey,
      name: record.name,
      current: record.currentSelectedBackground,
      proposed: record.proposedSelectedBackground,
      decision: record.proposedDecision,
      strength: rounded(strength(record), 4),
      currentBelow2: record.metrics[record.currentSelectedBackground].below2,
      alternativeBelow2: record.metrics[record.currentSelectedBackground === "dark" ? "light" : "dark"].below2,
    })),
    productionVerification,
    contactSheets: { candidates: candidateSheetResult, controls: controlSheetResult, projectedChanges: projectedSheetResult },
    proposedReviewIdsPath: path.join(reportsDirectory, "proposed-review-ids.json"),
    recommendation: "For a dark-selected logo, detect a mixed component when 40–50% of alpha-weighted visible pixels are below 3:1, dark p10 is at most 1.2, light retains at least 40% at or above 3:1, the 3:1 share falls by no more than 15 percentage points, and light aggregate score is at least 1.8. Auto-switch only when light also reduces the below-1.5 share by at least 20 percentage points, raises p10 to at least 1.16, and the source is not unexpectedly opaque; otherwise require review while presenting light as the proposed comparison. A separate review-only branch catches a 40–50% near-3:1 component with dark p10 from 2.0 through 3.0, no more than 5% below 2:1, no more than a 10-point 3:1-share loss on light, and light aggregate score at least 2.0.",
    limitations: [
      "Pixel metrics cannot identify semantic importance; a small wordmark may matter more than a larger symbol.",
      "The eight known failures establish the target pattern, while the 12 controls reduce but do not eliminate visual-selection bias.",
      "Every projected switch and review-only result still requires focused human review before any production change.",
    ],
    exactNextStep: "Review the candidate and control sheets plus the proposed stable-key list. If accepted, approve the rule explicitly, then implement it in production and selectively regenerate only the affected stable keys before rebuilding review preparation.",
    productionOutputsUntouched: true,
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
    networkRequestsMade: 0,
    analysisReuse: { enabled: reuseAnalysis, reusedRecords: logoBearing.length - recomputedAnalysisCount, recomputedRecords: recomputedAnalysisCount },
  };

  const reportRecords = records.map(({ currentState: _currentState, ...record }) => record);
  await Promise.all([
    atomicWriteJson(path.join(inputsDirectory, "resolved-focus-inputs.json"), resolvedInputs),
    atomicWriteJson(path.join(reportsDirectory, "summary.json"), summary),
    atomicWrite(path.join(reportsDirectory, "entities.jsonl"), `${reportRecords.map((record) => JSON.stringify(record)).join("\n")}\n`),
    atomicWrite(path.join(reportsDirectory, "summary.md"), summaryMarkdown(summary)),
    atomicWrite(path.join(reportsDirectory, "rule-comparison.csv"), ruleCsv(ruleSummaries)),
    atomicWriteJson(path.join(reportsDirectory, "proposed-review-ids.json"), proposedReviewIds),
  ]);
  return summary;
}

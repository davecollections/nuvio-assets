import fs from "node:fs/promises";
import path from "node:path";

import {
  applyMixedContrastRule,
  calculateMixedContrastMetrics,
  compareStableKeys,
} from "./mixed-contrast.mjs";

export const MIXED_CONTRAST_REVIEW_REASON = "mixed-contrast-background-review";
export const STALE_BACKGROUND_DECISION_REASON = "stale-background-decision";
const DECISION_REVIEW_REASONS = new Set([
  MIXED_CONTRAST_REVIEW_REASON,
  STALE_BACKGROUND_DECISION_REASON,
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_KEY_PATTERN = /^(company|network):[1-9]\d*$/;
const BACKGROUNDS = new Set(["dark", "light"]);

function assertWithinPackage(filePath, packageRoot, label) {
  const relative = path.relative(path.resolve(packageRoot), path.resolve(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the package directory: ${filePath}`);
  }
}

function validateEntries(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label} must be a JSON array.`);
  const seen = new Set();
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }
    if (!STABLE_KEY_PATTERN.test(entry.stableKey ?? "")) {
      throw new Error(`${label}[${index}] has an invalid stableKey.`);
    }
    if (seen.has(entry.stableKey)) throw new Error(`${label} contains duplicate stable key ${entry.stableKey}.`);
    if (previous && compareStableKeys(previous, entry.stableKey) >= 0) {
      throw new Error(`${label} must be ordered by entity type and numeric TMDB ID.`);
    }
    if (!BACKGROUNDS.has(entry.backgroundPreset)) {
      throw new Error(`${label}[${index}] has invalid backgroundPreset ${entry.backgroundPreset}.`);
    }
    if (!HASH_PATTERN.test(entry.sourceLogoHash ?? "")) {
      throw new Error(`${label}[${index}] has an invalid sourceLogoHash.`);
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${label}[${index}] requires a non-empty reason.`);
    }
    if (entry.name !== undefined && (typeof entry.name !== "string" || !entry.name.trim())) {
      throw new Error(`${label}[${index}] has an invalid optional name.`);
    }
    seen.add(entry.stableKey);
    previous = entry.stableKey;
  }
  return entries;
}

export function validateBackgroundDecisionConfiguration({ manualDecisions, reviewResolutions } = {}) {
  validateEntries(manualDecisions, "Manual background decisions");
  validateEntries(reviewResolutions, "Background review resolutions");
  return { manualDecisions, reviewResolutions };
}

async function readConfiguredJson(packageRoot, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error(`${label} path is required.`);
  }
  const filePath = path.resolve(packageRoot, relativePath);
  assertWithinPackage(filePath, packageRoot, label);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

export async function loadBackgroundDecisionConfiguration(packageRoot, preset) {
  const settings = preset.backgroundDecision;
  if (!settings) return null;
  if (typeof settings.version !== "string" || !settings.version.trim()) {
    throw new Error("Production backgroundDecision.version is required.");
  }
  const [definition, manualDecisions, reviewResolutions] = await Promise.all([
    readConfiguredJson(packageRoot, settings.ruleDefinition, "background rule definition"),
    readConfiguredJson(packageRoot, settings.manualDecisions, "manual background decisions"),
    readConfiguredJson(packageRoot, settings.reviewResolutions, "background review resolutions"),
  ]);
  const rule = definition.rules?.find((item) => item.id === settings.version);
  if (!rule || definition.recommendedRule !== settings.version) {
    throw new Error(`Background rule ${settings.version} is not the recommended rule in ${settings.ruleDefinition}.`);
  }
  validateBackgroundDecisionConfiguration({ manualDecisions, reviewResolutions });
  return {
    version: settings.version,
    rule,
    manualDecisions,
    reviewResolutions,
    manualByKey: new Map(manualDecisions.map((entry) => [entry.stableKey, entry])),
    resolutionByKey: new Map(reviewResolutions.map((entry) => [entry.stableKey, entry])),
  };
}

function resolutionStatus(resolution, sourceLogoHash, selectedBackground) {
  if (!resolution) return "not-configured";
  if (resolution.sourceLogoHash !== sourceLogoHash) return "stale";
  return resolution.backgroundPreset === selectedBackground ? "resolved" : "background-mismatch";
}

export function mergeBackgroundDecisionReviewReasons(existingReasons, decisionReasons) {
  const retained = (existingReasons ?? []).filter((reason) => !DECISION_REVIEW_REASONS.has(reason));
  return [...new Set([...retained, ...(decisionReasons ?? [])])].sort();
}

export function applyProductionBackgroundDecision(analysis, preset, {
  stableKey,
  sourceLogoHash,
  configuration,
} = {}) {
  if (!configuration) {
    return {
      selectedBackground: analysis.selectedBackground,
      reviewReasons: [],
      metadata: {},
    };
  }
  if (!STABLE_KEY_PATTERN.test(stableKey ?? "")) throw new Error(`Invalid stable key: ${stableKey}`);
  if (!HASH_PATTERN.test(sourceLogoHash ?? "")) throw new Error(`Invalid source logo hash for ${stableKey}.`);

  const aggregateBackground = analysis.selectedBackground;
  const metrics = calculateMixedContrastMetrics(analysis, preset);
  const automatic = applyMixedContrastRule(metrics, aggregateBackground, configuration.rule, {
    unexpectedlyOpaque: analysis.unexpectedlyOpaqueBackground,
  });
  const manual = configuration.manualByKey.get(stableKey);
  const manualStatus = !manual
    ? "not-configured"
    : manual.sourceLogoHash === sourceLogoHash
      ? "applied"
      : "stale";

  let selectedBackground = aggregateBackground;
  let decisionSource = "existing-aggregate";
  let decisionReason = automatic.decision === "review-only"
    ? automatic.reason
    : "aggregate-background-selection";
  if (manualStatus === "applied") {
    selectedBackground = manual.backgroundPreset;
    decisionSource = "manual-hash-bound";
    decisionReason = manual.reason;
  } else if (automatic.decision === "switch") {
    selectedBackground = automatic.selectedBackground;
    decisionSource = configuration.version;
    decisionReason = automatic.reason;
  }

  const resolution = configuration.resolutionByKey.get(stableKey);
  const reviewResolutionStatus = resolutionStatus(resolution, sourceLogoHash, selectedBackground);
  const reviewReasons = [];
  if (manualStatus === "stale" || reviewResolutionStatus === "stale") {
    reviewReasons.push(STALE_BACKGROUND_DECISION_REASON);
  }
  if (automatic.decision !== "unchanged" && reviewResolutionStatus !== "resolved") {
    reviewReasons.push(MIXED_CONTRAST_REVIEW_REASON);
  }
  if (reviewResolutionStatus === "background-mismatch") {
    reviewReasons.push(MIXED_CONTRAST_REVIEW_REASON);
  }

  return {
    selectedBackground,
    reviewReasons: [...new Set(reviewReasons)].sort(),
    metadata: {
      backgroundDecisionVersion: configuration.version,
      backgroundDecisionSource: decisionSource,
      backgroundDecisionReason: decisionReason,
      backgroundDecisionSourceLogoHash: sourceLogoHash,
      aggregateSelectedBackground: aggregateBackground,
      automaticBackgroundDecision: {
        decision: automatic.decision,
        selectedBackground: automatic.selectedBackground,
        ruleId: automatic.ruleId,
        reason: automatic.reason,
      },
      manualBackgroundDecision: {
        status: manualStatus,
        configuredBackground: manual?.backgroundPreset ?? null,
        configuredSourceLogoHash: manual?.sourceLogoHash ?? null,
      },
      mixedContrastReviewResolution: {
        status: reviewResolutionStatus,
        approvedBackground: resolution?.backgroundPreset ?? null,
        configuredSourceLogoHash: resolution?.sourceLogoHash ?? null,
      },
      mixedContrastMetrics: metrics,
    },
  };
}

export function fallbackBackgroundDecision(preset) {
  if (!preset.backgroundDecision) return { selectedBackground: preset.fallbackText?.selectedBackground ?? "dark", metadata: {} };
  const selectedBackground = preset.fallbackText?.selectedBackground ?? "dark";
  return {
    selectedBackground,
    metadata: {
      backgroundDecisionVersion: preset.backgroundDecision.version,
      backgroundDecisionSource: "existing-aggregate",
      backgroundDecisionReason: "missing-logo-fallback-config",
      backgroundDecisionSourceLogoHash: null,
      aggregateSelectedBackground: selectedBackground,
      automaticBackgroundDecision: null,
      manualBackgroundDecision: { status: "not-applicable", configuredBackground: null, configuredSourceLogoHash: null },
      mixedContrastReviewResolution: { status: "not-applicable", approvedBackground: null, configuredSourceLogoHash: null },
      mixedContrastMetrics: null,
    },
  };
}

import { compareEntities, outputPathFor } from "./constants.mjs";
import {
  classifyEligibilityTier,
  eligibilityRuleSummary,
  isAutomaticallyEligible,
} from "./eligibility.mjs";
import { artworkInputFingerprint, sourceRecordFingerprint } from "./fingerprints.mjs";
import { compareManifestEntry } from "./manifest.mjs";

export function parseStableKey(value) {
  const match = /^(company|network):([1-9]\d*)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { entityType: match[1], tmdbId: Number(match[2]), stableKey: value };
}

function inspectManifest(manifest, byKey, eligibility) {
  const removedKeys = [];
  const ineligibleManifestKeys = [];
  for (const stableKey of manifest.keys()) {
    const entity = byKey.get(stableKey);
    if (!entity) removedKeys.push(stableKey);
    else if (!isAutomaticallyEligible(entity, eligibility)) ineligibleManifestKeys.push(stableKey);
  }
  return { removedKeys: removedKeys.sort(), ineligibleManifestKeys: ineligibleManifestKeys.sort() };
}

export function buildSelectionPlan({
  entities,
  validationErrors = [],
  mode,
  requestedKeys = [],
  proofKeys = [],
  manifest = new Map(),
  manifestProvided = false,
  includeIneligible = false,
  force = false,
  dryRun = true,
  rendererVersion,
  presetVersion,
  repoRoot,
  eligibility,
  stateDelta,
} = {}) {
  if (validationErrors.length) {
    throw new Error(`Cannot plan with ${validationErrors.length} source validation error(s); run audit.`);
  }
  if (!eligibility) throw new Error("Eligibility policy is required for selection planning.");
  const allowedModes = new Set(["all", "explicit", "proof-of-concept", "new", "changed", "new-from-state"]);
  if (!allowedModes.has(mode)) throw new Error("An explicit selection mode is required.");
  if (mode === "changed" && !manifestProvided) {
    throw new Error("--changed requires --manifest so changes have a comparison baseline.");
  }

  const ordered = [...entities].sort(compareEntities);
  const byKey = new Map(ordered.map((entity) => [entity.stableKey, entity]));
  const eligible = ordered.filter((entity) => isAutomaticallyEligible(entity, eligibility));
  const issues = {
    malformedKeys: [],
    unknownKeys: [],
    ineligibleKeys: [],
    ...inspectManifest(manifest, byKey, eligibility),
    existingOutputIssues: stateDelta?.existingOutputIssues?.map((item) => item.stableKey) ?? [],
    changedLogoPathKeys: stateDelta?.changedLogoPaths?.map((item) => item.stableKey) ?? [],
    changedSourceHashKeys: stateDelta?.changedSourceHashes?.map((item) => item.stableKey) ?? [],
    noLongerAutomaticallyEligibleKeys: stateDelta?.noLongerAutomaticallyEligible?.map((item) => item.stableKey) ?? [],
    disappearedFromSourceKeys: stateDelta?.disappearedFromSource?.map((item) => item.stableKey) ?? [],
    sourceHashUnavailableKeys: stateDelta?.sourceHashUnavailable?.map((item) => item.stableKey) ?? [],
  };
  const notes = [];
  let candidates = [];
  const reasonsByKey = new Map();

  if (mode === "all") {
    candidates = eligible;
    for (const entity of candidates) reasonsByKey.set(entity.stableKey, ["all_eligible"]);
  } else if (mode === "explicit" || mode === "proof-of-concept") {
    const keys = mode === "explicit" ? requestedKeys : proofKeys;
    const uniqueKeys = [...new Set(keys)];
    for (const stableKey of uniqueKeys) {
      const parsed = parseStableKey(stableKey);
      if (!parsed) {
        issues.malformedKeys.push(stableKey);
        continue;
      }
      const entity = byKey.get(stableKey);
      if (!entity) {
        issues.unknownKeys.push(stableKey);
        continue;
      }
      if (!isAutomaticallyEligible(entity, eligibility) && !includeIneligible) {
        issues.ineligibleKeys.push(stableKey);
        continue;
      }
      candidates.push(entity);
      reasonsByKey.set(stableKey, [mode === "explicit" ? "explicit_selection" : "proof_of_concept"]);
    }
  } else if (mode === "new") {
    if (!manifestProvided) {
      candidates = eligible;
      notes.push("No manifest was supplied; every currently eligible record is treated as new.");
    } else {
      candidates = eligible.filter((entity) => !manifest.has(entity.stableKey));
    }
    for (const entity of candidates) reasonsByKey.set(entity.stableKey, ["absent_from_manifest"]);
  } else if (mode === "new-from-state") {
    if (!stateDelta) throw new Error("new-from-state planning requires persistent production state.");
    candidates = stateDelta.newEligible;
    for (const entity of candidates) reasonsByKey.set(entity.stableKey, ["absent_from_persistent_state"]);
    notes.push(`Compared current eligibility with ${stateDelta.stateRecordCount} persistent primary records.`);
  } else if (mode === "changed") {
    for (const entity of eligible) {
      const entry = manifest.get(entity.stableKey);
      if (!entry) continue;
      const current = currentMetadata(entity, { rendererVersion, presetVersion });
      const reasons = compareManifestEntry(entry, current, { repoRoot });
      if (reasons.length) {
        candidates.push(entity);
        reasonsByKey.set(entity.stableKey, reasons);
      }
    }
  }

  candidates = [...new Map(candidates.map((entity) => [entity.stableKey, entity])).values()].sort(
    compareEntities,
  );
  const selected = candidates.map((entity) => ({
    ...entity,
    ...currentMetadata(entity, { rendererVersion, presetVersion }),
    reasons: reasonsByKey.get(entity.stableKey) ?? [],
    force,
    eligibilityTier: classifyEligibilityTier(entity, eligibility, {
      explicit: (mode === "explicit" || mode === "proof-of-concept") && !isAutomaticallyEligible(entity, eligibility),
    }),
  }));

  return {
    mode,
    dryRun: Boolean(dryRun),
    force: Boolean(force),
    includeIneligible: Boolean(includeIneligible),
    eligibilityRule: eligibilityRuleSummary(eligibility),
    selectedCount: selected.length,
    selected,
    issues,
    notes,
  };
}

function currentMetadata(entity, options) {
  const rendererVersion = options.rendererVersion ?? "renderer-not-implemented";
  const presetVersion = options.presetVersion ?? "poc-v1";
  return {
    sourceRecordHash: sourceRecordFingerprint(entity),
    artworkInputHash: artworkInputFingerprint(entity, { rendererVersion, presetVersion }),
    rendererVersion,
    presetVersion,
    outputPath: outputPathFor(entity),
  };
}

export function formatSelectionPlan(plan) {
  const lines = [
    `Nuvio selection plan: ${plan.mode}`,
    `Selected: ${plan.selectedCount}`,
    `Dry run: ${plan.dryRun ? "yes" : "no"} (planning never renders)` ,
    `Force future regeneration: ${plan.force ? "yes" : "no"}`,
  ];
  for (const note of plan.notes) lines.push(`Note: ${note}`);
  for (const [label, key] of [
    ["Malformed keys", "malformedKeys"],
    ["Unknown/missing source records", "unknownKeys"],
    ["Selected but ineligible", "ineligibleKeys"],
    ["Manifest records removed from source", "removedKeys"],
    ["Manifest records now ineligible", "ineligibleManifestKeys"],
    ["Persistent outputs missing/corrupt", "existingOutputIssues"],
    ["Existing logo paths changed", "changedLogoPathKeys"],
    ["Existing cached source hashes changed", "changedSourceHashKeys"],
    ["Persistent records below automatic threshold", "noLongerAutomaticallyEligibleKeys"],
    ["Persistent records missing from source", "disappearedFromSourceKeys"],
    ["Existing source hashes unavailable offline", "sourceHashUnavailableKeys"],
  ]) {
    if (plan.issues[key].length) lines.push(`${label}: ${plan.issues[key].join(", ")}`);
  }
  if (plan.selected.length <= 50) {
    lines.push("", ...plan.selected.map((entry) => `${entry.stableKey}  ${entry.name}  (${entry.titleCount})`));
  } else {
    lines.push("Use --json to inspect the complete deterministic selection.");
  }
  return lines.join("\n");
}

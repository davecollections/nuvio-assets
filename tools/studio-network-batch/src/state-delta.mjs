import fs from "node:fs/promises";
import path from "node:path";

import { compareEntities } from "./constants.mjs";
import { isAutomaticallyEligible } from "./eligibility.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";
import { logoCachePath } from "./logo-cache.mjs";
import { validateOutput } from "./output-validation.mjs";

function primaryRecords(state) {
  return Object.entries(state.entries ?? {})
    .filter(([key]) => key.endsWith("|primary"))
    .map(([, record]) => record)
    .sort(compareEntities);
}

export async function readPersistentProductionState(packageRoot, presetVersion) {
  const statePath = path.join(packageRoot, ".work", "reports", presetVersion, "run-state.json");
  const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
  if (!parsed?.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    throw new Error(`Invalid persistent production state: ${statePath}`);
  }
  return { statePath, state: parsed, records: primaryRecords(parsed) };
}

async function mapConcurrent(items, concurrency, mapper) {
  const result = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return result;
}

function groupByLogo(records) {
  const groups = new Map();
  for (const record of records) {
    if (!record.logoPath) continue;
    if (!groups.has(record.logoPath)) groups.set(record.logoPath, []);
    groups.get(record.logoPath).push(record.stableKey);
  }
  for (const stableKeys of groups.values()) stableKeys.sort();
  return groups;
}

async function inspectExistingRecord(record, current, { preset, cacheDirectory, inspectOutputs, inspectSourceHashes }) {
  const result = {
    stableKey: record.stableKey,
    outputIssue: null,
    changedSourceHash: null,
    sourceHashUnavailable: null,
  };
  if (inspectOutputs) {
    try {
      const valid = await validateOutput(record.outputPath, preset);
      if (valid.outputHash !== record.outputHash) {
        result.outputIssue = { stableKey: record.stableKey, reason: "output-hash-mismatch" };
      }
    } catch (error) {
      result.outputIssue = { stableKey: record.stableKey, reason: "output-missing-or-corrupt", message: error.message };
    }
  }

  if (!inspectSourceHashes || !current?.logoPath || current.logoPath !== record.logoPath) return result;
  const cachePath = logoCachePath(cacheDirectory, current.logoPath);
  try {
    const currentSourceHash = bufferFingerprint(await fs.readFile(cachePath));
    if (currentSourceHash !== record.sourceHash) {
      result.changedSourceHash = {
        stableKey: record.stableKey,
        logoPath: current.logoPath,
        previousSourceHash: record.sourceHash ?? null,
        currentSourceHash,
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    result.sourceHashUnavailable = { stableKey: record.stableKey, logoPath: current.logoPath };
  }
  return result;
}

export async function buildPersistentStateDelta({
  entities,
  eligibility,
  stateRecords,
  packageRoot,
  preset,
  inspectOutputs = true,
  inspectSourceHashes = true,
} = {}) {
  if (!eligibility) throw new Error("Eligibility policy is required for persistent-state comparison.");
  const ordered = [...entities].sort(compareEntities);
  const byKey = new Map(ordered.map((entity) => [entity.stableKey, entity]));
  const stateByKey = new Map(stateRecords.map((record) => [record.stableKey, record]));
  const eligible = ordered.filter((entity) => isAutomaticallyEligible(entity, eligibility));
  const existingStillEligible = eligible.filter((entity) => stateByKey.has(entity.stableKey));
  const newEligible = eligible.filter((entity) => !stateByKey.has(entity.stableKey));
  const disappearedFromSource = stateRecords.filter((record) => !byKey.has(record.stableKey));
  const noLongerAutomaticallyEligible = stateRecords
    .filter((record) => {
      const current = byKey.get(record.stableKey);
      return current && !isAutomaticallyEligible(current, eligibility);
    })
    .map((record) => byKey.get(record.stableKey))
    .sort(compareEntities);
  const changedLogoPaths = existingStillEligible
    .filter((entity) => (stateByKey.get(entity.stableKey).logoPath ?? "") !== entity.logoPath)
    .map((entity) => ({
      stableKey: entity.stableKey,
      previousLogoPath: stateByKey.get(entity.stableKey).logoPath ?? "",
      currentLogoPath: entity.logoPath,
    }));
  const renamedExisting = existingStillEligible
    .filter((entity) => stateByKey.get(entity.stableKey).name !== entity.name)
    .map((entity) => ({ stableKey: entity.stableKey, previousName: stateByKey.get(entity.stableKey).name, currentName: entity.name }));

  const inspections = inspectOutputs || inspectSourceHashes
    ? await mapConcurrent(existingStillEligible, 8, (entity) => inspectExistingRecord(
      stateByKey.get(entity.stableKey),
      entity,
      {
        preset,
        cacheDirectory: path.join(packageRoot, ".work", "cache", "logos"),
        inspectOutputs,
        inspectSourceHashes,
      },
    ))
    : [];
  const existingOutputIssues = inspections.map((item) => item.outputIssue).filter(Boolean);
  const changedSourceHashes = inspections.map((item) => item.changedSourceHash).filter(Boolean);
  const sourceHashUnavailable = inspections.map((item) => item.sourceHashUnavailable).filter(Boolean);

  const existingLogoGroups = groupByLogo(stateRecords);
  const newLogoGroups = groupByLogo(newEligible);
  const duplicateReuse = [];
  for (const entity of newEligible) {
    if (!entity.logoPath) continue;
    const withExisting = existingLogoGroups.get(entity.logoPath) ?? [];
    const withNew = (newLogoGroups.get(entity.logoPath) ?? []).filter((stableKey) => stableKey !== entity.stableKey);
    const duplicateWithStableKeys = [...new Set([...withExisting, ...withNew])].sort();
    if (duplicateWithStableKeys.length) {
      duplicateReuse.push({
        stableKey: entity.stableKey,
        logoPath: entity.logoPath,
        duplicateWithStableKeys,
        sharesWithExisting: withExisting.length > 0,
        sharesWithNew: withNew.length > 0,
      });
    }
  }
  const changedExistingKeys = new Set([
    ...changedLogoPaths.map((item) => item.stableKey),
    ...changedSourceHashes.map((item) => item.stableKey),
  ]);
  return {
    stateRecordCount: stateRecords.length,
    eligibleCount: eligible.length,
    eligible,
    existingStillEligible,
    newEligible,
    newCompanies: newEligible.filter((entity) => entity.entityType === "company"),
    newNetworks: newEligible.filter((entity) => entity.entityType === "network"),
    newLogoBacked: newEligible.filter((entity) => entity.logoPath),
    newMissingLogo: newEligible.filter((entity) => !entity.logoPath),
    duplicateReuse,
    changedLogoPaths,
    changedSourceHashes,
    changedExisting: existingStillEligible.filter((entity) => changedExistingKeys.has(entity.stableKey)),
    noLongerAutomaticallyEligible,
    disappearedFromSource,
    renamedExisting,
    existingOutputIssues,
    sourceHashUnavailable,
  };
}

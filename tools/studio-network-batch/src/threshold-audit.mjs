import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import {
  applyProductionBackgroundDecision,
  loadBackgroundDecisionConfiguration,
} from "./background-decision.mjs";
import { compareEntities } from "./constants.mjs";
import {
  classifyEligibilityTier,
  isAutomaticallyEligible,
  minimumTitleCountFor,
} from "./eligibility.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";
import { analyseLogo } from "./image-analysis.mjs";
import { logoCachePath } from "./logo-cache.mjs";
import { snapshotProductionDirectory } from "./staging-snapshot.mjs";
import { buildPersistentStateDelta } from "./state-delta.mjs";

const BAND_DEFINITIONS = Object.freeze([
  { id: ">=100", minimum: 100, maximum: Infinity, automaticallyIncluded: true },
  { id: "50-99", minimum: 50, maximum: 99, automaticallyIncluded: true },
  { id: "25-49", minimum: 25, maximum: 49, automaticallyIncluded: false },
  { id: "10-24", minimum: 10, maximum: 24, automaticallyIncluded: false },
  { id: "1-9", minimum: 1, maximum: 9, automaticallyIncluded: false },
  { id: "0 or missing", minimum: 0, maximum: 0, automaticallyIncluded: false },
]);

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normaliseName(value) {
  return value.trim().replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function duplicateStatistics(records, valueFor) {
  const groups = new Map();
  for (const record of records) {
    const value = valueFor(record);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record.stableKey);
  }
  const values = [...groups.entries()]
    .filter(([, keys]) => keys.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, keys]) => ({ value, stableKeys: keys.sort() }));
  return {
    groups: values.length,
    records: values.reduce((sum, item) => sum + item.stableKeys.length, 0),
    values,
  };
}

function countrySummary(records) {
  const counts = new Map();
  for (const record of records) {
    const country = record.originCountry || "unspecified";
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([originCountry, records]) => ({ originCountry, records }));
}

export function buildBandStatistics(entities, eligibility = { companyMinimumTitleCount: 50, networkMinimumTitleCount: 50 }) {
  const rows = [];
  for (const entityType of ["company", "network"]) {
    const typed = entities.filter((entity) => entity.entityType === entityType);
    for (const band of BAND_DEFINITIONS) {
      const records = typed.filter((entity) => entity.titleCount >= band.minimum && entity.titleCount <= band.maximum);
      const withLogo = records.filter((entity) => entity.logoPath);
      const minimum = minimumTitleCountFor(entityType, eligibility);
      const expectedAutomaticInclusion = band.minimum >= minimum
        ? "all"
        : band.maximum < minimum
          ? "none"
          : "partial";
      rows.push({
        entityType,
        countBand: band.id,
        totalRecords: records.length,
        recordsWithLogoPaths: withLogo.length,
        recordsWithoutLogoPaths: records.length - withLogo.length,
        duplicateExactLogoPaths: duplicateStatistics(withLogo, (entity) => entity.logoPath),
        duplicateNormalisedNames: duplicateStatistics(records, (entity) => normaliseName(entity.name)),
        originCountrySummary: countrySummary(records),
        expectedAutomaticInclusion,
        estimatedTextFallbackCount: records.length - withLogo.length,
      });
    }
  }
  return rows;
}

function stableKeys(records) {
  return [...records].sort(compareEntities).map((record) => record.stableKey);
}

function csvCell(value) {
  const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(records, fields) {
  return `${fields.join(",")}\n${records.map((record) => fields.map((field) => csvCell(record[field])).join(",")).join("\n")}\n`;
}

function bandFor(titleCount) {
  return BAND_DEFINITIONS.find((band) => titleCount >= band.minimum && titleCount <= band.maximum)?.id ?? "unknown";
}

function nameIndex(entities, entityType) {
  const result = new Map();
  for (const entity of entities.filter((item) => item.entityType === entityType)) {
    const name = normaliseName(entity.name);
    if (!result.has(name)) result.set(name, []);
    result.get(name).push(entity);
  }
  for (const values of result.values()) values.sort((left, right) => right.titleCount - left.titleCount || compareEntities(left, right));
  return result;
}

function matchesForSeed(seed, index) {
  const names = [seed.canonicalName, ...(seed.aliases ?? [])].map(normaliseName);
  const result = new Map();
  for (const name of names) {
    for (const entity of index.get(name) ?? []) result.set(entity.stableKey, entity);
  }
  return [...result.values()].sort((left, right) => {
    const leftCanonical = normaliseName(left.name) === normaliseName(seed.canonicalName) ? 0 : 1;
    const rightCanonical = normaliseName(right.name) === normaliseName(seed.canonicalName) ? 0 : 1;
    return leftCanonical - rightCanonical || right.titleCount - left.titleCount || compareEntities(left, right);
  });
}

function seedRecommendation(seed, primary, matches, eligibility) {
  if (!primary) return { recommendedAction: "missing from cache", confidence: "uncertain" };
  if (isAutomaticallyEligible(primary, eligibility)) return { recommendedAction: "already eligible", confidence: "high" };
  const exactCanonical = normaliseName(primary.name) === normaliseName(seed.canonicalName);
  if (seed.priority === "high" && exactCanonical && matches.length === 1 && primary.logoPath && primary.titleCount >= 10) {
    return { recommendedAction: "high-confidence exception", confidence: "high-confidence exception" };
  }
  return { recommendedAction: "manual review", confidence: "uncertain" };
}

export function buildRecognisabilityAudit(entities, seeds, eligibility) {
  const indexes = {
    company: nameIndex(entities, "company"),
    network: nameIndex(entities, "network"),
  };
  const seedAudit = [];
  const candidateMap = new Map();
  for (const seed of seeds) {
    const matches = matchesForSeed(seed, indexes[seed.entityType]);
    const primary = matches[0] ?? null;
    const recommendation = seedRecommendation(seed, primary, matches, eligibility);
    seedAudit.push({
      stableKey: primary?.stableKey ?? null,
      entityType: seed.entityType,
      tmdbId: primary?.tmdbId ?? null,
      canonicalName: seed.canonicalName,
      matchedName: primary?.name ?? null,
      titleCount: primary?.titleCount ?? null,
      automaticEligibility: primary ? isAutomaticallyEligible(primary, eligibility) : false,
      logoPresent: Boolean(primary?.logoPath),
      possibleRelatedIds: matches.slice(1).map((entity) => entity.stableKey),
      possibleSuccessorIds: seed.possibleSuccessorIds ?? [],
      recommendedAction: recommendation.recommendedAction,
      confidence: recommendation.confidence,
      notes: !primary
        ? `No exact local-cache match for ${[seed.canonicalName, ...(seed.aliases ?? [])].join(" / ")}.`
        : matches.length > 1
          ? `Multiple exact canonical/alias matches require identity review; category: ${seed.category}.`
          : `Local-cache exact name match; category: ${seed.category}.`,
    });
    const candidateMatches = matches.filter((item) =>
      !isAutomaticallyEligible(item, eligibility) &&
      (item.stableKey === primary?.stableKey || (primary?.logoPath && item.logoPath === primary.logoPath)),
    );
    for (const entity of candidateMatches) {
      if (!candidateMap.has(entity.stableKey)) candidateMap.set(entity.stableKey, { entity, seeds: [], related: new Set() });
      const candidate = candidateMap.get(entity.stableKey);
      candidate.seeds.push(seed);
      for (const related of matches) if (related.stableKey !== entity.stableKey) candidate.related.add(related.stableKey);
    }
  }
  const belowThresholdCandidates = [...candidateMap.values()]
    .sort((left, right) => compareEntities(left.entity, right.entity))
    .map(({ entity, seeds: matchedSeeds, related }) => {
      const exactHigh = matchedSeeds.some((seed) => seed.priority === "high" && normaliseName(seed.canonicalName) === normaliseName(entity.name));
      const unambiguous = matchedSeeds.every((seed) => matchesForSeed(seed, indexes[seed.entityType]).length === 1);
      const highConfidence = exactHigh && unambiguous && Boolean(entity.logoPath) && entity.titleCount >= 10;
      return {
        entityType: entity.entityType,
        tmdbId: entity.tmdbId,
        stableKey: entity.stableKey,
        name: entity.name,
        titleCount: entity.titleCount,
        countBand: bandFor(entity.titleCount),
        logoPath: entity.logoPath,
        originCountry: entity.originCountry,
        parentCompany: entity.parentCompany,
        reasonRecognisable: [...new Set(matchedSeeds.map((seed) => seed.category))].join("; "),
        confidence: highConfidence ? "high-confidence exception" : "uncertain",
        possibleRelatedIds: [...related].sort(),
        recommendedAction: highConfidence ? "high-confidence exception" : "manual review",
        notes: "Candidate only; local cache evidence does not create production eligibility.",
      };
    });
  return { seedAudit, belowThresholdCandidates };
}

function newlyEligibleRows(delta, eligibility) {
  const duplicates = new Map(delta.duplicateReuse.map((item) => [item.stableKey, item]));
  return delta.newEligible.map((entity) => {
    const duplicate = duplicates.get(entity.stableKey);
    return {
      entityType: entity.entityType,
      tmdbId: entity.tmdbId,
      stableKey: entity.stableKey,
      name: entity.name,
      titleCount: entity.titleCount,
      eligibilityTier: classifyEligibilityTier(entity, eligibility),
      logoPath: entity.logoPath,
      originCountry: entity.originCountry,
      parentCompany: entity.parentCompany,
      existingState: "absent",
      duplicateLogoPath: Boolean(duplicate),
      duplicateWithStableKeys: duplicate?.duplicateWithStableKeys ?? [],
      missingLogo: !entity.logoPath,
      recommendedNextAction: "generate incrementally after owner approval",
    };
  });
}

async function offlineBackgroundEstimate(delta, packageRoot, preset) {
  const cacheDirectory = path.join(packageRoot, ".work", "cache", "logos");
  const configuration = preset.backgroundDecision
    ? await loadBackgroundDecisionConfiguration(packageRoot, preset)
    : null;
  const analyses = new Map();
  const result = { analysedFromCache: 0, dark: 0, light: 0, needsReview: 0, cacheUnavailable: 0, networkRequestsMade: 0 };
  for (const entity of delta.newLogoBacked) {
    const cachePath = logoCachePath(cacheDirectory, entity.logoPath);
    let sourceBuffer;
    try {
      sourceBuffer = await fs.readFile(cachePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result.cacheUnavailable += 1;
      continue;
    }
    let analysisPromise = analyses.get(entity.logoPath);
    if (!analysisPromise) {
      analysisPromise = analyseLogo(cachePath, preset);
      analyses.set(entity.logoPath, analysisPromise);
    }
    const analysis = await analysisPromise;
    const decision = applyProductionBackgroundDecision(analysis, preset, {
      stableKey: entity.stableKey,
      sourceLogoHash: bufferFingerprint(sourceBuffer),
      configuration,
    });
    result.analysedFromCache += 1;
    result[decision.selectedBackground] += 1;
    if ([...(analysis.reviewReasons ?? []), ...(decision.reviewReasons ?? [])].length) result.needsReview += 1;
  }
  return result;
}

async function previousFullRunSeconds(packageRoot, stateRecordCount) {
  const runsRoot = path.join(packageRoot, ".work", "reports", "production-v1", "runs");
  let maximum = 0;
  for (const entry of await fs.readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(entry.name);
    if (!match) continue;
    const recordsPath = path.join(runsRoot, entry.name, "records.jsonl");
    let lines;
    try { lines = (await fs.readFile(recordsPath, "utf8")).trim().split(/\r?\n/).filter(Boolean); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (lines.length < stateRecordCount) continue;
    const start = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
    const stat = await fs.stat(recordsPath);
    maximum = Math.max(maximum, (stat.mtimeMs - start) / 1000);
  }
  return maximum || null;
}

function outputImpact(delta, stateRecords, previousRuntimeSeconds) {
  const sizes = stateRecords.map((record) => record.outputBytes).filter(Number.isSafeInteger).sort((a, b) => a - b);
  const average = sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  const median = sizes.length % 2
    ? sizes[Math.floor(sizes.length / 2)]
    : (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2;
  const existingLogoBacked = stateRecords.filter((record) => record.logoPath).length;
  const existingLogoReviews = stateRecords.filter((record) => record.logoPath && record.reviewStatus === "needs-review").length;
  const estimatedLogoReviewRate = existingLogoBacked ? existingLogoReviews / existingLogoBacked : 0;
  const expectedReviewEstimate = delta.newMissingLogo.length + Math.round(delta.newLogoBacked.length * estimatedLogoReviewRate);
  const scaledRuntimeSeconds = previousRuntimeSeconds
    ? previousRuntimeSeconds * delta.newEligible.length / stateRecords.length
    : null;
  return {
    currentAverageOutputBytes: Math.round(average),
    currentMedianOutputBytes: Math.round(median),
    estimatedOutputBytesFromAverage: Math.round(average * delta.newEligible.length),
    estimatedOutputBytesFromMedian: Math.round(median * delta.newEligible.length),
    currentLogoBackedReviewRate: estimatedLogoReviewRate,
    estimatedNeedsReview: expectedReviewEstimate,
    contactSheetPages: {
      companies: Math.ceil(delta.newCompanies.length / 64),
      networks: Math.ceil(delta.newNetworks.length / 64),
      combined: Math.ceil(delta.newEligible.length / 64),
    },
    previousFullRunSeconds: previousRuntimeSeconds,
    estimatedRuntimeSeconds: scaledRuntimeSeconds ? Math.round(scaledRuntimeSeconds) : null,
    estimatedRuntimeRangeSeconds: scaledRuntimeSeconds
      ? [Math.round(scaledRuntimeSeconds * 0.8), Math.round(scaledRuntimeSeconds * 1.35)]
      : null,
  };
}

async function fileHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return { path: filePath, bytes: buffer.length, sha256: hash(buffer) };
}

export async function captureProtectedState(packageRoot, presetVersion) {
  const staging = await snapshotProductionDirectory(path.join(packageRoot, ".work", "staging", presetVersion));
  const [reviewState, reviewChecklist] = await Promise.all([
    fileHash(path.join(packageRoot, ".work", "reviews", presetVersion, "review-state-draft.json")),
    fileHash(path.join(packageRoot, ".work", "reviews", presetVersion, "review-checklist.csv")),
  ]);
  return { staging, reviewState, reviewChecklist };
}

function duplicateNotes(delta, recognisability, entities) {
  const normalisedGroups = duplicateStatistics(
    recognisability.belowThresholdCandidates.map((candidate) => ({ ...candidate, name: candidate.name })),
    (candidate) => normaliseName(candidate.name),
  ).values;
  const crossType = duplicateStatistics(entities, (entity) => normaliseName(entity.name)).values
    .filter((group) => group.stableKeys.some((key) => key.startsWith("company:")) && group.stableKeys.some((key) => key.startsWith("network:")))
    .filter((group) => group.stableKeys.some((key) => delta.newEligible.some((entity) => entity.stableKey === key)));
  const ambiguousSeeds = recognisability.seedAudit.filter((item) => item.possibleRelatedIds.length);
  return `# Duplicate and successor audit\n\n` +
    `Identity remains one physical output per TMDB ID. No relationship below is an automatic merge.\n\n` +
    `- Newly eligible records with exact-logo reuse: ${delta.duplicateReuse.length}\n` +
    `- Relevant duplicate normalised-name groups: ${normalisedGroups.length}\n` +
    `- Relevant company/network cross-type name groups: ${crossType.length}\n` +
    `- Seed items with multiple exact canonical/alias matches: ${ambiguousSeeds.length}\n` +
    `- Renamed existing stable keys detected: ${delta.renamedExisting.length}\n` +
    `- Existing stable keys missing from source: ${delta.disappearedFromSource.length}\n\n` +
    `## Exact-logo reuse\n\n${delta.duplicateReuse.length ? delta.duplicateReuse.map((item) => `- ${item.stableKey}: ${item.duplicateWithStableKeys.join(", ")}`).join("\n") : "None."}\n\n` +
    `## Ambiguous seed identities\n\n${ambiguousSeeds.length ? ambiguousSeeds.map((item) => `- ${item.canonicalName}: ${[item.stableKey, ...item.possibleRelatedIds].filter(Boolean).join(", ")}`).join("\n") : "None."}\n`;
}

function summaryMarkdown(summary) {
  return `# Eligibility threshold audit: 50/50\n\n` +
    `- Companies eligible: ${summary.eligibleTotals.companies}\n` +
    `- Networks eligible: ${summary.eligibleTotals.networks}\n` +
    `- Combined eligible: ${summary.eligibleTotals.combined}\n` +
    `- Persistent records: ${summary.delta.existingState}\n` +
    `- Existing still eligible: ${summary.delta.existingStillEligible}\n` +
    `- Newly eligible: ${summary.delta.newCombined} (${summary.delta.newCompanies} companies; ${summary.delta.newNetworks} networks)\n` +
    `- Newly eligible with logos: ${summary.delta.newLogoBacked}; missing logos: ${summary.delta.newMissingLogo}\n` +
    `- Exact-logo reuse candidates: ${summary.delta.duplicateReuse}\n` +
    `- Existing changed logo paths / source hashes: ${summary.delta.changedLogoPaths}/${summary.delta.changedSourceHashes}\n` +
    `- Existing missing or corrupt outputs: ${summary.delta.existingOutputIssues}\n` +
    `- No longer automatically eligible: ${summary.delta.noLongerAutomaticallyEligible}\n` +
    `- Artwork generated: no\n` +
    `- Network requests: 0\n\n` +
    `## Preservation\n\n` +
    `- Staged count: ${summary.preservation.before.stagingCount} before; ${summary.preservation.after.stagingCount} after\n` +
    `- Content fingerprint unchanged: ${summary.preservation.contentFingerprintUnchanged}\n` +
    `- Modification-time fingerprint unchanged: ${summary.preservation.mtimeFingerprintUnchanged}\n` +
    `- Review-state hash unchanged: ${summary.preservation.reviewStateHashUnchanged}\n` +
    `- Review-checklist hash unchanged: ${summary.preservation.reviewChecklistHashUnchanged}\n\n` +
    `## Exact next step\n\n` +
    `After owner approval, run:\n\n` +
    `\`\`\`powershell\n${summary.futureGenerationCommand}\n\`\`\`\n`;
}

function storageMarkdown(impact, backgroundEstimate) {
  const runtime = impact.estimatedRuntimeRangeSeconds
    ? `${Math.round(impact.estimatedRuntimeRangeSeconds[0] / 60)}–${Math.round(impact.estimatedRuntimeRangeSeconds[1] / 60)} minutes`
    : "unavailable";
  return `# Storage and runtime estimate\n\n` +
    `These are planning estimates, not exact generation results.\n\n` +
    `- Estimated output storage from current average: ${impact.estimatedOutputBytesFromAverage.toLocaleString("en-US")} bytes\n` +
    `- Estimated output storage from current median: ${impact.estimatedOutputBytesFromMedian.toLocaleString("en-US")} bytes\n` +
    `- Estimated review count: ${impact.estimatedNeedsReview}\n` +
    `- Estimated runtime range: ${runtime}\n` +
    `- Contact-sheet pages: ${impact.contactSheetPages.companies} company; ${impact.contactSheetPages.networks} network; ${impact.contactSheetPages.combined} combined\n` +
    `- Offline background analysis available: ${backgroundEstimate.analysedFromCache}; dark ${backgroundEstimate.dark}; light ${backgroundEstimate.light}; cache unavailable ${backgroundEstimate.cacheUnavailable}\n`;
}

export async function writeThresholdPlans(packageRoot, delta) {
  const root = path.join(packageRoot, ".work", "plans", "eligibility-50");
  const plans = {
    "existing-still-eligible.json": stableKeys(delta.existingStillEligible),
    "new-companies.json": stableKeys(delta.newCompanies),
    "new-networks.json": stableKeys(delta.newNetworks),
    "new-all.json": stableKeys(delta.newEligible),
    "new-logo-backed.json": stableKeys(delta.newLogoBacked),
    "new-missing-logo.json": stableKeys(delta.newMissingLogo),
    "new-duplicate-reuse.json": stableKeys(delta.newEligible.filter((entity) => delta.duplicateReuse.some((item) => item.stableKey === entity.stableKey))),
    "changed-existing.json": stableKeys(delta.changedExisting),
    "no-longer-automatically-eligible.json": stableKeys(delta.noLongerAutomaticallyEligible),
    "invalid-new-records.json": [],
  };
  await Promise.all(Object.entries(plans).map(([fileName, value]) => atomicWriteJson(path.join(root, fileName), value)));
  return { root, plans };
}

export async function runThresholdAudit({
  packageRoot,
  sourceData,
  eligibility,
  preset,
  stateRecords,
  seedConfiguration,
  beforeProtectedState,
} = {}) {
  if (sourceData.validationErrors.length) {
    throw new Error(`Threshold audit requires valid source data; found ${sourceData.validationErrors.length} error(s).`);
  }
  const delta = await buildPersistentStateDelta({
    entities: sourceData.entities,
    eligibility,
    stateRecords,
    packageRoot,
    preset,
  });
  const bands = buildBandStatistics(sourceData.entities, eligibility);
  const recognisability = buildRecognisabilityAudit(sourceData.entities, seedConfiguration.items, eligibility);
  const newRows = newlyEligibleRows(delta, eligibility);
  const previousRuntimeSeconds = await previousFullRunSeconds(packageRoot, stateRecords.length);
  const impact = outputImpact(delta, stateRecords, previousRuntimeSeconds);
  const backgroundEstimate = await offlineBackgroundEstimate(delta, packageRoot, preset);
  const planResult = await writeThresholdPlans(packageRoot, delta);
  const reportsRoot = path.join(packageRoot, ".work", "reports", "threshold-audit-50");
  const proposedExceptions = {
    highConfidence: recognisability.belowThresholdCandidates.filter((item) => item.recommendedAction === "high-confidence exception"),
    manualReview: recognisability.belowThresholdCandidates.filter((item) => item.recommendedAction === "manual review"),
    rejected: recognisability.belowThresholdCandidates.filter((item) => item.recommendedAction === "do not include"),
  };
  const preliminarySummary = {
    generatedAt: new Date().toISOString(),
    sourceDirectory: sourceData.sourceDirectory,
    eligibility: {
      version: eligibility.version,
      companyMinimumTitleCount: eligibility.companyMinimumTitleCount,
      networkMinimumTitleCount: eligibility.networkMinimumTitleCount,
    },
    eligibleTotals: {
      companies: delta.eligible.filter((entity) => entity.entityType === "company").length,
      networks: delta.eligible.filter((entity) => entity.entityType === "network").length,
      combined: delta.eligible.length,
    },
    delta: {
      existingState: stateRecords.length,
      existingStillEligible: delta.existingStillEligible.length,
      newCompanies: delta.newCompanies.length,
      newNetworks: delta.newNetworks.length,
      newCombined: delta.newEligible.length,
      newLogoBacked: delta.newLogoBacked.length,
      newMissingLogo: delta.newMissingLogo.length,
      duplicateReuse: delta.duplicateReuse.length,
      changedLogoPaths: delta.changedLogoPaths.length,
      changedSourceHashes: delta.changedSourceHashes.length,
      sourceHashUnavailable: delta.sourceHashUnavailable.length,
      existingOutputIssues: delta.existingOutputIssues.length,
      noLongerAutomaticallyEligible: delta.noLongerAutomaticallyEligible.length,
      disappearedFromSource: delta.disappearedFromSource.length,
      renamedExisting: delta.renamedExisting.length,
      invalidNewRecords: 0,
    },
    tierCounts: {
      core: delta.eligible.filter((entity) => classifyEligibilityTier(entity, eligibility) === "core").length,
      expandedThreshold: delta.eligible.filter((entity) => classifyEligibilityTier(entity, eligibility) === "expanded-threshold").length,
      curatedException: 0,
      explicit: 0,
    },
    recognisability: {
      seedItems: recognisability.seedAudit.length,
      belowThresholdCandidates: recognisability.belowThresholdCandidates.length,
      highConfidence: proposedExceptions.highConfidence.length,
      manualReview: proposedExceptions.manualReview.length,
      rejected: proposedExceptions.rejected.length,
      network10To49: recognisability.belowThresholdCandidates.filter((item) => item.entityType === "network" && item.titleCount >= 10 && item.titleCount <= 49).length,
    },
    impact,
    backgroundEstimate,
    plans: Object.fromEntries(Object.entries(planResult.plans).map(([name, keys]) => [name, keys.length])),
    networkRequestsMade: 0,
    artworkGenerated: false,
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
    futureGenerationCommand: "npm --prefix tools/studio-network-batch run generate -- --ids-file .work/plans/eligibility-50/new-all.json --preset production-v1",
  };
  const bandFields = [
    "entityType", "countBand", "totalRecords", "recordsWithLogoPaths", "recordsWithoutLogoPaths",
    "duplicateExactLogoPathGroups", "duplicateExactLogoPathRecords", "duplicateNormalisedNameGroups",
    "duplicateNormalisedNameRecords", "originCountrySummary", "expectedAutomaticInclusion", "estimatedTextFallbackCount",
  ];
  const flatBands = bands.map((item) => ({
    ...item,
    duplicateExactLogoPathGroups: item.duplicateExactLogoPaths.groups,
    duplicateExactLogoPathRecords: item.duplicateExactLogoPaths.records,
    duplicateNormalisedNameGroups: item.duplicateNormalisedNames.groups,
    duplicateNormalisedNameRecords: item.duplicateNormalisedNames.records,
  }));
  const newFields = [
    "entityType", "tmdbId", "stableKey", "name", "titleCount", "eligibilityTier", "logoPath",
    "originCountry", "parentCompany", "existingState", "duplicateLogoPath", "duplicateWithStableKeys",
    "missingLogo", "recommendedNextAction",
  ];
  const candidateFields = [
    "entityType", "tmdbId", "stableKey", "name", "titleCount", "countBand", "logoPath",
    "originCountry", "parentCompany", "reasonRecognisable", "confidence", "possibleRelatedIds",
    "recommendedAction", "notes",
  ];
  const seedFields = [
    "stableKey", "entityType", "tmdbId", "canonicalName", "matchedName", "titleCount", "automaticEligibility",
    "logoPresent", "possibleRelatedIds", "possibleSuccessorIds", "recommendedAction", "confidence", "notes",
  ];
  await Promise.all([
    atomicWriteJson(path.join(reportsRoot, "bands.json"), bands),
    atomicWrite(path.join(reportsRoot, "bands.csv"), csv(flatBands, bandFields)),
    atomicWriteJson(path.join(reportsRoot, "newly-eligible.json"), newRows),
    atomicWrite(path.join(reportsRoot, "newly-eligible.csv"), csv(newRows, newFields)),
    atomicWriteJson(path.join(reportsRoot, "below-threshold-candidates.json"), recognisability.belowThresholdCandidates),
    atomicWrite(path.join(reportsRoot, "below-threshold-candidates.csv"), csv(recognisability.belowThresholdCandidates, candidateFields)),
    atomicWriteJson(path.join(reportsRoot, "seed-audit.json"), recognisability.seedAudit),
    atomicWrite(path.join(reportsRoot, "seed-audit.csv"), csv(recognisability.seedAudit, seedFields)),
    atomicWriteJson(path.join(reportsRoot, "proposed-exceptions.json"), proposedExceptions),
    atomicWrite(path.join(reportsRoot, "duplicate-and-successor-notes.md"), duplicateNotes(delta, recognisability, sourceData.entities)),
    atomicWrite(path.join(reportsRoot, "storage-and-runtime-estimate.md"), storageMarkdown(impact, backgroundEstimate)),
  ]);
  const afterProtectedState = await captureProtectedState(packageRoot, preset.version);
  const summary = {
    ...preliminarySummary,
    preservation: {
      before: {
        stagingCount: beforeProtectedState.staging.count,
        combinedFingerprint: beforeProtectedState.staging.combinedFingerprint,
        mtimeFingerprint: beforeProtectedState.staging.mtimeFingerprint,
        reviewStateHash: beforeProtectedState.reviewState.sha256,
        reviewChecklistHash: beforeProtectedState.reviewChecklist.sha256,
      },
      after: {
        stagingCount: afterProtectedState.staging.count,
        combinedFingerprint: afterProtectedState.staging.combinedFingerprint,
        mtimeFingerprint: afterProtectedState.staging.mtimeFingerprint,
        reviewStateHash: afterProtectedState.reviewState.sha256,
        reviewChecklistHash: afterProtectedState.reviewChecklist.sha256,
      },
      contentFingerprintUnchanged: beforeProtectedState.staging.combinedFingerprint === afterProtectedState.staging.combinedFingerprint,
      mtimeFingerprintUnchanged: beforeProtectedState.staging.mtimeFingerprint === afterProtectedState.staging.mtimeFingerprint,
      reviewStateHashUnchanged: beforeProtectedState.reviewState.sha256 === afterProtectedState.reviewState.sha256,
      reviewChecklistHashUnchanged: beforeProtectedState.reviewChecklist.sha256 === afterProtectedState.reviewChecklist.sha256,
    },
  };
  if (summary.preservation.before.stagingCount !== stateRecords.length ||
      summary.preservation.after.stagingCount !== beforeProtectedState.staging.count ||
      !summary.preservation.contentFingerprintUnchanged ||
      !summary.preservation.mtimeFingerprintUnchanged ||
      !summary.preservation.reviewStateHashUnchanged ||
      !summary.preservation.reviewChecklistHashUnchanged) {
    throw new Error("Protected staging or review state changed during threshold audit.");
  }
  await Promise.all([
    atomicWriteJson(path.join(reportsRoot, "summary.json"), summary),
    atomicWrite(path.join(reportsRoot, "summary.md"), summaryMarkdown(summary)),
  ]);
  return { summary, delta, bands, recognisability, proposedExceptions, plans: planResult.plans, reportsRoot };
}

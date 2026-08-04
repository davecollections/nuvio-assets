import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "./people-publication.mjs";
import { inspectSharedPeopleHero } from "./people-presentation-manifest.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";

export const PEOPLE_V3_READINESS_VERSION = "people-v3-artwork-readiness-v1";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const PROFILE_PATH = /^\/[A-Za-z0-9_-]+\.jpg$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function recursiveFiles(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export async function treeContentState(root, { repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const files = await recursiveFiles(root);
  const records = await Promise.all(files.map(async (filePath) => {
    const buffer = await fs.readFile(filePath);
    return {
      path: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
      sha256: sha256(buffer),
      byteCount: buffer.length,
    };
  }));
  return {
    fileCount: records.length,
    byteCount: records.reduce((sum, record) => sum + record.byteCount, 0),
    contentFingerprint: sha256(stableStringify(records)),
    records,
  };
}

async function fileState(filePath, repoRoot) {
  const buffer = await fs.readFile(filePath);
  return {
    path: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    sha256: sha256(buffer),
    byteCount: buffer.length,
  };
}

export async function capturePeopleV3ProtectedState({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, sharp } = {}) {
  const peopleRoot = path.join(repoRoot, "assets", "collection_covers", "people");
  const companiesRoot = path.join(repoRoot, "assets", "collection_covers", "companies");
  const networksRoot = path.join(repoRoot, "assets", "collection_covers", "networks");
  const [people, companies, networks, runtimeLookup, collectionManifest, hero] = await Promise.all([
    treeContentState(peopleRoot, { repoRoot }),
    treeContentState(companiesRoot, { repoRoot }),
    treeContentState(networksRoot, { repoRoot }),
    fileState(path.join(repoRoot, "assets", "collection_covers", "runtime-lookup.json"), repoRoot),
    fileState(path.join(repoRoot, "assets", "collection_covers", "manifest.json"), repoRoot),
    inspectSharedPeopleHero({ repoRoot, sharp }),
  ]);
  return { people, companies, networks, runtimeLookup, collectionManifest, hero };
}

async function discoverTopLevelSourceCaches(repoRoot) {
  const workRoot = path.join(repoRoot, "tools", "people-seed", ".work");
  const roots = [];
  let entries = [];
  try { entries = await fs.readdir(workRoot, { withFileTypes: true }); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "people-v3-artwork-proof") continue;
    const sourceCache = path.join(workRoot, entry.name, "source-cache");
    const indexPath = path.join(sourceCache, "index.json");
    if (await exists(indexPath)) roots.push({ sourceCache, indexPath });
  }
  return roots.sort((left, right) => left.sourceCache.localeCompare(right.sourceCache));
}

async function readSourceCacheEvidence(repoRoot) {
  const roots = await discoverTopLevelSourceCaches(repoRoot);
  const entries = [];
  const summaries = [];
  for (const root of roots) {
    const buffer = await fs.readFile(root.indexPath);
    const index = JSON.parse(buffer);
    assert(index.version === "people-portrait-source-cache-v1" && Array.isArray(index.entries), `Invalid existing People source-cache index: ${root.indexPath}`);
    summaries.push({
      root: path.relative(repoRoot, root.sourceCache).replaceAll("\\", "/"),
      indexPath: path.relative(repoRoot, root.indexPath).replaceAll("\\", "/"),
      indexSha256: sha256(buffer),
      entryCount: index.entries.length,
    });
    for (const entry of index.entries) entries.push({ ...entry, sourceCache: root.sourceCache, sourceCacheRelative: path.relative(repoRoot, root.sourceCache).replaceAll("\\", "/") });
  }
  return { summaries, entries };
}

async function validateCacheCandidate(candidate, sharp) {
  if (!candidate || !candidate.sourceFile || path.isAbsolute(candidate.sourceFile)) return { valid: false, reason: "cache-entry-path-invalid" };
  const sourcePath = path.resolve(candidate.sourceCache, candidate.sourceFile);
  if (!(await exists(sourcePath))) return { valid: false, reason: "cache-file-missing" };
  const buffer = await fs.readFile(sourcePath);
  if (buffer.length === 0) return { valid: false, reason: "cache-file-empty" };
  const actualHash = sha256(buffer);
  if (candidate.sourceHash !== actualHash) return { valid: false, reason: "cache-hash-mismatch", actualHash };
  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) return { valid: false, reason: "cache-dimensions-invalid" };
    if (candidate.width !== metadata.width || candidate.height !== metadata.height) return { valid: false, reason: "cache-index-dimensions-mismatch", width: metadata.width, height: metadata.height };
    return { valid: true, reason: null, sourceHash: actualHash, width: metadata.width, height: metadata.height, format: metadata.format, byteCount: buffer.length, sourceFile: candidate.sourceFile, sourceCache: candidate.sourceCacheRelative };
  } catch (error) {
    return { valid: false, reason: "cache-decode-failed", error: error.message };
  }
}

function categoriesForId(tmdbPersonId, actorIds, directorIds) {
  return [
    ...(actorIds.has(tmdbPersonId) ? ["actor"] : []),
    ...(directorIds.has(tmdbPersonId) ? ["director"] : []),
  ];
}

async function physicalDirectoryState(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const ids = [];
  const invalidFiles = [];
  for (const name of files) {
    const match = /^([1-9][0-9]*)\.webp$/u.exec(name);
    if (match) ids.push(Number(match[1]));
    else invalidFiles.push(name);
  }
  return { files, ids, invalidFiles };
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort((a, b) => a - b);
}

function exactCategoryChanges({ registry, manifest, runtime, actorIds, directorIds }) {
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const runtimePeople = runtime.people || {};
  const changes = [];
  for (const record of manifest.records) {
    const expected = categoriesForId(record.tmdbPersonId, actorIds, directorIds);
    const runtimeRecord = runtimePeople[String(record.tmdbPersonId)] || null;
    if (stableStringify(record.categoryMembership) !== stableStringify(expected) || stableStringify(runtimeRecord?.categories || []) !== stableStringify(expected)) {
      const person = registryById.get(record.tmdbPersonId);
      changes.push({
        stableKey: person.stableKey,
        tmdbPersonId: person.tmdbPersonId,
        canonicalName: person.canonicalName,
        manifestCategoriesBefore: record.categoryMembership,
        runtimeCategoriesBefore: runtimeRecord?.categories || null,
        requiredCategoriesAfter: expected,
      });
    }
  }
  return changes.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
}

export async function buildPeopleV3ArtworkReadinessAudit({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, generatedAt, runtime } = {}) {
  const sharp = runtime.sharp;
  const [registry, actors, directors, manifest, runtimeLookup, cropOverrides, cacheEvidence, protectedState] = await Promise.all([
    readJson(path.join(repoRoot, "data", "people", "people-registry.json")),
    readJson(path.join(repoRoot, "data", "people", "actors-seed.json")),
    readJson(path.join(repoRoot, "data", "people", "directors-seed.json")),
    readJson(path.join(repoRoot, "assets", "collection_covers", "people", "manifest.json")),
    readJson(path.join(repoRoot, "assets", "collection_covers", "runtime-lookup.json")),
    readJson(path.join(repoRoot, "data", "people", "landscape-crop-overrides.json")),
    readSourceCacheEvidence(repoRoot),
    capturePeopleV3ProtectedState({ repoRoot, sharp }),
  ]);
  const [landscapePhysical, posterPhysical] = await Promise.all([
    physicalDirectoryState(path.join(repoRoot, "assets", "collection_covers", "people", "landscape")),
    physicalDirectoryState(path.join(repoRoot, "assets", "collection_covers", "people", "poster")),
  ]);
  const registryIds = new Set(registry.records.map((record) => record.tmdbPersonId));
  const manifestIds = new Set(manifest.records.map((record) => record.tmdbPersonId));
  const runtimeIds = new Set(Object.keys(runtimeLookup.people || {}).map(Number));
  const landscapeIds = new Set(landscapePhysical.ids);
  const posterIds = new Set(posterPhysical.ids);
  const actorIds = new Set(actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(directors.records.map((record) => record.tmdbPersonId));
  const cropById = new Map(cropOverrides.records.map((record) => [record.tmdbPersonId, record]));
  const registryOnlyIds = setDifference(registryIds, manifestIds);
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const records = [];
  for (const tmdbPersonId of registryOnlyIds) {
    const person = registryById.get(tmdbPersonId);
    const candidates = cacheEvidence.entries.filter((entry) => entry.stableKey === person.stableKey && entry.profilePath === person.profilePath);
    const validations = [];
    for (const candidate of candidates) validations.push(await validateCacheCandidate(candidate, sharp));
    const usableCache = validations.find((validation) => validation.valid) || null;
    const profilePathAvailable = PROFILE_PATH.test(person.profilePath || "");
    const cropOverride = cropById.get(tmdbPersonId) || null;
    const cacheInvalid = candidates.length > 0 && !usableCache;
    const sourceAcquisitionRequired = profilePathAvailable && !usableCache;
    const fallbackCandidate = !profilePathAvailable;
    const manualInvestigationRequired = fallbackCandidate || cacheInvalid || Boolean(cropOverride);
    records.push({
      stableKey: person.stableKey,
      tmdbPersonId,
      canonicalName: person.canonicalName,
      approvedCategories: categoriesForId(tmdbPersonId, actorIds, directorIds),
      profilePath: person.profilePath,
      profilePathAvailable,
      existingCacheCandidateCount: candidates.length,
      usableExistingCache: Boolean(usableCache),
      usableCacheEvidence: usableCache,
      cacheValidationFailures: validations.filter((validation) => !validation.valid),
      sourceAcquisitionRequired,
      fallbackCandidate,
      landscapeCropOverrideApplies: Boolean(cropOverride),
      cropOverrideEvidence: cropOverride ? { stableKey: cropOverride.stableKey, sourceProfilePath: cropOverride.sourceProfilePath, sourceHash: cropOverride.sourceHash, reason: cropOverride.reason } : null,
      standardRendererStatus: usableCache ? "ready-from-validated-cache" : profilePathAvailable ? "pending-exact-profile-acquisition-and-decode" : "unavailable-no-tracked-profile-path",
      manualInvestigationRequired,
      manualInvestigationReasons: [
        ...(fallbackCandidate ? ["no-tracked-profile-path"] : []),
        ...(cacheInvalid ? ["existing-cache-entry-invalid"] : []),
        ...(cropOverride ? ["existing-source-bound-crop-override-requires-revalidation"] : []),
      ],
    });
  }
  const summary = {
    cataloguePeople: registry.records.length,
    publishedManifestPeople: manifest.records.length,
    runtimePeople: runtimeIds.size,
    catalogueOnlyPeople: records.length,
    existingPublishedPeople: manifest.records.length,
    usableProfilePaths: records.filter((record) => record.profilePathAvailable).length,
    missingProfilePaths: records.filter((record) => !record.profilePathAvailable).length,
    usableExistingSourceCacheEntries: records.filter((record) => record.usableExistingCache).length,
    sourcesRequiringAcquisition: records.filter((record) => record.sourceAcquisitionRequired).length,
    expectedFallbackCandidates: records.filter((record) => record.fallbackCandidate).length,
    recordsRequiringManualInvestigation: records.filter((record) => record.manualInvestigationRequired).length,
    applicableExistingCropOverrides: records.filter((record) => record.landscapeCropOverrideApplies).length,
    newLandscapeAssetsRequired: records.length,
    newPosterAssetsRequired: records.length,
    newPortraitAssetsRequired: records.length * 2,
    projectedTitleLogoAssets: registry.records.length,
  };
  const categoryMetadataChanges = exactCategoryChanges({ registry, manifest, runtime: runtimeLookup, actorIds, directorIds });
  const futureRuntimeCounts = {
    companies: Object.keys(runtimeLookup.companies || {}).length,
    networks: Object.keys(runtimeLookup.networks || {}).length,
    people: registry.records.length,
    totalEntities: Object.keys(runtimeLookup.companies || {}).length + Object.keys(runtimeLookup.networks || {}).length + registry.records.length,
    landscapeAssets: Object.keys(runtimeLookup.companies || {}).length + Object.keys(runtimeLookup.networks || {}).length + registry.records.length,
    posterAssets: Object.keys(runtimeLookup.networks || {}).length + registry.records.length,
    totalAssets: Object.keys(runtimeLookup.companies || {}).length + 2 * Object.keys(runtimeLookup.networks || {}).length + 2 * registry.records.length,
    presentationTitleLogosExcludedFromRuntimeTotals: registry.records.length,
  };
  const audit = {
    version: PEOPLE_V3_READINESS_VERSION,
    generatedAt,
    offline: true,
    ordering: "tmdb-person-id-ascending",
    sourcePolicy: "exact-tracked-relative-tmdb-profile-path-only",
    summary,
    currentRuntimeCounts: runtimeLookup.counts,
    futureRuntimeCounts,
    reconciliation: {
      registryMissingFromManifest: registryOnlyIds,
      manifestMissingFromRegistry: setDifference(manifestIds, registryIds),
      manifestMissingFromRuntime: setDifference(manifestIds, runtimeIds),
      runtimeMissingFromManifest: setDifference(runtimeIds, manifestIds),
      runtimeMissingLandscapeFiles: setDifference(runtimeIds, landscapeIds),
      runtimeMissingPosterFiles: setDifference(runtimeIds, posterIds),
      unexpectedLandscapeFiles: setDifference(landscapeIds, manifestIds),
      unexpectedPosterFiles: setDifference(posterIds, manifestIds),
      invalidLandscapeFileNames: landscapePhysical.invalidFiles,
      invalidPosterFileNames: posterPhysical.invalidFiles,
      categoryMetadataChanges,
    },
    sourceCaches: {
      roots: cacheEvidence.summaries,
      totalIndexedEntries: cacheEvidence.entries.length,
      uniqueIndexedStableKeys: new Set(cacheEvidence.entries.map((entry) => entry.stableKey)).size,
    },
    sharedHero: protectedState.hero,
    protectedState,
    recordCount: records.length,
    records,
  };
  audit.auditFingerprint = calculateReadinessAuditFingerprint(audit);
  return audit;
}

export function calculateReadinessAuditFingerprint(audit) {
  const { generatedAt: _generatedAt, auditFingerprint: _auditFingerprint, ...payload } = audit;
  return sha256(stableStringify(payload));
}

export function validatePeopleV3ArtworkReadinessAudit(audit) {
  const errors = [];
  const summary = audit?.summary || {};
  if (audit?.recordCount !== audit?.records?.length) errors.push("readiness audit recordCount mismatch");
  if (audit?.records?.some((record, index) => index > 0 && audit.records[index - 1].tmdbPersonId >= record.tmdbPersonId)) errors.push("readiness records are not in ascending TMDB Person ID order");
  if (new Set((audit?.records || []).map((record) => record.tmdbPersonId)).size !== audit?.records?.length) errors.push("readiness audit duplicates TMDB Person IDs");
  if (summary.cataloguePeople - summary.publishedManifestPeople !== summary.catalogueOnlyPeople) errors.push("catalogue/publication set arithmetic differs from readiness count");
  if (summary.usableProfilePaths + summary.missingProfilePaths !== summary.catalogueOnlyPeople) errors.push("profile-path readiness counts do not reconcile");
  if (summary.usableExistingSourceCacheEntries + summary.sourcesRequiringAcquisition !== summary.usableProfilePaths) errors.push("source-cache and acquisition counts do not reconcile");
  if (summary.expectedFallbackCandidates !== summary.missingProfilePaths) errors.push("fallback candidates differ from missing profile paths");
  if (summary.newLandscapeAssetsRequired !== summary.catalogueOnlyPeople || summary.newPosterAssetsRequired !== summary.catalogueOnlyPeople) errors.push("net-new portrait asset counts differ from catalogue-only identities");
  if (summary.projectedTitleLogoAssets !== summary.cataloguePeople) errors.push("projected title-logo count differs from complete catalogue");
  if (audit?.auditFingerprint !== calculateReadinessAuditFingerprint(audit)) errors.push("readiness audit fingerprint mismatch");
  for (const key of ["manifestMissingFromRegistry", "manifestMissingFromRuntime", "runtimeMissingFromManifest", "runtimeMissingLandscapeFiles", "runtimeMissingPosterFiles", "unexpectedLandscapeFiles", "unexpectedPosterFiles", "invalidLandscapeFileNames", "invalidPosterFileNames"]) {
    if ((audit?.reconciliation?.[key] || []).length > 0) errors.push(`${key} is not empty`);
  }
  const future = audit?.futureRuntimeCounts || {};
  if (future.totalEntities !== future.companies + future.networks + future.people) errors.push("future runtime entity counts do not reconcile");
  if (future.landscapeAssets !== future.totalEntities) errors.push("future landscape count differs from one-per-entity policy");
  if (future.posterAssets !== future.networks + future.people) errors.push("future poster count differs from Network-and-People policy");
  if (future.totalAssets !== future.landscapeAssets + future.posterAssets) errors.push("future runtime asset total does not reconcile");
  return errors;
}

function readinessMarkdown(audit) {
  const lines = [
    "# Nuvio People v3 artwork-readiness audit",
    "",
    `Generated offline at ${audit.generatedAt}. The tracked catalogue contains ${audit.summary.cataloguePeople.toLocaleString("en-US")} people while the current publication contains ${audit.summary.publishedManifestPeople.toLocaleString("en-US")}.`,
    "",
    "## Exact delta",
    "",
    `- Catalogue-only identities: ${audit.summary.catalogueOnlyPeople}`,
    `- Usable tracked profile paths: ${audit.summary.usableProfilePaths}`,
    `- Missing tracked profile paths: ${audit.summary.missingProfilePaths}`,
    `- Usable existing cache entries: ${audit.summary.usableExistingSourceCacheEntries}`,
    `- Exact sources requiring acquisition: ${audit.summary.sourcesRequiringAcquisition}`,
    `- Expected fallback/manual-investigation candidates: ${audit.summary.expectedFallbackCandidates}`,
    `- Existing crop overrides applying to catalogue-only people: ${audit.summary.applicableExistingCropOverrides}`,
    `- New Landscape assets required: ${audit.summary.newLandscapeAssetsRequired}`,
    `- New Poster assets required: ${audit.summary.newPosterAssetsRequired}`,
    `- Future title logos required: ${audit.summary.projectedTitleLogoAssets}`,
    "",
    "## Existing published category-only updates",
    "",
    ...audit.reconciliation.categoryMetadataChanges.map((record) => `- ${record.tmdbPersonId} ${record.canonicalName}: ${record.manifestCategoriesBefore.join(" + ")} → ${record.requiredCategoriesAfter.join(" + ")}`),
    "",
    "## Future runtime totals",
    "",
    `- Companies: ${audit.futureRuntimeCounts.companies}`,
    `- Networks: ${audit.futureRuntimeCounts.networks}`,
    `- People: ${audit.futureRuntimeCounts.people}`,
    `- Total entities / Landscape assets: ${audit.futureRuntimeCounts.totalEntities}`,
    `- Poster assets: ${audit.futureRuntimeCounts.posterAssets}`,
    `- Total runtime artwork assets: ${audit.futureRuntimeCounts.totalAssets}`,
    "",
    "Title-logo PNGs and the shared hero are presentation assets and are excluded from runtime Poster/Landscape totals.",
    "",
    "## Manual-investigation identities",
    "",
    ...audit.records.filter((record) => record.manualInvestigationRequired).map((record) => `- ${record.tmdbPersonId} ${record.canonicalName}: ${record.manualInvestigationReasons.join(", ")}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function writePeopleV3ArtworkReadinessAudit({ audit, outputDir } = {}) {
  const errors = validatePeopleV3ArtworkReadinessAudit(audit);
  if (errors.length) throw new Error(`People v3 artwork readiness failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  const jsonPath = path.join(outputDir, "people-v3-artwork-readiness.json");
  const markdownPath = path.join(outputDir, "people-v3-artwork-readiness.md");
  await Promise.all([
    atomicWrite(jsonPath, `${JSON.stringify(audit, null, 2)}\n`),
    atomicWrite(markdownPath, readinessMarkdown(audit)),
  ]);
  return { jsonPath, markdownPath };
}

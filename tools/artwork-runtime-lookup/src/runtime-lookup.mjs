import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "./schema-validator.mjs";

const requireFromStudioTool = createRequire(new URL("../../studio-network-batch/package.json", import.meta.url));
const sharp = requireFromStudioTool("sharp");

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const RUNTIME_LOOKUP_PATH = "assets/collection_covers/runtime-lookup.json";
export const RUNTIME_SCHEMA_PATH = "schemas/artwork-runtime-lookup.schema.json";
export const STUDIO_MANIFEST_PATH = "assets/collection_covers/manifest.json";
export const PEOPLE_MANIFEST_PATH = "assets/collection_covers/people/manifest.json";
export const REPRESENTATIVE_REPORT_PATH = "tools/artwork-runtime-lookup/.work/representative-records.json";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CATEGORY_ORDER = ["actor", "director"];
const STUDIO_RENDER_MODES = new Set(["generated", "missing-logo", "manual-source", "owner-approved-text", "safe-source-crop"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertHash(value, label) {
  assert(typeof value === "string" && HASH_PATTERN.test(value), `${label} must be a lowercase SHA-256`);
}

function assertPositiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function assertNonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalise(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalise(value));
}

export function calculateLookupFingerprint(lookup) {
  const { fingerprint: _excluded, ...payload } = lookup;
  return sha256(canonicalJson(payload));
}

export function serialiseLookup(lookup) {
  return `${JSON.stringify(lookup)}\n`;
}

async function readJsonWithBytes(filePath) {
  const bytes = await fs.readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
  return { bytes, value };
}

function compareCategories(left, right) {
  return CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right);
}

function validateStudioManifest(manifest) {
  assert(manifest && typeof manifest === "object", "Studio/network manifest must be an object");
  assert(manifest.version === "studio-network-canonical-manifest-v1", "Unsupported studio/network manifest version");
  assert(manifest.status === "published", "Studio/network manifest must be published");
  assertHash(manifest.publishedAssetFingerprint, "Studio/network manifest fingerprint");
  assertNonNegativeInteger(manifest.entryCount, "Studio/network entryCount");
  assertNonNegativeInteger(manifest.companyCount, "Studio/network companyCount");
  assertNonNegativeInteger(manifest.networkCount, "Studio/network networkCount");
  assert(Array.isArray(manifest.entries), "Studio/network entries must be an array");
  assert(Array.isArray(manifest.publicationMetadata), "Studio/network publicationMetadata must be an array");
  assert(manifest.entries.length === manifest.entryCount, "Studio/network entries length does not match entryCount");
  assert(manifest.publicationMetadata.length === manifest.entryCount, "Studio/network publication metadata length does not match entryCount");

  const internalByKey = new Map();
  for (const entry of manifest.entries) {
    assert(typeof entry?.stable_key === "string", "Studio/network internal entry is missing stable_key");
    assert(!internalByKey.has(entry.stable_key), `Duplicate studio/network internal key ${entry.stable_key}`);
    assert(entry.review_status === "approved", `${entry.stable_key} is not approved in the published manifest`);
    internalByKey.set(entry.stable_key, entry);
  }

  const identities = new Set();
  const paths = new Set();
  let companies = 0;
  let networks = 0;
  for (const record of manifest.publicationMetadata) {
    const label = record?.stableKey ?? "studio/network record";
    assert(["company", "network"].includes(record?.entityType), `${label} has an invalid entity type`);
    assertPositiveInteger(record.tmdbId, `${label} TMDB ID`);
    assert(record.stableKey === `${record.entityType}:${record.tmdbId}`, `${label} stable key does not match its entity type and ID`);
    assert(!identities.has(record.stableKey), `Duplicate studio/network identity ${record.stableKey}`);
    identities.add(record.stableKey);
    assert(typeof record.canonicalName === "string" && record.canonicalName.length > 0, `${label} canonical name is required`);
    assert(record.status === "published", `${label} is not published`);
    assert(STUDIO_RENDER_MODES.has(record.renderMode), `${label} has unsupported render mode ${record.renderMode}`);
    const directory = record.entityType === "company" ? "companies" : "networks";
    const expectedPath = `assets/collection_covers/${directory}/${record.tmdbId}.webp`;
    assert(record.publishPath === expectedPath, `${label} publish path must be ${expectedPath}`);
    assert(!paths.has(record.publishPath), `Duplicate published path ${record.publishPath}`);
    paths.add(record.publishPath);
    assertHash(record.outputHash, `${label} output hash`);
    assertPositiveInteger(record.byteCount, `${label} byte count`);
    assert(record.width === 1200 && record.height === 675 && record.format === "webp", `${label} must be a 1200x675 WebP`);

    const internal = internalByKey.get(record.stableKey);
    assert(internal, `${label} is missing its internal manifest entry`);
    assert(internal.entity_type === record.entityType, `${label} entity type differs between manifest sections`);
    assert(internal.tmdb_id === record.tmdbId, `${label} ID differs between manifest sections`);
    assert(internal.name === record.canonicalName, `${label} name differs between manifest sections`);
    assert(internal.output_path === record.publishPath, `${label} path differs between manifest sections`);
    assert(internal.output_hash === record.outputHash, `${label} hash differs between manifest sections`);
    assert(internal.output_bytes === record.byteCount, `${label} byte count differs between manifest sections`);
    if (record.entityType === "company") companies += 1;
    else networks += 1;
  }
  assert(companies === manifest.companyCount, "Studio/network company count does not match publication metadata");
  assert(networks === manifest.networkCount, "Studio/network network count does not match publication metadata");
  assert(companies + networks === manifest.entryCount, "Studio/network total count does not match publication metadata");
}

function validatePeopleManifest(manifest) {
  assert(manifest && typeof manifest === "object", "People manifest must be an object");
  assert(manifest.version === "people-artwork-manifest-v1", "Unsupported people manifest version");
  assert(manifest.status === "published", "People manifest must be published");
  assert(manifest.ordering === "tmdb-person-id-ascending", "People manifest must use TMDB person ID ordering");
  assertHash(manifest.manifestFingerprint, "People manifest fingerprint");
  assertNonNegativeInteger(manifest.recordCount, "People recordCount");
  assertNonNegativeInteger(manifest.landscapeCount, "People landscapeCount");
  assertNonNegativeInteger(manifest.posterCount, "People posterCount");
  assertNonNegativeInteger(manifest.fallbackCount, "People fallbackCount");
  assert(Array.isArray(manifest.records), "People records must be an array");
  assert(manifest.records.length === manifest.recordCount, "People records length does not match recordCount");

  const identities = new Set();
  let landscapes = 0;
  let posters = 0;
  let fallbacks = 0;
  let previousId = 0;
  for (const record of manifest.records) {
    const label = record?.stableKey ?? "people record";
    assertPositiveInteger(record?.tmdbPersonId, `${label} TMDB person ID`);
    assert(record.stableKey === `person:${record.tmdbPersonId}`, `${label} stable key does not match its person ID`);
    assert(!identities.has(record.stableKey), `Duplicate people identity ${record.stableKey}`);
    identities.add(record.stableKey);
    assert(record.tmdbPersonId > previousId, "People manifest records are not ordered by ascending numeric TMDB ID");
    previousId = record.tmdbPersonId;
    assert(typeof record.canonicalName === "string" && record.canonicalName.length > 0, `${label} canonical name is required`);
    assert(Array.isArray(record.categoryMembership) && record.categoryMembership.length >= 1 && record.categoryMembership.length <= 2, `${label} category membership is invalid`);
    assert(new Set(record.categoryMembership).size === record.categoryMembership.length, `${label} category membership contains duplicates`);
    assert(record.categoryMembership.every((category) => CATEGORY_ORDER.includes(category)), `${label} category membership contains an unsupported value`);
    assert(JSON.stringify(record.categoryMembership) === JSON.stringify([...record.categoryMembership].sort(compareCategories)), `${label} category membership is not in actor/director order`);
    assert(typeof record.fallbackUsed === "boolean", `${label} fallbackUsed must be boolean`);

    const expectedLandscape = `assets/collection_covers/people/landscape/${record.tmdbPersonId}.webp`;
    const expectedPoster = `assets/collection_covers/people/poster/${record.tmdbPersonId}.webp`;
    assert(record.landscapePath === expectedLandscape, `${label} landscape path must be ${expectedLandscape}`);
    assert(record.posterPath === expectedPoster, `${label} poster path must be ${expectedPoster}`);
    assertHash(record.landscapeHash, `${label} landscape hash`);
    assertHash(record.posterHash, `${label} poster hash`);
    assertPositiveInteger(record.landscapeByteCount, `${label} landscape byte count`);
    assertPositiveInteger(record.posterByteCount, `${label} poster byte count`);
    landscapes += 1;
    posters += 1;
    if (record.fallbackUsed) fallbacks += 1;
  }
  assert(landscapes === manifest.landscapeCount, "People landscape count does not match records");
  assert(posters === manifest.posterCount, "People poster count does not match records");
  assert(fallbacks === manifest.fallbackCount, "People fallback count does not match records");
}

function toAssetRecords(studioManifest, peopleManifest) {
  return [
    ...studioManifest.publicationMetadata.map((record) => ({
      label: record.stableKey,
      relativePath: record.publishPath,
      expectedHash: record.outputHash,
      expectedBytes: record.byteCount,
      width: 1200,
      height: 675,
    })),
    ...peopleManifest.records.flatMap((record) => [
      {
        label: `${record.stableKey}:landscape`,
        relativePath: record.landscapePath,
        expectedHash: record.landscapeHash,
        expectedBytes: record.landscapeByteCount,
        width: 1200,
        height: 675,
      },
      {
        label: `${record.stableKey}:poster`,
        relativePath: record.posterPath,
        expectedHash: record.posterHash,
        expectedBytes: record.posterByteCount,
        width: 1000,
        height: 1500,
      },
    ]),
  ];
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function verifyPublishedAssets(assetRecords, repoRoot, concurrency) {
  const paths = new Set();
  for (const record of assetRecords) {
    assert(!path.isAbsolute(record.relativePath), `${record.label} uses an absolute path`);
    assert(!record.relativePath.includes("://"), `${record.label} uses a URL instead of a repository-relative path`);
    assert(!paths.has(record.relativePath), `Duplicate runtime asset path ${record.relativePath}`);
    paths.add(record.relativePath);
  }

  await mapWithConcurrency(assetRecords, concurrency, async (record) => {
    const localPath = path.join(repoRoot, ...record.relativePath.split("/"));
    let bytes;
    try {
      bytes = await fs.readFile(localPath);
    } catch (error) {
      throw new Error(`${record.label} asset is missing or unreadable at ${record.relativePath}: ${error.message}`);
    }
    assert(bytes.length === record.expectedBytes, `${record.label} byte count mismatch at ${record.relativePath}`);
    assert(sha256(bytes) === record.expectedHash, `${record.label} SHA-256 mismatch at ${record.relativePath}`);
    let metadata;
    let decoded;
    try {
      metadata = await sharp(bytes, { failOn: "error", limitInputPixels: false }).metadata();
      decoded = await sharp(bytes, { failOn: "error", limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw new Error(`${record.label} WebP decode failed at ${record.relativePath}: ${error.message}`);
    }
    assert(metadata.format === "webp", `${record.label} is not WebP at ${record.relativePath}`);
    assert(metadata.width === record.width && metadata.height === record.height, `${record.label} dimensions mismatch at ${record.relativePath}`);
    assert(decoded.info.width === record.width && decoded.info.height === record.height, `${record.label} decoded dimensions mismatch at ${record.relativePath}`);
  });
}

function toStudioEntry(record) {
  return {
    id: record.tmdbId,
    name: record.canonicalName,
    status: "published",
    landscape: {
      path: record.publishPath,
      sha256: record.outputHash,
    },
    fallbackUsed: record.renderMode === "missing-logo",
    reviewRequired: false,
  };
}

function toPeopleEntry(record) {
  return {
    id: record.tmdbPersonId,
    name: record.canonicalName,
    categories: [...record.categoryMembership].sort(compareCategories),
    status: "published",
    landscape: {
      path: record.landscapePath,
      sha256: record.landscapeHash,
    },
    poster: {
      path: record.posterPath,
      sha256: record.posterHash,
    },
    fallbackUsed: record.fallbackUsed,
    reviewRequired: false,
  };
}

function numericMap(records, idKey, mapper) {
  const result = {};
  for (const record of [...records].sort((left, right) => left[idKey] - right[idKey])) {
    const id = record[idKey];
    assert(!Object.hasOwn(result, String(id)), `Duplicate numeric ID ${id}`);
    result[String(id)] = mapper(record);
  }
  return result;
}

function createLookup(studioManifest, peopleManifest, sourceHashes) {
  const companyRecords = studioManifest.publicationMetadata.filter((record) => record.entityType === "company");
  const networkRecords = studioManifest.publicationMetadata.filter((record) => record.entityType === "network");
  const companies = numericMap(companyRecords, "tmdbId", toStudioEntry);
  const networks = numericMap(networkRecords, "tmdbId", toStudioEntry);
  const people = numericMap(peopleManifest.records, "tmdbPersonId", toPeopleEntry);
  const counts = {
    companies: companyRecords.length,
    networks: networkRecords.length,
    people: peopleManifest.records.length,
    totalEntities: companyRecords.length + networkRecords.length + peopleManifest.records.length,
    landscapeAssets: companyRecords.length + networkRecords.length + peopleManifest.records.length,
    posterAssets: peopleManifest.records.length,
    totalAssets: companyRecords.length + networkRecords.length + (peopleManifest.records.length * 2),
  };
  const payload = {
    schemaVersion: 1,
    status: "published",
    generatedFrom: {
      studioNetworkManifest: {
        path: STUDIO_MANIFEST_PATH,
        sha256: sourceHashes.studio,
        fingerprint: studioManifest.publishedAssetFingerprint,
      },
      peopleManifest: {
        path: PEOPLE_MANIFEST_PATH,
        sha256: sourceHashes.people,
        fingerprint: peopleManifest.manifestFingerprint,
      },
    },
    counts,
    formats: {
      company: {
        landscape: { width: 1200, height: 675 },
        poster: null,
      },
      network: {
        landscape: { width: 1200, height: 675 },
        poster: null,
      },
      person: {
        landscape: { width: 1200, height: 675 },
        poster: { width: 1000, height: 1500 },
      },
    },
    companies,
    networks,
    people,
  };
  const fingerprint = calculateLookupFingerprint(payload);
  return {
    schemaVersion: payload.schemaVersion,
    status: payload.status,
    fingerprint,
    generatedFrom: payload.generatedFrom,
    counts: payload.counts,
    formats: payload.formats,
    companies: payload.companies,
    networks: payload.networks,
    people: payload.people,
  };
}

function collectRuntimeErrors(lookup) {
  const errors = [];
  const paths = new Set();
  const counts = { companies: 0, networks: 0, people: 0, landscapeAssets: 0, posterAssets: 0 };
  const groups = [
    ["companies", lookup.companies ?? {}, false],
    ["networks", lookup.networks ?? {}, false],
    ["people", lookup.people ?? {}, true],
  ];
  for (const [groupName, entries, hasPoster] of groups) {
    let previousId = 0;
    for (const [key, entry] of Object.entries(entries)) {
      const id = Number(key);
      if (!Number.isSafeInteger(id) || id <= 0) errors.push(`${groupName}.${key} is not a positive numeric key`);
      if (entry?.id !== id) errors.push(`${groupName}.${key} key does not match entry ID ${entry?.id}`);
      if (id <= previousId) errors.push(`${groupName} keys are not in ascending numeric order`);
      previousId = id;
      if (entry?.status !== "published") errors.push(`${groupName}.${key} is not published`);
      if (entry?.reviewRequired !== false) errors.push(`${groupName}.${key} requires review`);
      if (typeof entry?.landscape?.path === "string") {
        const expectedLandscape = groupName === "people"
          ? `assets/collection_covers/people/landscape/${id}.webp`
          : `assets/collection_covers/${groupName}/${id}.webp`;
        if (entry.landscape.path !== expectedLandscape) errors.push(`${groupName}.${key} landscape path must be ${expectedLandscape}`);
        if (path.isAbsolute(entry.landscape.path) || entry.landscape.path.includes("://")) errors.push(`${groupName}.${key} landscape path is not repository-relative`);
        if (paths.has(entry.landscape.path)) errors.push(`Duplicate runtime path ${entry.landscape.path}`);
        paths.add(entry.landscape.path);
        counts.landscapeAssets += 1;
      }
      if (hasPoster && typeof entry?.poster?.path === "string") {
        const expectedPoster = `assets/collection_covers/people/poster/${id}.webp`;
        if (entry.poster.path !== expectedPoster) errors.push(`${groupName}.${key} poster path must be ${expectedPoster}`);
        if (path.isAbsolute(entry.poster.path) || entry.poster.path.includes("://")) errors.push(`${groupName}.${key} poster path is not repository-relative`);
        if (paths.has(entry.poster.path)) errors.push(`Duplicate runtime path ${entry.poster.path}`);
        paths.add(entry.poster.path);
        counts.posterAssets += 1;
      }
      if (hasPoster && Array.isArray(entry?.categories)) {
        if (JSON.stringify(entry.categories) !== JSON.stringify([...entry.categories].sort(compareCategories))) errors.push(`${groupName}.${key} categories are not in actor/director order`);
      }
      counts[groupName] += 1;
    }
  }
  const expectedCounts = {
    companies: counts.companies,
    networks: counts.networks,
    people: counts.people,
    totalEntities: counts.companies + counts.networks + counts.people,
    landscapeAssets: counts.landscapeAssets,
    posterAssets: counts.posterAssets,
    totalAssets: counts.landscapeAssets + counts.posterAssets,
  };
  if (JSON.stringify(lookup.counts) !== JSON.stringify(expectedCounts)) errors.push("Runtime counts do not match the entity maps");
  if (lookup.fingerprint !== calculateLookupFingerprint(lookup)) errors.push("Runtime fingerprint does not match the canonical payload");
  return errors;
}

export function validateRuntimeLookup(lookup, schema) {
  const errors = [
    ...validateAgainstSchema(lookup, schema),
    ...collectRuntimeErrors(lookup),
  ];
  if (errors.length > 0) throw new Error(`Runtime lookup validation failed:\n- ${errors.join("\n- ")}`);
  return true;
}

export async function generateRuntimeLookup({
  repoRoot = REPO_ROOT,
  studioManifestPath = path.join(repoRoot, ...STUDIO_MANIFEST_PATH.split("/")),
  peopleManifestPath = path.join(repoRoot, ...PEOPLE_MANIFEST_PATH.split("/")),
  schemaPath = path.join(repoRoot, ...RUNTIME_SCHEMA_PATH.split("/")),
  verifyAssets = true,
  assetConcurrency = 6,
} = {}) {
  const [studioSource, peopleSource, schemaSource] = await Promise.all([
    readJsonWithBytes(studioManifestPath),
    readJsonWithBytes(peopleManifestPath),
    readJsonWithBytes(schemaPath),
  ]);
  validateStudioManifest(studioSource.value);
  validatePeopleManifest(peopleSource.value);
  const assetRecords = toAssetRecords(studioSource.value, peopleSource.value);
  if (verifyAssets) await verifyPublishedAssets(assetRecords, repoRoot, assetConcurrency);
  const lookup = createLookup(studioSource.value, peopleSource.value, {
    studio: sha256(studioSource.bytes),
    people: sha256(peopleSource.bytes),
  });
  validateRuntimeLookup(lookup, schemaSource.value);
  return {
    lookup,
    schema: schemaSource.value,
    assetCount: assetRecords.length,
    sourceManifestHashes: lookup.generatedFrom,
  };
}

export async function writeIfChanged(filePath, content) {
  const bytes = Buffer.from(content, "utf8");
  try {
    const current = await fs.readFile(filePath);
    if (current.equals(bytes)) return { changed: false, bytes: bytes.length, sha256: sha256(bytes) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return { changed: true, bytes: bytes.length, sha256: sha256(bytes) };
}

function firstEntry(entries, predicate) {
  const match = Object.values(entries).find(predicate);
  assert(match, "Unable to select a representative runtime record");
  return match;
}

export function createRepresentativeReport(lookup) {
  let absentId = 999_999_999;
  while (Object.hasOwn(lookup.companies, String(absentId))) absentId += 1;
  return {
    schemaVersion: 1,
    lookupFingerprint: lookup.fingerprint,
    generatedFrom: lookup.generatedFrom,
    examples: {
      logoBasedCompany: firstEntry(lookup.companies, (entry) => !entry.fallbackUsed),
      textFallbackCompany: firstEntry(lookup.companies, (entry) => entry.fallbackUsed),
      network: firstEntry(lookup.networks, (entry) => !entry.fallbackUsed),
      actorOnlyPerson: firstEntry(lookup.people, (entry) => entry.categories.length === 1 && entry.categories[0] === "actor"),
      directorOnlyPerson: firstEntry(lookup.people, (entry) => entry.categories.length === 1 && entry.categories[0] === "director"),
      actorDirectorPerson: firstEntry(lookup.people, (entry) => entry.categories.length === 2),
      absentId: {
        entityType: "company",
        id: absentId,
        available: false,
      },
    },
  };
}

export function runtimeSummary(lookup, fileResult = {}) {
  const companyValues = Object.values(lookup.companies);
  const networkValues = Object.values(lookup.networks);
  const peopleValues = Object.values(lookup.people);
  return {
    valid: true,
    schemaVersion: lookup.schemaVersion,
    fingerprint: lookup.fingerprint,
    fileSha256: fileResult.sha256,
    fileBytes: fileResult.bytes,
    changed: fileResult.changed,
    counts: lookup.counts,
    fallbackCounts: {
      companies: companyValues.filter((entry) => entry.fallbackUsed).length,
      networks: networkValues.filter((entry) => entry.fallbackUsed).length,
      people: peopleValues.filter((entry) => entry.fallbackUsed).length,
    },
    peopleCategories: {
      actorOnly: peopleValues.filter((entry) => entry.categories.length === 1 && entry.categories[0] === "actor").length,
      directorOnly: peopleValues.filter((entry) => entry.categories.length === 1 && entry.categories[0] === "director").length,
      actorDirector: peopleValues.filter((entry) => entry.categories.length === 2).length,
    },
    generatedFrom: lookup.generatedFrom,
  };
}

export async function validateRuntimeFile({ repoRoot = REPO_ROOT, lookupPath, verifyAssets = true } = {}) {
  const resolvedLookupPath = lookupPath ?? path.join(repoRoot, ...RUNTIME_LOOKUP_PATH.split("/"));
  const [{ lookup: expected, schema, assetCount }, actualBytes] = await Promise.all([
    generateRuntimeLookup({ repoRoot, verifyAssets }),
    fs.readFile(resolvedLookupPath),
  ]);
  let actual;
  try {
    actual = JSON.parse(actualBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Runtime lookup is invalid JSON: ${error.message}`);
  }
  validateRuntimeLookup(actual, schema);
  const expectedBytes = Buffer.from(serialiseLookup(expected), "utf8");
  assert(actualBytes.equals(expectedBytes), "Runtime lookup bytes do not exactly match the deterministic published-manifest build");
  return {
    lookup: actual,
    assetCount,
    fileResult: { changed: false, bytes: actualBytes.length, sha256: sha256(actualBytes) },
  };
}

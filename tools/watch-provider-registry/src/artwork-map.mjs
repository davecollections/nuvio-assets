import fs from "node:fs/promises";
import path from "node:path";

import { readJson } from "./registry.mjs";
import { validateAgainstSchema } from "./schema-validator.mjs";

export const ARTWORK_MAP_VERSION = "watch-provider-artwork-map-v1";

const PROVIDER_KEY_PATTERN = /^provider:([1-9][0-9]*)$/u;
const ARTWORK_PATH_PATTERN = /^assets\/collection_covers\/(companies|networks|providers)\/[1-9][0-9]*\.webp$/u;
const TOP_LEVEL_FIELDS = ["version", "providers"];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseProviderId(providerKey) {
  const match = PROVIDER_KEY_PATTERN.exec(providerKey);
  assert(match, `${providerKey} is not a valid provider key.`);
  const providerId = Number(match[1]);
  assert(Number.isSafeInteger(providerId) && providerId > 0, `${providerKey} does not contain a positive safe TMDB provider ID.`);
  return providerId;
}

function mediaCoverage(provider) {
  const movie = Object.hasOwn(provider.media, "movie");
  const tv = Object.hasOwn(provider.media, "tv");
  if (movie && tv) return "both";
  return movie ? "movie" : "tv";
}

export function serializeArtworkMap(artworkMap) {
  return Buffer.from(`${JSON.stringify(artworkMap, null, 2)}\n`, "utf8");
}

export function validateCanonicalArtworkMap(artworkMap, schema) {
  const schemaErrors = validateAgainstSchema(artworkMap, schema, "artworkMap");
  assert(schemaErrors.length === 0, `Watch Provider artwork map schema validation failed:\n${schemaErrors.join("\n")}`);
  assert(JSON.stringify(Object.keys(artworkMap)) === JSON.stringify(TOP_LEVEL_FIELDS), "Artwork map field order must be version, providers.");

  let previousProviderId = 0;
  for (const [providerKey, artworkPath] of Object.entries(artworkMap.providers)) {
    const providerId = parseProviderId(providerKey);
    assert(providerId > previousProviderId, "Artwork map provider keys must be strictly ascending numerically.");
    assert(ARTWORK_PATH_PATTERN.test(artworkPath), `${providerKey} has an invalid artwork path.`);
    previousProviderId = providerId;
  }
  return true;
}

async function pathExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function assertArtworkMapCheck(report) {
  assert(report.summary.brokenMappings === 0, `Artwork check found ${report.summary.brokenMappings} broken mapping(s).`);
  return true;
}

export async function checkArtworkMap(options = {}) {
  const { repoRoot } = options;
  assert(typeof repoRoot === "string" && repoRoot.length > 0, "A repository root is required.");
  const artworkMapPath = options.artworkMapPath ?? path.join(repoRoot, "data", "watch-providers", "artwork-map.json");
  const schemaPath = options.schemaPath ?? path.join(repoRoot, "schemas", "watch-provider-artwork-map.schema.json");
  const registryPath = options.registryPath ?? path.join(repoRoot, "data", "watch-providers", "registry.json");
  const manifestPath = options.manifestPath ?? path.join(repoRoot, "assets", "collection_covers", "manifest.json");
  const [loadedMap, loadedSchema, loadedRegistry, loadedManifest] = await Promise.all([
    readJson(artworkMapPath, "Watch Provider artwork map"),
    readJson(schemaPath, "Watch Provider artwork map schema"),
    readJson(registryPath, "Watch Provider registry"),
    readJson(manifestPath, "published Studio/Network manifest"),
  ]);

  validateCanonicalArtworkMap(loadedMap.value, loadedSchema.value);
  const canonicalBytes = serializeArtworkMap(loadedMap.value);
  assert(loadedMap.bytes.equals(canonicalBytes), "Watch Provider artwork map bytes are not canonical two-space LF JSON with one trailing LF.");
  assert(Array.isArray(loadedRegistry.value?.providers), "Watch Provider registry must contain a providers array.");
  assert(Array.isArray(loadedManifest.value?.entries), "Published Studio/Network manifest must contain an entries array.");

  const registryProviders = new Map(loadedRegistry.value.providers.map((provider) => [provider.stableKey, provider]));
  const publishedPaths = new Set(loadedManifest.value.entries.map((entry) => entry.output_path));
  const mappingEntries = Object.entries(loadedMap.value.providers);
  const pathCounts = new Map();
  for (const [, artworkPath] of mappingEntries) pathCounts.set(artworkPath, (pathCounts.get(artworkPath) ?? 0) + 1);

  const brokenMappings = (await Promise.all(mappingEntries.map(async ([providerKey, artworkPath]) => {
    const reasons = [];
    if (!registryProviders.has(providerKey)) reasons.push("provider does not exist in data/watch-providers/registry.json");
    const assetPath = path.join(repoRoot, ...artworkPath.split("/"));
    if (!(await pathExists(assetPath))) reasons.push("mapped artwork file does not exist");
    if (/^assets\/collection_covers\/(?:companies|networks)\//u.test(artworkPath) && !publishedPaths.has(artworkPath)) {
      reasons.push("path is absent from the published Studio/Network manifest");
    }
    return reasons.length === 0 ? null : { providerKey, mappedPath: artworkPath, reason: reasons.join("; ") };
  }))).filter(Boolean);

  const unmappedProviders = loadedRegistry.value.providers
    .filter((provider) => !Object.hasOwn(loadedMap.value.providers, provider.stableKey))
    .sort((left, right) => left.tmdbWatchProviderId - right.tmdbWatchProviderId)
    .map((provider) => ({
      providerId: provider.tmdbWatchProviderId,
      name: provider.name,
      mediaCoverage: mediaCoverage(provider),
      logoPath: provider.logoPath,
      status: "unmapped / awaiting artwork review",
    }));

  const mappedProviders = loadedRegistry.value.providers.length - unmappedProviders.length;
  return {
    summary: {
      totalProviders: loadedRegistry.value.providers.length,
      mappedProviders,
      unmappedProviders: unmappedProviders.length,
      brokenMappings: brokenMappings.length,
      uniqueImagePaths: pathCounts.size,
      sharedImagePaths: [...pathCounts.values()].filter((count) => count > 1).length,
    },
    unmappedProviders,
    brokenMappings,
  };
}

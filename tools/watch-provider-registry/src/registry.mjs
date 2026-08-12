import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "./schema-validator.mjs";

export const REGISTRY_VERSION = "watch-provider-registry-v1";
export const WORKER_BASE_URL = "https://tmdb-id-lookup-proxy.dpegan20.workers.dev";
export const SOURCE_ROUTES = Object.freeze({
  regions: "/3/watch/providers/regions?language=en-US",
  movie: "/3/watch/providers/movie?language=en-US",
  tv: "/3/watch/providers/tv?language=en-US",
});

const REGION_CODE_PATTERN = /^[A-Z]{2}$/u;
const LOGO_PATH_PATTERN = /^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/u;
const MEDIA_ORDER = ["movie", "tv"];
const TOP_LEVEL_FIELDS = ["version", "regions", "providers"];
const REGION_FIELDS = ["code", "englishName", "nativeName"];
const PROVIDER_FIELDS = ["stableKey", "tmdbWatchProviderId", "name", "logoPath", "media"];
const MEDIA_FIELDS = ["displayPriority", "regionalPriorities"];
const SOURCE_REGION_FIELDS = ["iso_3166_1", "english_name", "native_name"];
const SOURCE_PROVIDER_FIELDS = ["display_priorities", "display_priority", "logo_path", "provider_name", "provider_id"];
const TRANSIENT_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  assert(isPlainObject(value), `${label} must be an object.`);
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(keys) === JSON.stringify(wanted), `${label} fields changed: expected ${wanted.join(", ")}; received ${keys.join(", ")}.`);
}

function assertNonEmptyString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string.`);
}

function assertPositiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer.`);
}

function assertPriority(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer.`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateResponse(payload, label) {
  assertExactKeys(payload, ["results"], `${label} response`);
  assert(Array.isArray(payload.results), `${label} response.results must be an array.`);
  return payload.results;
}

function normalizedPriorityMap(value, label) {
  assert(isPlainObject(value), `${label} must be an object.`);
  const result = {};
  for (const code of Object.keys(value).sort()) {
    assert(REGION_CODE_PATTERN.test(code), `${label}.${code} has an invalid Region code.`);
    assertPriority(value[code], `${label}.${code}`);
    result[code] = value[code];
  }
  return result;
}

export function normalizeRegions(payload) {
  const rows = validateResponse(payload, "Regions");
  const seen = new Set();
  const regions = rows.map((row, index) => {
    const label = `Regions results[${index}]`;
    assertExactKeys(row, SOURCE_REGION_FIELDS, label);
    assert(typeof row.iso_3166_1 === "string" && REGION_CODE_PATTERN.test(row.iso_3166_1), `${label}.iso_3166_1 must be an uppercase two-letter Region code.`);
    assertNonEmptyString(row.english_name, `${label}.english_name`);
    assertNonEmptyString(row.native_name, `${label}.native_name`);
    assert(!seen.has(row.iso_3166_1), `Duplicate Region code ${row.iso_3166_1}.`);
    seen.add(row.iso_3166_1);
    return {
      code: row.iso_3166_1,
      englishName: row.english_name,
      nativeName: row.native_name,
    };
  });
  return regions.sort((left, right) => compareText(left.code, right.code));
}

export function normalizeProviders(payload, mediaType) {
  assert(MEDIA_ORDER.includes(mediaType), `Unsupported media type ${mediaType}.`);
  const label = mediaType === "movie" ? "Movie providers" : "TV providers";
  const rows = validateResponse(payload, label);
  const seen = new Set();
  return rows.map((row, index) => {
    const rowLabel = `${label} results[${index}]`;
    assertExactKeys(row, SOURCE_PROVIDER_FIELDS, rowLabel);
    assertPositiveInteger(row.provider_id, `${rowLabel}.provider_id`);
    assert(!seen.has(row.provider_id), `Duplicate ${mediaType} provider ID ${row.provider_id}.`);
    seen.add(row.provider_id);
    assert(typeof row.provider_name === "string" && row.provider_name.trim().length > 0, `${rowLabel}.provider_name must contain a name.`);
    assert(row.logo_path === null || (typeof row.logo_path === "string" && LOGO_PATH_PATTERN.test(row.logo_path)), `${rowLabel}.logo_path must be null or a relative TMDB image path.`);
    assertPriority(row.display_priority, `${rowLabel}.display_priority`);
    return {
      id: row.provider_id,
      name: row.provider_name.trim(),
      logoPath: row.logo_path,
      mediaType,
      member: {
        displayPriority: row.display_priority,
        regionalPriorities: normalizedPriorityMap(row.display_priorities, `${rowLabel}.display_priorities`),
      },
    };
  });
}

function mergeProviderRows(movieRows, tvRows) {
  const merged = new Map();
  for (const row of [...movieRows, ...tvRows]) {
    const current = merged.get(row.id);
    if (!current) {
      merged.set(row.id, {
        id: row.id,
        name: row.name,
        logoPath: row.logoPath,
        media: { [row.mediaType]: row.member },
      });
      continue;
    }
    assert(current.name === row.name, `Cross-media name conflict for provider:${row.id}: ${JSON.stringify(current.name)} versus ${JSON.stringify(row.name)}.`);
    if (current.logoPath !== null && row.logoPath !== null) {
      assert(current.logoPath === row.logoPath, `Cross-media logo-path conflict for provider:${row.id}: ${JSON.stringify(current.logoPath)} versus ${JSON.stringify(row.logoPath)}.`);
    }
    if (current.logoPath === null && row.logoPath !== null) current.logoPath = row.logoPath;
    current.media[row.mediaType] = row.member;
  }

  return [...merged.values()]
    .sort((left, right) => left.id - right.id)
    .map((row) => {
      const media = {};
      for (const mediaType of MEDIA_ORDER) if (row.media[mediaType]) media[mediaType] = row.media[mediaType];
      return {
        stableKey: `provider:${row.id}`,
        tmdbWatchProviderId: row.id,
        name: row.name,
        logoPath: row.logoPath,
        media,
      };
    });
}

export function buildRegistry(sourcePayloads) {
  assertExactKeys(sourcePayloads, ["regions", "movie", "tv"], "Source payload collection");
  const regions = normalizeRegions(sourcePayloads.regions);
  const movieRows = normalizeProviders(sourcePayloads.movie, "movie");
  const tvRows = normalizeProviders(sourcePayloads.tv, "tv");
  const providers = mergeProviderRows(movieRows, tvRows);
  assert(regions.length > 0, "Regions response must contain at least one row.");
  assert(providers.length > 0, "Provider responses must contain at least one provider.");
  return {
    registry: {
      version: REGISTRY_VERSION,
      regions,
      providers,
    },
    sourceCounts: {
      regions: sourcePayloads.regions.results.length,
      movie: sourcePayloads.movie.results.length,
      tv: sourcePayloads.tv.results.length,
    },
  };
}

function assertFieldOrder(value, expected, label) {
  const keys = Object.keys(value);
  assert(JSON.stringify(keys) === JSON.stringify(expected), `${label} field order must be ${expected.join(", ")}.`);
}

export function validateCanonicalRegistry(registry, schema) {
  const schemaErrors = validateAgainstSchema(registry, schema, "registry");
  assert(schemaErrors.length === 0, `Canonical registry schema validation failed:\n${schemaErrors.join("\n")}`);
  assertFieldOrder(registry, TOP_LEVEL_FIELDS, "Registry");

  const regionCodes = new Set();
  let previousRegion = "";
  for (const region of registry.regions) {
    assertFieldOrder(region, REGION_FIELDS, `Region ${region.code}`);
    assert(region.code > previousRegion, "Region codes must be strictly ascending.");
    assert(!regionCodes.has(region.code), `Duplicate canonical Region code ${region.code}.`);
    regionCodes.add(region.code);
    previousRegion = region.code;
  }

  const providerIds = new Set();
  let previousProviderId = 0;
  for (const provider of registry.providers) {
    const label = provider.stableKey;
    assertFieldOrder(provider, PROVIDER_FIELDS, label);
    assertPositiveInteger(provider.tmdbWatchProviderId, `${label} TMDB Watch Provider ID`);
    assert(provider.stableKey === `provider:${provider.tmdbWatchProviderId}`, `${label} stable key does not match its TMDB Watch Provider ID.`);
    assert(provider.tmdbWatchProviderId > previousProviderId, "Provider IDs must be strictly ascending numerically.");
    assert(!providerIds.has(provider.tmdbWatchProviderId), `Duplicate canonical provider ID ${provider.tmdbWatchProviderId}.`);
    providerIds.add(provider.tmdbWatchProviderId);
    previousProviderId = provider.tmdbWatchProviderId;
    const mediaKeys = Object.keys(provider.media);
    assert(mediaKeys.length > 0, `${label} must have at least one media member.`);
    assert(JSON.stringify(mediaKeys) === JSON.stringify(MEDIA_ORDER.filter((mediaType) => Object.hasOwn(provider.media, mediaType))), `${label} media keys must be ordered movie then tv.`);
    for (const mediaType of mediaKeys) {
      const member = provider.media[mediaType];
      assertFieldOrder(member, MEDIA_FIELDS, `${label}.${mediaType}`);
      assertPriority(member.displayPriority, `${label}.${mediaType}.displayPriority`);
      const regionalCodes = Object.keys(member.regionalPriorities);
      assert(JSON.stringify(regionalCodes) === JSON.stringify([...regionalCodes].sort()), `${label}.${mediaType} regional priorities must be ordered by Region code.`);
      for (const code of regionalCodes) assertPriority(member.regionalPriorities[code], `${label}.${mediaType}.regionalPriorities.${code}`);
    }
  }
  return true;
}

export function serializeRegistry(registry) {
  return Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export function deriveDiagnostics(registry) {
  const canonicalCodes = new Set(registry.regions.map((region) => region.code));
  const providerCodes = new Set();
  for (const provider of registry.providers) {
    for (const mediaType of MEDIA_ORDER) {
      for (const code of Object.keys(provider.media[mediaType]?.regionalPriorities ?? {})) providerCodes.add(code);
    }
  }
  return {
    mapOnlyRegionCodes: [...providerCodes].filter((code) => !canonicalCodes.has(code)).sort(),
  };
}

export function registryStats(registry) {
  let movieOnly = 0;
  let tvOnly = 0;
  let both = 0;
  for (const provider of registry.providers) {
    const movie = Object.hasOwn(provider.media, "movie");
    const tv = Object.hasOwn(provider.media, "tv");
    if (movie && tv) both += 1;
    else if (movie) movieOnly += 1;
    else tvOnly += 1;
  }
  return {
    regions: registry.regions.length,
    providers: registry.providers.length,
    movieOnly,
    tvOnly,
    both,
  };
}

function change(type, details = {}) {
  return { type, ...details };
}

function compareMedia(previousProvider, candidateProvider, mediaType, meaningful, informational) {
  const previous = previousProvider.media[mediaType];
  const candidate = candidateProvider.media[mediaType];
  const stableKey = candidateProvider.stableKey;
  if (!previous && candidate) {
    meaningful.push(change("media-membership-added", { stableKey, mediaType }));
    return;
  }
  if (previous && !candidate) {
    meaningful.push(change("media-membership-removed", { stableKey, mediaType }));
    return;
  }
  if (!previous || !candidate) return;
  if (previous.displayPriority !== candidate.displayPriority) {
    informational.push(change("global-priority-changed", { stableKey, mediaType, previous: previous.displayPriority, candidate: candidate.displayPriority }));
  }
  const codes = [...new Set([...Object.keys(previous.regionalPriorities), ...Object.keys(candidate.regionalPriorities)])].sort();
  for (const code of codes) {
    const had = Object.hasOwn(previous.regionalPriorities, code);
    const has = Object.hasOwn(candidate.regionalPriorities, code);
    if (!had && has) meaningful.push(change("regional-availability-added", { stableKey, mediaType, code }));
    else if (had && !has) meaningful.push(change("regional-availability-removed", { stableKey, mediaType, code }));
    else if (previous.regionalPriorities[code] !== candidate.regionalPriorities[code]) {
      informational.push(change("regional-priority-changed", {
        stableKey,
        mediaType,
        code,
        previous: previous.regionalPriorities[code],
        candidate: candidate.regionalPriorities[code],
      }));
    }
  }
}

export function diffRegistries(previousRegistry, candidateRegistry) {
  const previous = previousRegistry ?? { version: REGISTRY_VERSION, regions: [], providers: [] };
  const meaningful = [];
  const informational = [];
  const previousRegions = new Map(previous.regions.map((region) => [region.code, region]));
  const candidateRegions = new Map(candidateRegistry.regions.map((region) => [region.code, region]));
  for (const code of [...new Set([...previousRegions.keys(), ...candidateRegions.keys()])].sort()) {
    const before = previousRegions.get(code);
    const after = candidateRegions.get(code);
    if (!before) meaningful.push(change("region-added", { code }));
    else if (!after) meaningful.push(change("region-removed", { code }));
    else if (before.englishName !== after.englishName || before.nativeName !== after.nativeName) {
      meaningful.push(change("region-name-changed", { code, previous: { englishName: before.englishName, nativeName: before.nativeName }, candidate: { englishName: after.englishName, nativeName: after.nativeName } }));
    }
  }

  const previousProviders = new Map(previous.providers.map((provider) => [provider.tmdbWatchProviderId, provider]));
  const candidateProviders = new Map(candidateRegistry.providers.map((provider) => [provider.tmdbWatchProviderId, provider]));
  const ids = [...new Set([...previousProviders.keys(), ...candidateProviders.keys()])].sort((left, right) => left - right);
  for (const id of ids) {
    const before = previousProviders.get(id);
    const after = candidateProviders.get(id);
    if (!before) {
      meaningful.push(change("provider-added", { stableKey: after.stableKey }));
      continue;
    }
    if (!after) {
      meaningful.push(change("provider-removed", { stableKey: before.stableKey }));
      continue;
    }
    if (before.name !== after.name) meaningful.push(change("provider-name-changed", { stableKey: after.stableKey, previous: before.name, candidate: after.name }));
    if (before.logoPath !== after.logoPath) meaningful.push(change("provider-logo-path-changed", { stableKey: after.stableKey, previous: before.logoPath, candidate: after.logoPath }));
    for (const mediaType of MEDIA_ORDER) compareMedia(before, after, mediaType, meaningful, informational);
  }

  for (const code of deriveDiagnostics(candidateRegistry).mapOnlyRegionCodes) {
    informational.push(change("map-only-region-code", { code }));
  }
  return { meaningful, informational };
}

export function summarizeChanges(diff) {
  const countTypes = (entries) => Object.fromEntries([...entries.reduce((counts, entry) => counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1), new Map())].sort(([left], [right]) => compareText(left, right)));
  return {
    meaningful: { total: diff.meaningful.length, byType: countTypes(diff.meaningful) },
    informational: { total: diff.informational.length, byType: countTypes(diff.informational) },
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_ERRORS.has(error.code) || attempt >= 5) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

async function atomicWrite(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, bytes);
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeRegistryIfChanged(filePath, candidateBytes, existingBytes = null) {
  let current = existingBytes;
  if (current === null) {
    try {
      current = await fs.readFile(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (current && current.equals(candidateBytes)) return { changed: false, wrote: false };
  await atomicWrite(filePath, candidateBytes);
  return { changed: true, wrote: true };
}

async function responseJson(response, label) {
  assert(response && typeof response === "object", `${label} request returned no response.`);
  assert(response.ok === true, `${label} request failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    fail(`${label} request returned invalid JSON.`);
  }
}

export async function fetchSourcePayloads({ serviceToken, fetchImpl = globalThis.fetch, baseUrl = WORKER_BASE_URL }) {
  assert(typeof serviceToken === "string" && serviceToken.length > 0, "NUVIO_PEOPLE_SERVICE_TOKEN is required for a live refresh.");
  assert(typeof fetchImpl === "function", "A fetch implementation is required.");
  const entries = Object.entries(SOURCE_ROUTES);
  const responses = await Promise.all(entries.map(async ([label, route]) => {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        method: "GET",
        redirect: "error",
        headers: { "X-Nuvio-Service-Token": serviceToken },
      });
    } catch {
      fail(`${label} catalogue request failed.`);
    }
    return [label, await responseJson(response, label)];
  }));
  return {
    requestCount: entries.length,
    payloads: Object.fromEntries(responses),
  };
}

async function readJson(filePath, label) {
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`, { cause: error });
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }
}

async function readExistingRegistry(filePath, schema) {
  let loaded;
  try {
    loaded = await readJson(filePath, "Watch Provider registry");
  } catch (error) {
    if (error.cause?.code === "ENOENT") return null;
    throw error;
  }
  validateCanonicalRegistry(loaded.value, schema);
  const canonicalBytes = serializeRegistry(loaded.value);
  assert(loaded.bytes.equals(canonicalBytes), "Existing Watch Provider registry bytes are not canonical LF JSON.");
  return loaded;
}

export async function refreshRegistry({ repoRoot, serviceToken, fetchImpl = globalThis.fetch, write = true }) {
  const registryPath = path.join(repoRoot, "data", "watch-providers", "registry.json");
  const schemaPath = path.join(repoRoot, "schemas", "watch-provider-registry.schema.json");
  const { value: schema } = await readJson(schemaPath, "Watch Provider registry schema");
  const fetched = await fetchSourcePayloads({ serviceToken, fetchImpl });
  const generated = buildRegistry(fetched.payloads);
  validateCanonicalRegistry(generated.registry, schema);
  const candidateBytes = serializeRegistry(generated.registry);
  const repeatedBytes = serializeRegistry(buildRegistry(fetched.payloads).registry);
  assert(candidateBytes.equals(repeatedBytes), "Repeated generation from captured source input was not byte-identical.");
  const existing = await readExistingRegistry(registryPath, schema);
  const diff = diffRegistries(existing?.value ?? null, generated.registry);
  const wouldChange = !existing?.bytes?.equals(candidateBytes);
  const writeResult = write
    ? await writeRegistryIfChanged(registryPath, candidateBytes, existing?.bytes ?? null)
    : { changed: wouldChange, wrote: false };
  return {
    registry: generated.registry,
    requestCount: fetched.requestCount,
    sourceCounts: generated.sourceCounts,
    canonicalCounts: registryStats(generated.registry),
    diagnostics: deriveDiagnostics(generated.registry),
    identityConflictCount: 0,
    canonicalByteSize: candidateBytes.length,
    deterministicByteParity: candidateBytes.equals(repeatedBytes),
    diff,
    changeSummary: summarizeChanges(diff),
    changed: writeResult.changed,
    wrote: writeResult.wrote,
  };
}

export async function checkRegistry({ repoRoot }) {
  const registryPath = path.join(repoRoot, "data", "watch-providers", "registry.json");
  const schemaPath = path.join(repoRoot, "schemas", "watch-provider-registry.schema.json");
  const [{ value: schema }, loaded] = await Promise.all([
    readJson(schemaPath, "Watch Provider registry schema"),
    readJson(registryPath, "Watch Provider registry"),
  ]);
  validateCanonicalRegistry(loaded.value, schema);
  const canonicalBytes = serializeRegistry(loaded.value);
  assert(loaded.bytes.equals(canonicalBytes), "Watch Provider registry bytes are not canonical LF JSON.");
  return {
    canonicalCounts: registryStats(loaded.value),
    diagnostics: deriveDiagnostics(loaded.value),
    canonicalByteSize: loaded.bytes.length,
    deterministicByteParity: canonicalBytes.equals(serializeRegistry(loaded.value)),
  };
}

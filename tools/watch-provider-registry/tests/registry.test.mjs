import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildRegistry,
  deriveDiagnostics,
  diffRegistries,
  fetchSourcePayloads,
  normalizeProviders,
  normalizeRegions,
  registryStats,
  serializeRegistry,
  summarizeChanges,
  validateCanonicalRegistry,
  writeRegistryIfChanged,
} from "../src/registry.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "watch-provider-registry.schema.json"), "utf8"));

function region(code, englishName = `English ${code}`, nativeName = `Native ${code}`) {
  return { iso_3166_1: code, english_name: englishName, native_name: nativeName };
}

function provider(id, name, displayPriority, regionalPriorities, logoPath = `/${id}.jpg`) {
  return {
    display_priorities: regionalPriorities,
    display_priority: displayPriority,
    logo_path: logoPath,
    provider_name: name,
    provider_id: id,
  };
}

function fixture() {
  return {
    regions: { results: [region("US", "United States", "United States"), region("CA", "Canada", "Canada")] },
    movie: {
      results: [
        provider(10, "Movie only", 7, { US: 4, CA: 6 }),
        provider(8, " Shared service ", 0, { US: 0, GG: 2, CA: 1 }, "/shared.png"),
      ],
    },
    tv: {
      results: [
        provider(3, "TV only", 5, { US: 9 }),
        provider(8, "Shared service", 1, { US: 3, CA: 2 }, "/shared.png"),
      ],
    },
  };
}

function generated(source = fixture()) {
  const result = buildRegistry(source);
  validateCanonicalRegistry(result.registry, schema);
  return result.registry;
}

function clone(value) {
  return structuredClone(value);
}

test("normalizes and orders Regions without closing provider maps against them", () => {
  const regions = normalizeRegions(fixture().regions);
  assert.deepEqual(regions, [
    { code: "CA", englishName: "Canada", nativeName: "Canada" },
    { code: "US", englishName: "United States", nativeName: "United States" },
  ]);
  assert.deepEqual(deriveDiagnostics(generated()).mapOnlyRegionCodes, ["GG"]);
});

test("builds Movie-only, TV-only, and shared providers with explicit independent media", () => {
  const registry = generated();
  assert.deepEqual(registry.providers.map((record) => record.tmdbWatchProviderId), [3, 8, 10]);
  assert.deepEqual(Object.keys(registry.providers[0].media), ["tv"]);
  assert.deepEqual(Object.keys(registry.providers[1].media), ["movie", "tv"]);
  assert.deepEqual(Object.keys(registry.providers[2].media), ["movie"]);
  assert.deepEqual(registryStats(registry), { regions: 2, providers: 3, movieOnly: 1, tvOnly: 1, both: 1 });
});

test("preserves global and regional priorities in canonical key order", () => {
  const shared = generated().providers.find((record) => record.tmdbWatchProviderId === 8);
  assert.equal(shared.media.movie.displayPriority, 0);
  assert.equal(shared.media.tv.displayPriority, 1);
  assert.deepEqual(Object.keys(shared.media.movie.regionalPriorities), ["CA", "GG", "US"]);
  assert.deepEqual(shared.media.movie.regionalPriorities, { CA: 1, GG: 2, US: 0 });
});

test("uses numeric provider ordering and stable provider identity", () => {
  for (const record of generated().providers) assert.equal(record.stableKey, `provider:${record.tmdbWatchProviderId}`);
});

test("rejects duplicate Regions and malformed Region rows", () => {
  assert.throws(() => normalizeRegions({ results: [region("US"), region("US")] }), /Duplicate Region code US/u);
  assert.throws(() => normalizeRegions({ results: [{ iso_3166_1: "usa", english_name: "US", native_name: "US" }] }), /uppercase two-letter/u);
  assert.throws(() => normalizeRegions({ results: [{ iso_3166_1: "US", english_name: "US" }] }), /fields changed/u);
});

test("rejects duplicate provider IDs and malformed provider rows", () => {
  assert.throws(() => normalizeProviders({ results: [provider(8, "A", 0, {}), provider(8, "A", 0, {})] }, "movie"), /Duplicate movie provider ID 8/u);
  const malformed = provider(8, "A", 0, {});
  delete malformed.logo_path;
  assert.throws(() => normalizeProviders({ results: [malformed] }, "movie"), /fields changed/u);
});

test("rejects invalid provider IDs and priorities", () => {
  assert.throws(() => normalizeProviders({ results: [provider(0, "A", 0, {})] }, "movie"), /positive safe integer/u);
  assert.throws(() => normalizeProviders({ results: [provider(Number.MAX_SAFE_INTEGER + 1, "A", 0, {})] }, "movie"), /positive safe integer/u);
  assert.throws(() => normalizeProviders({ results: [provider(8, "A", -1, {})] }, "movie"), /non-negative safe integer/u);
  assert.throws(() => normalizeProviders({ results: [provider(8, "A", 0, { US: 1.5 })] }, "movie"), /non-negative safe integer/u);
});

test("surfaces unexpected source response and row fields", () => {
  assert.throws(() => normalizeRegions({ results: [], page: 1 }), /fields changed/u);
  const drifted = provider(8, "A", 0, {});
  drifted.new_field = true;
  assert.throws(() => normalizeProviders({ results: [drifted] }, "tv"), /fields changed/u);
});

test("rejects cross-media name and logo conflicts", () => {
  const names = fixture();
  names.tv.results[1].provider_name = "Different";
  assert.throws(() => buildRegistry(names), /Cross-media name conflict/u);
  const logos = fixture();
  logos.tv.results[1].logo_path = "/different.png";
  assert.throws(() => buildRegistry(logos), /Cross-media logo-path conflict/u);
});

test("accepts one null cross-media logo and retains the applicable source path", () => {
  const source = fixture();
  source.tv.results[1].logo_path = null;
  assert.equal(generated(source).providers.find((record) => record.tmdbWatchProviderId === 8).logoPath, "/shared.png");
});

test("serializes deterministically with two spaces and one trailing LF", () => {
  const first = serializeRegistry(generated());
  const second = serializeRegistry(generated());
  assert.ok(first.equals(second));
  assert.equal(first.at(-1), 10);
  assert.notEqual(first.at(-2), 10);
  assert.match(first.toString("utf8"), /\n  "regions":/u);
});

test("schema and semantic validation reject stable-key drift and noncanonical ordering", () => {
  const badKey = clone(generated());
  badKey.providers[0].stableKey = "provider:99";
  assert.throws(() => validateCanonicalRegistry(badKey, schema), /stable key does not match/u);
  const badOrder = clone(generated());
  badOrder.providers.reverse();
  assert.throws(() => validateCanonicalRegistry(badOrder, schema), /strictly ascending/u);
});

test("diff classifies Region, provider, name, logo, membership, and availability changes as meaningful", () => {
  const before = generated();
  const after = clone(before);
  after.regions[0].englishName = "Changed Canada";
  const shared = after.providers.find((record) => record.tmdbWatchProviderId === 8);
  shared.name = "Renamed service";
  shared.logoPath = "/renamed.png";
  delete shared.media.tv;
  delete shared.media.movie.regionalPriorities.GG;
  after.providers = after.providers.filter((record) => record.tmdbWatchProviderId !== 10);
  const diff = diffRegistries(before, after);
  const types = new Set(diff.meaningful.map((entry) => entry.type));
  for (const type of ["region-name-changed", "provider-name-changed", "provider-logo-path-changed", "media-membership-removed", "regional-availability-removed", "provider-removed"]) assert.ok(types.has(type), type);
});

test("diff classifies priority changes and map-only codes as informational", () => {
  const before = generated();
  const after = clone(before);
  const shared = after.providers.find((record) => record.tmdbWatchProviderId === 8);
  shared.media.movie.displayPriority = 9;
  shared.media.movie.regionalPriorities.US = 8;
  const diff = diffRegistries(before, after);
  assert.deepEqual(new Set(diff.informational.map((entry) => entry.type)), new Set(["global-priority-changed", "regional-priority-changed", "map-only-region-code"]));
  assert.equal(summarizeChanges(diff).informational.total, 3);
});

test("diff detects Movie removal, TV removal, and total provider removal", () => {
  const before = generated();
  const movieRemoved = clone(before);
  delete movieRemoved.providers.find((record) => record.tmdbWatchProviderId === 8).media.movie;
  assert.ok(diffRegistries(before, movieRemoved).meaningful.some((entry) => entry.type === "media-membership-removed" && entry.mediaType === "movie"));
  const tvRemoved = clone(before);
  delete tvRemoved.providers.find((record) => record.tmdbWatchProviderId === 8).media.tv;
  assert.ok(diffRegistries(before, tvRemoved).meaningful.some((entry) => entry.type === "media-membership-removed" && entry.mediaType === "tv"));
  const providerRemoved = clone(before);
  providerRemoved.providers = providerRemoved.providers.filter((record) => record.tmdbWatchProviderId !== 8);
  assert.ok(diffRegistries(before, providerRemoved).meaningful.some((entry) => entry.type === "provider-removed"));
});

test("write-only-if-changed preserves an existing canonical file and modification time", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-provider-noop-"));
  try {
    const filePath = path.join(temporaryRoot, "registry.json");
    const bytes = serializeRegistry(generated());
    await fs.writeFile(filePath, bytes);
    const before = await fs.stat(filePath);
    const result = await writeRegistryIfChanged(filePath, bytes);
    const after = await fs.stat(filePath);
    assert.deepEqual(result, { changed: false, wrote: false });
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.ok((await fs.readFile(filePath)).equals(bytes));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("changed output is atomically replaced with canonical bytes", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-provider-write-"));
  try {
    const filePath = path.join(temporaryRoot, "registry.json");
    await fs.writeFile(filePath, "old\n");
    const bytes = serializeRegistry(generated());
    assert.deepEqual(await writeRegistryIfChanged(filePath, bytes), { changed: true, wrote: true });
    assert.ok((await fs.readFile(filePath)).equals(bytes));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("live source acquisition performs exactly the three approved authenticated requests", async () => {
  const calls = [];
  const source = fixture();
  const result = await fetchSourcePayloads({
    serviceToken: "test-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const key = url.includes("/regions?") ? "regions" : url.includes("/movie?") ? "movie" : "tv";
      return { ok: true, status: 200, json: async () => source[key] };
    },
  });
  assert.equal(result.requestCount, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/3/watch/providers/regions",
    "/3/watch/providers/movie",
    "/3/watch/providers/tv",
  ]);
  assert.ok(calls.every((call) => call.options.headers["X-Nuvio-Service-Token"] === "test-token"));
  assert.ok(calls.every((call) => call.options.redirect === "error"));
});

test("live source acquisition fails before requests when the token is unavailable", async () => {
  let calls = 0;
  await assert.rejects(fetchSourcePayloads({ serviceToken: "", fetchImpl: async () => { calls += 1; } }), /NUVIO_PEOPLE_SERVICE_TOKEN is required/u);
  assert.equal(calls, 0);
});

test("malformed source generation cannot alter an existing canonical file", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-provider-failure-"));
  try {
    const filePath = path.join(temporaryRoot, "registry.json");
    const bytes = serializeRegistry(generated());
    await fs.writeFile(filePath, bytes);
    const source = fixture();
    source.movie.results[0].display_priority = -1;
    assert.throws(() => buildRegistry(source), /non-negative safe integer/u);
    assert.ok((await fs.readFile(filePath)).equals(bytes));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

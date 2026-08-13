import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARTWORK_MAP_VERSION,
  assertArtworkMapCheck,
  checkArtworkMap,
  serializeArtworkMap,
  validateCanonicalArtworkMap,
} from "../src/artwork-map.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "watch-provider-artwork-map.schema.json"), "utf8"));
const NETWORK_PATH = "assets/collection_covers/networks/213.webp";

function provider(id, name, media, logoPath = `/${id}.jpg`) {
  return {
    stableKey: `provider:${id}`,
    tmdbWatchProviderId: id,
    name,
    logoPath,
    media: Object.fromEntries(media.map((mediaType) => [mediaType, {}])),
  };
}

const fixtureProviders = [
  provider(8, "Netflix", ["movie", "tv"]),
  provider(9, "Amazon Prime Video", ["movie"]),
  provider(21, "Stan", ["tv"]),
];

function artworkMap(providers = { "provider:8": NETWORK_PATH }) {
  return { version: ARTWORK_MAP_VERSION, providers };
}

async function fixture({
  map = artworkMap(),
  rawMapBytes = serializeArtworkMap(map),
  registryProviders = fixtureProviders,
  manifestPaths = [NETWORK_PATH],
  files = [NETWORK_PATH],
} = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-provider-artwork-map-"));
  await Promise.all([
    fs.mkdir(path.join(temporaryRoot, "data", "watch-providers"), { recursive: true }),
    fs.mkdir(path.join(temporaryRoot, "schemas"), { recursive: true }),
    fs.mkdir(path.join(temporaryRoot, "assets", "collection_covers"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(temporaryRoot, "data", "watch-providers", "artwork-map.json"), rawMapBytes),
    fs.writeFile(path.join(temporaryRoot, "data", "watch-providers", "registry.json"), `${JSON.stringify({ providers: registryProviders }, null, 2)}\n`),
    fs.writeFile(path.join(temporaryRoot, "schemas", "watch-provider-artwork-map.schema.json"), `${JSON.stringify(schema, null, 2)}\n`),
    fs.writeFile(path.join(temporaryRoot, "assets", "collection_covers", "manifest.json"), `${JSON.stringify({ entries: manifestPaths.map((outputPath) => ({ output_path: outputPath })) }, null, 2)}\n`),
  ]);
  for (const relativePath of files) {
    const filePath = path.join(temporaryRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "fixture");
  }
  return temporaryRoot;
}

async function withFixture(options, callback) {
  const temporaryRoot = await fixture(options);
  try {
    return await callback(temporaryRoot);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("valid direct map passes and unmapped providers remain normal", async () => {
  await withFixture({}, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assertArtworkMapCheck(report);
    assert.deepEqual(report.summary, {
      totalProviders: 3,
      mappedProviders: 1,
      unmappedProviders: 2,
      brokenMappings: 0,
      uniqueImagePaths: 1,
      sharedImagePaths: 0,
    });
    assert.equal(report.summary.mappedProviders + report.summary.unmappedProviders, report.summary.totalProviders);
    assert.deepEqual(report.unmappedProviders.map((entry) => [entry.providerId, entry.mediaCoverage]), [[9, "movie"], [21, "tv"]]);
    assert.ok(report.unmappedProviders.every((entry) => entry.status === "unmapped / awaiting artwork review"));
  });
});

test("schema enforces the exact version and top-level shape", () => {
  assert.throws(
    () => validateCanonicalArtworkMap({ version: "wrong", providers: {} }, schema),
    /must equal "watch-provider-artwork-map-v1"/u,
  );
  assert.throws(
    () => validateCanonicalArtworkMap({ version: ARTWORK_MAP_VERSION, providers: {}, generatedAt: "never" }, schema),
    /additional property is not allowed/u,
  );
  assert.throws(
    () => validateCanonicalArtworkMap({ version: ARTWORK_MAP_VERSION }, schema),
    /providers: is required/u,
  );
});

test("malformed provider keys and outside artwork paths fail", () => {
  assert.throws(
    () => validateCanonicalArtworkMap(artworkMap({ "provider:0": NETWORK_PATH }), schema),
    /must match \^provider/u,
  );
  assert.throws(
    () => validateCanonicalArtworkMap(artworkMap({ "provider:8": "assets/other/8.webp" }), schema),
    /must match \^assets/u,
  );
});

test("an unknown registry provider is a broken mapping", async () => {
  const map = artworkMap({ "provider:999": NETWORK_PATH });
  await withFixture({ map }, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assert.equal(report.summary.brokenMappings, 1);
    assert.match(report.brokenMappings[0].reason, /does not exist in data\/watch-providers\/registry\.json/u);
    assert.throws(() => assertArtworkMapCheck(report), /1 broken mapping/u);
  });
});

test("a missing mapped file is a broken mapping", async () => {
  await withFixture({ files: [] }, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assert.equal(report.brokenMappings[0].providerKey, "provider:8");
    assert.equal(report.brokenMappings[0].mappedPath, NETWORK_PATH);
    assert.match(report.brokenMappings[0].reason, /file does not exist/u);
    assert.throws(() => assertArtworkMapCheck(report), /broken mapping/u);
  });
});

test("a company or network path absent from the published manifest is broken", async () => {
  await withFixture({ manifestPaths: [] }, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assert.match(report.brokenMappings[0].reason, /absent from the published Studio\/Network manifest/u);
    assert.throws(() => assertArtworkMapCheck(report), /broken mapping/u);
  });
});

test("shared duplicate paths pass and are reported once as reused", async () => {
  const map = artworkMap({ "provider:8": NETWORK_PATH, "provider:9": NETWORK_PATH });
  await withFixture({ map }, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assertArtworkMapCheck(report);
    assert.equal(report.summary.mappedProviders, 2);
    assert.equal(report.summary.uniqueImagePaths, 1);
    assert.equal(report.summary.sharedImagePaths, 1);
  });
});

test("future provider-specific paths require a file but no Studio/Network manifest entry", async () => {
  const providerPath = "assets/collection_covers/providers/8.webp";
  const map = artworkMap({ "provider:8": providerPath });
  await withFixture({ map, manifestPaths: [], files: [providerPath] }, async (temporaryRoot) => {
    const report = await checkArtworkMap({ repoRoot: temporaryRoot });
    assertArtworkMapCheck(report);
  });
});

test("numeric ordering and canonical two-space LF bytes are enforced", async () => {
  const unordered = artworkMap({ "provider:9": NETWORK_PATH, "provider:8": NETWORK_PATH });
  await withFixture({ map: unordered }, async (temporaryRoot) => {
    await assert.rejects(checkArtworkMap({ repoRoot: temporaryRoot }), /strictly ascending numerically/u);
  });

  const canonical = artworkMap();
  await withFixture({ map: canonical, rawMapBytes: Buffer.from(JSON.stringify(canonical), "utf8") }, async (temporaryRoot) => {
    await assert.rejects(checkArtworkMap({ repoRoot: temporaryRoot }), /not canonical two-space LF JSON with one trailing LF/u);
  });
});

test("the production seed keeps representative mappings while 149 and 175 remain unmapped", async () => {
  const productionMap = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "watch-providers", "artwork-map.json"), "utf8"));
  assert.equal(productionMap.providers["provider:8"], "assets/collection_covers/networks/213.webp");
  assert.equal(productionMap.providers["provider:187"], "assets/collection_covers/companies/4.webp");
  assert.equal(productionMap.providers["provider:2750"], "assets/collection_covers/networks/5428.webp");
  assert.equal(Object.hasOwn(productionMap.providers, "provider:149"), false);
  assert.equal(Object.hasOwn(productionMap.providers, "provider:175"), false);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  REPO_ROOT,
  calculateLookupFingerprint,
  generateRuntimeLookup,
  serialiseLookup,
  validateRuntimeLookup,
} from "../src/runtime-lookup.mjs";

const requireFromStudioTool = createRequire(new URL("../../studio-network-batch/package.json", import.meta.url));
const sharp = requireFromStudioTool("sharp");
const schemaSourcePath = path.join(REPO_ROOT, "schemas", "artwork-runtime-lookup.schema.json");
const schemaV2SourcePath = path.join(REPO_ROOT, "schemas", "artwork-runtime-lookup-v2.schema.json");
const schemaV2 = JSON.parse(await fs.readFile(schemaV2SourcePath, "utf8"));
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const V1_STUDIO_MANIFEST_SHA256 = "f712e5ed508d1c5c15baa85fcece8f06e7e96b96cd4e018e9a9bbd3703ecbf4d";
const PEOPLE_MANIFEST_SHA256 = "74f80ecf75619c39744939ac9e9d45eafb555702774c6e32cc72fcc05332b513";

let currentBuild;
let fixtureRoot;

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function expectedCurrentReleaseCounts(schemaVersion) {
  assert.ok([1, 2].includes(schemaVersion), `Unsupported current runtime schemaVersion ${schemaVersion}`);
  return {
    companies: 1820,
    networks: 572,
    people: 817,
    totalEntities: 3209,
    landscapeAssets: 3209,
    posterAssets: schemaVersion === 2 ? 1389 : 817,
    totalAssets: schemaVersion === 2 ? 4598 : 4026,
  };
}

function assertArtwork(artwork, expectedPath) {
  assert.deepEqual(Object.keys(artwork), ["path", "sha256"]);
  assert.equal(artwork.path, expectedPath);
  assert.match(artwork.sha256, HASH_PATTERN);
}

function assertCurrentReleaseLookup(lookup, { assetCount } = {}) {
  const expectedCounts = expectedCurrentReleaseCounts(lookup.schemaVersion);
  const companies = Object.values(lookup.companies);
  const networks = Object.values(lookup.networks);
  const people = Object.values(lookup.people);
  assert.equal(companies.length, expectedCounts.companies);
  assert.equal(networks.length, expectedCounts.networks);
  assert.equal(people.length, expectedCounts.people);

  assert.deepEqual(lookup.formats.company, {
    landscape: { width: 1200, height: 675 },
    poster: null,
  });
  assert.deepEqual(lookup.formats.network, {
    landscape: { width: 1200, height: 675 },
    poster: lookup.schemaVersion === 2 ? { width: 1000, height: 1500 } : null,
  });
  assert.deepEqual(lookup.formats.person, {
    landscape: { width: 1200, height: 675 },
    poster: { width: 1000, height: 1500 },
  });

  for (const company of companies) {
    assert.deepEqual(Object.keys(company), [
      "id", "name", "status", "landscape", "fallbackUsed", "reviewRequired",
    ]);
    assertArtwork(company.landscape, `assets/collection_covers/companies/${company.id}.webp`);
    assert.equal(Object.hasOwn(company, "poster"), false);
  }
  for (const network of networks) {
    const expectedFields = lookup.schemaVersion === 2
      ? ["id", "name", "status", "landscape", "poster", "fallbackUsed", "reviewRequired"]
      : ["id", "name", "status", "landscape", "fallbackUsed", "reviewRequired"];
    assert.deepEqual(Object.keys(network), expectedFields);
    assertArtwork(network.landscape, `assets/collection_covers/networks/${network.id}.webp`);
    if (lookup.schemaVersion === 2) {
      assertArtwork(network.poster, `assets/collection_covers/networks/poster/${network.id}.webp`);
    } else {
      assert.equal(Object.hasOwn(network, "poster"), false);
    }
  }
  for (const person of people) {
    assert.deepEqual(Object.keys(person), [
      "id", "name", "categories", "status", "landscape", "poster", "fallbackUsed", "reviewRequired",
    ]);
    assertArtwork(person.landscape, `assets/collection_covers/people/landscape/${person.id}.webp`);
    assertArtwork(person.poster, `assets/collection_covers/people/poster/${person.id}.webp`);
  }

  const derivedCounts = {
    companies: companies.length,
    networks: networks.length,
    people: people.length,
    totalEntities: companies.length + networks.length + people.length,
    landscapeAssets: [...companies, ...networks, ...people]
      .filter((entry) => Object.hasOwn(entry, "landscape")).length,
    posterAssets: [...companies, ...networks, ...people]
      .filter((entry) => Object.hasOwn(entry, "poster")).length,
  };
  derivedCounts.totalAssets = derivedCounts.landscapeAssets + derivedCounts.posterAssets;
  assert.deepEqual(derivedCounts, expectedCounts);
  assert.deepEqual(lookup.counts, derivedCounts);
  if (assetCount !== undefined) assert.equal(assetCount, derivedCounts.totalAssets);

  assert.match(lookup.generatedFrom.studioNetworkManifest.sha256, HASH_PATTERN);
  if (lookup.schemaVersion === 1) {
    assert.equal(lookup.generatedFrom.studioNetworkManifest.sha256, V1_STUDIO_MANIFEST_SHA256);
  } else {
    assert.notEqual(lookup.generatedFrom.studioNetworkManifest.sha256, V1_STUDIO_MANIFEST_SHA256);
  }
  assert.equal(lookup.generatedFrom.peopleManifest.sha256, PEOPLE_MANIFEST_SHA256);
}

function createIsolatedCurrentReleaseV2Lookup() {
  const lookup = structuredClone(currentBuild.lookup);
  lookup.schemaVersion = 2;
  lookup.generatedFrom.studioNetworkManifest.sha256 = "c".repeat(64);
  lookup.generatedFrom.studioNetworkManifest.fingerprint = "d".repeat(64);
  lookup.formats.network.poster = { width: 1000, height: 1500 };
  for (const [key, network] of Object.entries(lookup.networks)) {
    lookup.networks[key] = {
      id: network.id,
      name: network.name,
      status: network.status,
      landscape: network.landscape,
      poster: {
        path: `assets/collection_covers/networks/poster/${network.id}.webp`,
        sha256: hash(Buffer.from(`network-poster:${network.id}`)),
      },
      fallbackUsed: network.fallbackUsed,
      reviewRequired: network.reviewRequired,
    };
  }
  lookup.counts = expectedCurrentReleaseCounts(2);
  lookup.fingerprint = calculateLookupFingerprint(lookup);
  return lookup;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function makeWebp(width, height, colour) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: colour,
    },
  }).webp({ quality: 80 }).toBuffer();
}

async function createPublishedFixture(root) {
  const landscape = await makeWebp(1200, 675, { r: 8, g: 20, b: 28, alpha: 1 });
  const poster = await makeWebp(1000, 1500, { r: 228, g: 231, b: 233, alpha: 1 });
  const studioRecords = [
    { entityType: "company", tmdbId: 2, canonicalName: "Logo Company", renderMode: "generated" },
    { entityType: "company", tmdbId: 10, canonicalName: "Fallback Company", renderMode: "missing-logo" },
    { entityType: "network", tmdbId: 3, canonicalName: "Logo Network", renderMode: "generated" },
    { entityType: "network", tmdbId: 11, canonicalName: "Fallback Network", renderMode: "missing-logo" },
  ].map((record) => {
    const directory = record.entityType === "company" ? "companies" : "networks";
    return {
      ...record,
      stableKey: `${record.entityType}:${record.tmdbId}`,
      publishPath: `assets/collection_covers/${directory}/${record.tmdbId}.webp`,
      outputHash: hash(landscape),
      byteCount: landscape.length,
      width: 1200,
      height: 675,
      format: "webp",
      status: "published",
    };
  });
  const studioManifest = {
    version: "studio-network-canonical-manifest-v1",
    status: "published",
    publishedAssetFingerprint: "a".repeat(64),
    entryCount: studioRecords.length,
    companyCount: 2,
    networkCount: 2,
    entries: studioRecords.map((record) => ({
      stable_key: record.stableKey,
      entity_type: record.entityType,
      tmdb_id: record.tmdbId,
      name: record.canonicalName,
      output_path: record.publishPath,
      output_hash: record.outputHash,
      output_bytes: record.byteCount,
      status: "generated",
      review_status: "approved",
    })),
    publicationMetadata: studioRecords,
  };

  const peopleRecords = [
    { tmdbPersonId: 4, canonicalName: "Actor Person", categoryMembership: ["actor"] },
    { tmdbPersonId: 5, canonicalName: "Director Person", categoryMembership: ["director"] },
    { tmdbPersonId: 6, canonicalName: "Overlap Person", categoryMembership: ["actor", "director"] },
  ].map((record) => ({
    ...record,
    stableKey: `person:${record.tmdbPersonId}`,
    fallbackUsed: false,
    landscapePath: `assets/collection_covers/people/landscape/${record.tmdbPersonId}.webp`,
    landscapeHash: hash(landscape),
    landscapeByteCount: landscape.length,
    posterPath: `assets/collection_covers/people/poster/${record.tmdbPersonId}.webp`,
    posterHash: hash(poster),
    posterByteCount: poster.length,
  }));
  const peopleManifest = {
    version: "people-artwork-manifest-v1",
    status: "published",
    ordering: "tmdb-person-id-ascending",
    manifestFingerprint: "b".repeat(64),
    recordCount: peopleRecords.length,
    landscapeCount: peopleRecords.length,
    posterCount: peopleRecords.length,
    fallbackCount: 0,
    records: peopleRecords,
  };

  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.copyFile(schemaSourcePath, path.join(root, "schemas", "artwork-runtime-lookup.schema.json"));
  await writeJson(path.join(root, "assets", "collection_covers", "manifest.json"), studioManifest);
  await writeJson(path.join(root, "assets", "collection_covers", "people", "manifest.json"), peopleManifest);
  for (const record of studioRecords) {
    const output = path.join(root, ...record.publishPath.split("/"));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, landscape);
  }
  for (const record of peopleRecords) {
    for (const [relativePath, bytes] of [[record.landscapePath, landscape], [record.posterPath, poster]]) {
      const output = path.join(root, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
  }
}

async function copyFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-runtime-lookup-case-"));
  await fs.cp(fixtureRoot, root, { recursive: true });
  return root;
}

before(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-runtime-lookup-fixture-"));
  await createPublishedFixture(fixtureRoot);
  currentBuild = await generateRuntimeLookup({ assetConcurrency: 8 });
});

after(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

test("generates the current release only from published manifests and verifies every asset", () => {
  const { lookup, assetCount } = currentBuild;
  assertCurrentReleaseLookup(lookup, { assetCount });
});

test("emits exact compact company and network shapes with published fallback state", () => {
  const { companies, networks } = currentBuild.lookup;
  const company = Object.values(companies)[0];
  const network = Object.values(networks)[0];
  assertCurrentReleaseLookup(currentBuild.lookup, { assetCount: currentBuild.assetCount });
  assert.equal(company.status, "published");
  assert.equal(network.status, "published");
  assert.equal(Object.values(companies).filter((entry) => entry.fallbackUsed).length, 486);
  assert.equal(Object.values(networks).filter((entry) => entry.fallbackUsed).length, 1);
  assert.equal(companies["6760"].fallbackUsed, true);
  assert.equal(companies["6760"].landscape.sha256, "6ea668541581a67fbed7932bb4683205b776494b088eecbe7fa64077d3e22ac2");
});

test("strict current-release assertions accept an isolated schema-v2 runtime with 572 mandatory network posters", () => {
  const lookup = createIsolatedCurrentReleaseV2Lookup();
  assert.equal(validateRuntimeLookup(lookup, schemaV2), true);
  assertCurrentReleaseLookup(lookup, { assetCount: 4598 });
  assert.equal(Object.values(lookup.networks).every((network) =>
    Object.hasOwn(network, "poster")), true);
});

test("strict current-release assertions reject malformed schema-v2 network posters", () => {
  const firstNetworkId = Object.keys(currentBuild.lookup.networks)[0];
  const cases = [
    {
      name: "missing poster",
      mutate(lookup) {
        delete lookup.networks[firstNetworkId].poster;
      },
      error: /poster is required/u,
    },
    {
      name: "wrong poster path",
      mutate(lookup) {
        lookup.networks[firstNetworkId].poster.path =
          `assets/collection_covers/networks/poster/${Number(firstNetworkId) + 1}.webp`;
      },
      error: /poster path must be/u,
    },
    {
      name: "invalid poster SHA-256",
      mutate(lookup) {
        lookup.networks[firstNetworkId].poster.sha256 = "INVALID";
      },
      error: /must match|SHA-256/iu,
    },
  ];
  for (const { name, mutate, error } of cases) {
    const lookup = createIsolatedCurrentReleaseV2Lookup();
    mutate(lookup);
    lookup.fingerprint = calculateLookupFingerprint(lookup);
    assert.throws(() => validateRuntimeLookup(lookup, schemaV2), error, name);
    assert.throws(() => assertCurrentReleaseLookup(lookup, { assetCount: 4598 }), undefined, name);
  }
});

test("emits actor-only, director-only, and shared-category people in canonical order", () => {
  const people = Object.values(currentBuild.lookup.people);
  const actor = people.find((entry) => entry.categories.length === 1 && entry.categories[0] === "actor");
  const director = people.find((entry) => entry.categories.length === 1 && entry.categories[0] === "director");
  const overlap = people.find((entry) => entry.categories.length === 2);
  assert(actor);
  assert(director);
  assert.deepEqual(overlap.categories, ["actor", "director"]);
  assert.deepEqual(Object.keys(actor), ["id", "name", "categories", "status", "landscape", "poster", "fallbackUsed", "reviewRequired"]);
  assert.equal(people.filter((entry) => entry.fallbackUsed).length, 0);
});

test("sorts numeric object keys rather than their string representation", async () => {
  const keys = Object.keys(currentBuild.lookup.companies).map(Number);
  assert.deepEqual(keys, [...keys].sort((left, right) => left - right));
  const fixture = serialiseLookup((await generateRuntimeLookup({ repoRoot: fixtureRoot })).lookup);
  const companySection = fixture.slice(fixture.indexOf('"companies":{'), fixture.indexOf(',"networks":{'));
  assert(companySection.indexOf('"2":') < companySection.indexOf('"10":'));
});

test("uses relative paths only and leaks neither aliases nor removed identity text", () => {
  const serialised = serialiseLookup(currentBuild.lookup);
  for (const group of [currentBuild.lookup.companies, currentBuild.lookup.networks, currentBuild.lookup.people]) {
    for (const entry of Object.values(group)) {
      for (const orientation of [entry.landscape, entry.poster].filter(Boolean)) {
        assert.equal(path.isAbsolute(orientation.path), false);
        assert.equal(orientation.path.includes("://"), false);
      }
      assert.equal(Object.hasOwn(entry, "aliases"), false);
    }
  }
  const removedAlias = ["mark", "iplier"].join("");
  assert.equal(serialised.toLowerCase().includes(removedAlias), false);
});

test("validates the generated document against the runtime schema", () => {
  assert.equal(validateRuntimeLookup(currentBuild.lookup, currentBuild.schema), true);
  const invalid = structuredClone(currentBuild.lookup);
  invalid.companies[Object.keys(invalid.companies)[0]].poster = null;
  assert.throws(() => validateRuntimeLookup(invalid, currentBuild.schema), /additional property is not allowed/u);
});

test("operates from a clean-clone fixture with no ignored candidate evidence", async () => {
  assert.equal(await fs.stat(path.join(fixtureRoot, ".work")).then(() => true, () => false), false);
  assert.equal(await fs.stat(path.join(fixtureRoot, "tools")).then(() => true, () => false), false);
  const { lookup, assetCount } = await generateRuntimeLookup({ repoRoot: fixtureRoot });
  assert.deepEqual(lookup.counts, {
    companies: 2,
    networks: 2,
    people: 3,
    totalEntities: 7,
    landscapeAssets: 7,
    posterAssets: 3,
    totalAssets: 10,
  });
  assert.equal(assetCount, 10);
});

test("rejects a missing published asset", async () => {
  const root = await copyFixture();
  await fs.rm(path.join(root, "assets", "collection_covers", "companies", "2.webp"));
  await assert.rejects(generateRuntimeLookup({ repoRoot: root }), /missing or unreadable/u);
  await fs.rm(root, { recursive: true, force: true });
});

test("rejects a manifest hash mismatch", async () => {
  const root = await copyFixture();
  const manifestPath = path.join(root, "assets", "collection_covers", "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.publicationMetadata[0].outputHash = "f".repeat(64);
  manifest.entries[0].output_hash = "f".repeat(64);
  await writeJson(manifestPath, manifest);
  await assert.rejects(generateRuntimeLookup({ repoRoot: root }), /SHA-256 mismatch/u);
  await fs.rm(root, { recursive: true, force: true });
});

test("rejects runtime key/ID mismatches and duplicate paths", async () => {
  const { lookup, schema } = await generateRuntimeLookup({ repoRoot: fixtureRoot });
  const mismatched = structuredClone(lookup);
  mismatched.companies["2"].id = 20;
  mismatched.fingerprint = calculateLookupFingerprint(mismatched);
  assert.throws(() => validateRuntimeLookup(mismatched, schema), /key does not match entry ID/u);

  const duplicated = structuredClone(lookup);
  duplicated.networks["3"].landscape.path = duplicated.companies["2"].landscape.path;
  duplicated.fingerprint = calculateLookupFingerprint(duplicated);
  assert.throws(() => validateRuntimeLookup(duplicated, schema), /Duplicate runtime path/u);
});

test("rejects unpublished and review-required source records", async () => {
  const unpublishedRoot = await copyFixture();
  const unpublishedPath = path.join(unpublishedRoot, "assets", "collection_covers", "manifest.json");
  const unpublished = await readJson(unpublishedPath);
  unpublished.publicationMetadata[0].status = "unpublished";
  await writeJson(unpublishedPath, unpublished);
  await assert.rejects(generateRuntimeLookup({ repoRoot: unpublishedRoot }), /is not published/u);
  await fs.rm(unpublishedRoot, { recursive: true, force: true });

  const reviewRoot = await copyFixture();
  const reviewPath = path.join(reviewRoot, "assets", "collection_covers", "manifest.json");
  const review = await readJson(reviewPath);
  review.entries[0].review_status = "needs-review";
  await writeJson(reviewPath, review);
  await assert.rejects(generateRuntimeLookup({ repoRoot: reviewRoot }), /is not approved/u);
  await fs.rm(reviewRoot, { recursive: true, force: true });
});

test("produces a deterministic fingerprint and byte-identical output", async () => {
  const first = await generateRuntimeLookup({ repoRoot: fixtureRoot });
  const second = await generateRuntimeLookup({ repoRoot: fixtureRoot });
  assert.equal(first.lookup.fingerprint, second.lookup.fingerprint);
  assert.equal(serialiseLookup(first.lookup), serialiseLookup(second.lookup));
  assert.equal(first.lookup.fingerprint, calculateLookupFingerprint(first.lookup));
});

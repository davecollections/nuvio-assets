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

let currentBuild;
let fixtureRoot;

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
  assert.deepEqual(lookup.counts, {
    companies: 1820,
    networks: 572,
    people: 817,
    totalEntities: 3209,
    landscapeAssets: 3209,
    posterAssets: 817,
    totalAssets: 4026,
  });
  assert.equal(assetCount, 4026);
  assert.equal(lookup.generatedFrom.studioNetworkManifest.sha256, "9c7394c0031f74caab7182ba1ab7c1612474f513b0e3a699a6f47b789017fd02");
  assert.equal(lookup.generatedFrom.peopleManifest.sha256, "74f80ecf75619c39744939ac9e9d45eafb555702774c6e32cc72fcc05332b513");
});

test("emits exact compact company and network shapes with published fallback state", () => {
  const { companies, networks } = currentBuild.lookup;
  const company = Object.values(companies)[0];
  const network = Object.values(networks)[0];
  assert.deepEqual(Object.keys(company), ["id", "name", "status", "landscape", "fallbackUsed", "reviewRequired"]);
  assert.deepEqual(Object.keys(network), ["id", "name", "status", "landscape", "fallbackUsed", "reviewRequired"]);
  assert.deepEqual(Object.keys(company.landscape), ["path", "sha256"]);
  assert.equal(Object.hasOwn(company, "poster"), false);
  assert.equal(Object.hasOwn(network, "poster"), false);
  assert.equal(Object.values(companies).filter((entry) => entry.fallbackUsed).length, 486);
  assert.equal(Object.values(networks).filter((entry) => entry.fallbackUsed).length, 1);
  assert.equal(companies["6760"].fallbackUsed, true);
  assert.equal(companies["6760"].landscape.sha256, "6ea668541581a67fbed7932bb4683205b776494b088eecbe7fa64077d3e22ac2");
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

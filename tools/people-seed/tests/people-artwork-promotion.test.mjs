import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyFont } from "../src/people-artwork/font.mjs";
import {
  cropFor,
  grainBuffer,
  loadPeopleArtworkPresets,
} from "../src/people-artwork/renderer.mjs";
import { loadPeopleArtworkRuntime } from "../src/people-artwork/runtime-dependencies.mjs";
import {
  deriveOriginalTmdbImageUrl,
  FALLBACK_REASONS,
  resolveApprovedProfile,
  resolvePortraitSource,
} from "../src/people-artwork/source-resolution.mjs";
import { parseRendererArguments, selectPeople } from "../src/people-artwork/selection.mjs";
import {
  readPeopleArtworkConfiguration,
  validatePeopleArtworkConfiguration,
} from "../src/people-artwork-validation.mjs";
import { readPeopleFoundation } from "../src/people-validation.mjs";
import { validateAgainstSchema } from "../src/schema-validator.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const proofRoot = path.join(packageRoot, ".work", "people-production-promotion-proof");
const proofAvailable = await fs.access(path.join(proofRoot, "reports", "final-validation.json")).then(() => true, () => false);
const proofTest = proofAvailable ? test : test.skip;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const people = {
  override: {
    stableKey: "person:5064",
    tmdbPersonId: 5064,
    canonicalName: "Meryl Streep",
    profilePath: "/g5cVxQBAQ3AXt3LhdBXtbbN47Uc.jpg",
  },
  ordinary: {
    stableKey: "person:999",
    tmdbPersonId: 999,
    canonicalName: "Test Person",
    profilePath: "/RegistryPortrait123.jpg",
  },
};

function fakeSharpMetadata(metadata) {
  return () => ({
    metadata: async () => {
      if (metadata instanceof Error) throw metadata;
      return metadata;
    },
  });
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-people-artwork-test-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeCache(directory, entries, files = {}) {
  await fs.mkdir(directory, { recursive: true });
  for (const [relativePath, bytes] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
  }
  await fs.writeFile(path.join(directory, "index.json"), `${JSON.stringify({
    version: "people-portrait-source-cache-v1",
    ordering: "stable-key-then-profile-path",
    entries,
  }, null, 2)}\n`);
}

function response({ ok = true, status = 200, contentType = "image/jpeg", bytes = Buffer.from("portrait") } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bytes,
  };
}

test("committed people foundation retains the exact promotion baseline", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  assert.equal(foundation.registry.records.length, 817);
  assert.equal(foundation.actors.records.length, 523);
  assert.equal(foundation.directors.records.length, 300);
  assert.equal(foundation.sources.sources.length, 13);
  assert.equal(foundation.registry.records.flatMap((record) => record.sourceMemberships).length, 1069);
  assert.deepEqual(
    Object.fromEntries(["initial", "later", "review"].map((tier) => [tier, foundation.actors.records.filter((record) => record.rolloutTier === tier).length])),
    { initial: 295, later: 203, review: 25 },
  );
});

test("portrait decisions validate against their schema and bind exactly four overrides plus three retained sources", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const result = await validatePeopleArtworkConfiguration({ repoRoot, registry: foundation.registry });
  assert.deepEqual(result.errors, []);
  const { decisions, decisionSchema } = result.configuration;
  assert.deepEqual(validateAgainstSchema(decisions, decisionSchema), []);
  assert.equal(decisions.records.length, 7);
  assert.equal(decisions.records.filter((item) => item.decision === "use-owner-selected").length, 4);
  assert.equal(decisions.records.filter((item) => item.decision === "retain-registry-source").length, 3);
  assert.deepEqual(Object.fromEntries(decisions.records.filter((item) => item.decision === "use-owner-selected").map((item) => [item.stableKey, item.approvedProfilePath])), {
    "person:5064": "/pSyM9cteYYWUBDalJzMPLH0SLgB.jpg",
    "person:8725": "/g3scfKWRDJIFsuphfv3Ylo2GyGH.jpg",
    "person:13566": "/sI3vtDTeGcV0uhumtZmYmfcOBav.jpg",
    "person:56208": "/szuJZR2uAyGnbhku6WjEM7JX8hK.jpg",
  });
});

test("portrait source resolution gives an approved override precedence and otherwise retains the registry path", async () => {
  const configuration = await readPeopleArtworkConfiguration(repoRoot);
  const override = resolveApprovedProfile(people.override, configuration.decisions);
  assert.equal(override.profilePath, "/pSyM9cteYYWUBDalJzMPLH0SLgB.jpg");
  assert.equal(override.sourceDecision, "use-owner-selected");
  const ordinary = resolveApprovedProfile(people.ordinary, configuration.decisions);
  assert.equal(ordinary.profilePath, people.ordinary.profilePath);
  assert.equal(ordinary.sourceDecision, "registry-default");
});

test("null and empty profile paths activate no-profile-path fallback without access or acquisition", async () => {
  for (const profilePath of [null, "", "   "]) {
    let fetched = false;
    const result = await resolvePortraitSource({
      person: { ...people.ordinary, profilePath },
      decisions: { records: [] },
      sourceCache: "unused",
      offline: false,
      fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
    });
    assert.equal(result.available, false);
    assert.equal(result.fallbackReason, "no-profile-path");
    assert.equal(fetched, false);
  }
});

test("an absent offline cache activates source-not-cached and never calls fetch", async (t) => {
  const directory = await temporaryDirectory(t);
  let fetched = false;
  const result = await resolvePortraitSource({
    person: people.ordinary,
    decisions: { records: [] },
    sourceCache: directory,
    offline: true,
    sharp: fakeSharpMetadata({ width: 100, height: 100 }),
    fetchImpl: async () => { fetched = true; return response(); },
  });
  assert.equal(result.fallbackReason, "source-not-cached");
  assert.equal(fetched, false);
});

test("explicit acquisition failure activates source-fetch-failed with bounded retries", async (t) => {
  const directory = await temporaryDirectory(t);
  let calls = 0;
  const result = await resolvePortraitSource({
    person: people.ordinary,
    decisions: { records: [] },
    sourceCache: directory,
    offline: false,
    fetchImpl: async () => { calls += 1; throw new Error("network failed"); },
    retryDelay: async () => {},
  });
  assert.equal(result.fallbackReason, "source-fetch-failed");
  assert.equal(calls, 2);
  assert.equal(result.attempts.length, 2);
});

test("invalid HTTP, content type, empty bytes, decode, and dimensions map to stable fallback reasons", async (t) => {
  const cases = [
    { reason: "source-http-invalid", fetchImpl: async () => response({ ok: false, status: 404 }) },
    { reason: "source-content-type-invalid", fetchImpl: async () => response({ contentType: "text/html" }) },
    { reason: "source-empty", fetchImpl: async () => response({ bytes: Buffer.alloc(0) }) },
    { reason: "source-decode-failed", fetchImpl: async () => response(), sharp: fakeSharpMetadata(new Error("decode failed")) },
    { reason: "source-dimensions-invalid", fetchImpl: async () => response(), sharp: fakeSharpMetadata({ width: 0, height: 100 }) },
  ];
  for (const fixture of cases) {
    const directory = await temporaryDirectory(t);
    const result = await resolvePortraitSource({
      person: people.ordinary,
      decisions: { records: [] },
      sourceCache: directory,
      offline: false,
      fetchImpl: fixture.fetchImpl,
      sharp: fixture.sharp,
      retryDelay: async () => {},
    });
    assert.equal(result.available, false);
    assert.equal(result.fallbackReason, fixture.reason);
  }
});

test("cache hash drift activates source-validation-failed", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeCache(directory, [{
    stableKey: people.ordinary.stableKey,
    profilePath: people.ordinary.profilePath,
    sourceFile: "portrait.bin",
    sourceHash: "0".repeat(64),
    width: 100,
    height: 100,
  }], { "portrait.bin": Buffer.from("not-the-bound-source") });
  const result = await resolvePortraitSource({
    person: people.ordinary,
    decisions: { records: [] },
    sourceCache: directory,
    offline: true,
    sharp: fakeSharpMetadata({ width: 100, height: 100 }),
  });
  assert.equal(result.fallbackReason, "source-validation-failed");
});

test("explicit acquisition preserves an owner-approved raw source hash when that is the evidence binding", async (t) => {
  const directory = await temporaryDirectory(t);
  const runtime = loadPeopleArtworkRuntime();
  const raw = await runtime.sharp({
    create: { width: 32, height: 48, channels: 3, background: { r: 80, g: 90, b: 100 } },
  }).jpeg({ quality: 90 }).toBuffer();
  const approvedSourceHash = sha256(raw);
  const result = await resolvePortraitSource({
    person: people.ordinary,
    decisions: { records: [{
      stableKey: people.ordinary.stableKey,
      tmdbPersonId: people.ordinary.tmdbPersonId,
      canonicalName: people.ordinary.canonicalName,
      decision: "retain-registry-source",
      registryProfilePath: people.ordinary.profilePath,
      approvedProfilePath: people.ordinary.profilePath,
      approvedSourceHash,
    }] },
    sourceCache: directory,
    offline: false,
    sharp: runtime.sharp,
    fetchImpl: async () => response({ bytes: raw }),
  });
  assert.equal(result.available, true);
  assert.equal(result.sourceHash, approvedSourceHash);
  assert.equal(result.cacheEntry.cacheKind, "owner-approved-raw-original-cdn-source");
  assert.equal(result.cacheEntry.sourceFile, result.cacheEntry.rawFile);
  assert.equal(result.sourceStatus, "network-acquired-exact-profile-path");
});

test("a differently bound cached portrait is never discovered as an automatic alternate", async (t) => {
  const directory = await temporaryDirectory(t);
  const bytes = Buffer.from("alternate");
  await writeCache(directory, [{
    stableKey: people.ordinary.stableKey,
    profilePath: "/DifferentPortrait.jpg",
    sourceFile: "alternate.bin",
    sourceHash: sha256(bytes),
    width: 100,
    height: 100,
  }], { "alternate.bin": bytes });
  const result = await resolvePortraitSource({
    person: people.ordinary,
    decisions: { records: [] },
    sourceCache: directory,
    offline: true,
    sharp: fakeSharpMetadata({ width: 100, height: 100 }),
  });
  assert.equal(result.available, false);
  assert.equal(result.fallbackReason, "source-not-cached");
  assert.equal(result.profilePathAttempted, people.ordinary.profilePath);
});

test("normal source resolution derives only the official original-resolution TMDB CDN URL", async () => {
  assert.equal(deriveOriginalTmdbImageUrl("/Portrait_123.jpg"), "https://image.tmdb.org/t/p/original/Portrait_123.jpg");
  assert.throws(() => deriveOriginalTmdbImageUrl("https://example.com/portrait.jpg"), /Invalid TMDB profile path/);
  const source = await fs.readFile(path.join(packageRoot, "src", "people-artwork", "source-resolution.mjs"), "utf8");
  assert.doesNotMatch(source, /person\/images|person-images|search\/person|person\/\{person_id\}/iu);
  assert.match(source, /https:\/\/image\.tmdb\.org\/t\/p\/original\//u);
});

test("renderer argument parsing is offline by default and network acquisition is explicit", () => {
  const defaults = parseRendererArguments(["--stable-key", "person:1", "--source-cache", "cache", "--dry-run"]);
  assert.equal(defaults.offline, true);
  assert.equal(defaults.allowNetwork, false);
  const network = parseRendererArguments(["--stable-key", "person:1", "--source-cache", "cache", "--allow-network", "--dry-run"]);
  assert.equal(network.offline, false);
  assert.equal(network.allowNetwork, true);
});

test("bounded stable-key, key-file, seed, and rollout-tier selection reuse category-neutral registry identities", async (t) => {
  const foundation = await readPeopleFoundation(repoRoot);
  const directory = await temporaryDirectory(t);
  const keyFile = path.join(directory, "keys.txt");
  await fs.writeFile(keyFile, "person:3894\n");
  const selection = await selectPeople({
    registry: foundation.registry,
    actors: foundation.actors,
    directors: foundation.directors,
    stableKeys: ["person:1158", "person:1158"],
    stableKeyFile: keyFile,
    seedPath: "data/people/actors-seed.json",
    tier: "review",
    repoRoot,
  });
  assert.equal(selection.people.length, 27);
  assert.equal(selection.people.filter((person) => person.stableKey === "person:1158").length, 1);
  assert.ok(selection.people.every((person) => Array.isArray(person.categoryMembership)));
});

test("tracked presets lock R1, R2, 96 px, 114 px, and exact promotion hashes", async () => {
  const presets = await loadPeopleArtworkPresets();
  assert.equal(presets.portrait.landscape.preset.typography.sizePolicy, "R1-current-T2-nominal");
  assert.equal(presets.portrait.poster.preset.typography.sizePolicy, "R2-current-T2-plus-6-percent");
  assert.equal(presets.fallback.landscape.preset.typography.requestedFontSize, 96);
  assert.equal(presets.fallback.poster.preset.typography.requestedFontSize, 114);
  assert.deepEqual({
    landscape: presets.portrait.landscape.presetHash,
    poster: presets.portrait.poster.presetHash,
    fallbackLandscape: presets.fallback.landscape.presetHash,
    fallbackPoster: presets.fallback.poster.presetHash,
  }, {
    landscape: "a94f863b9332332617355fd73265571dc9b3ccf055365674757d76ac2c48faad",
    poster: "77ba30578bf7a6a859530621bf706ddf9ac6945efd479672cf8515d4434efb8d",
    fallbackLandscape: "d59336728e0307f35e9c1420eb06b40ad68dca4aa53b2eb82ce63103d601b87b",
    fallbackPoster: "7be039dc2cb9c13314b769aafb4643025f93786ae466c0345e901c34fbc2f6dc",
  });
});

test("the approved font cache has exact hashes, a genuine 700 axis, and accented punctuation glyphs", async () => {
  const runtime = loadPeopleArtworkRuntime();
  const font = await verifyFont({
    Canvas: runtime.Canvas,
    FontLibrary: runtime.FontLibrary,
    names: ["Céline Sciamma", "Djibril Diop Mambéty", "F. W. Murnau", "Max Ophüls", "Maureen O'Hara"],
  });
  assert.equal(font.fontHash, "b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0");
  assert.equal(font.licenceHash, "60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956");
  assert.equal(font.weight, 700);
  assert.equal(font.genuineWeight700, true);
  assert.deepEqual(font.variation.axes.find((axis) => axis.tag === "wght"), { tag: "wght", minimum: 300, default: 300, maximum: 700 });
  assert.ok(font.glyphCoverage.every((item) => item.covered));
});

test("crop and grain are deterministic while landscape and poster use independent source crops", async () => {
  const presets = await loadPeopleArtworkPresets();
  const source = { width: 800, height: 1200, exifOrientation: 1 };
  const landscapeA = cropFor(source, presets.portrait.landscape.preset, "landscape");
  const landscapeB = cropFor(source, presets.portrait.landscape.preset, "landscape");
  const poster = cropFor(source, presets.portrait.poster.preset, "poster");
  assert.deepEqual(landscapeA, landscapeB);
  assert.notDeepEqual(landscapeA, poster);
  assert.deepEqual(grainBuffer(16, 16, 12345, 0.02), grainBuffer(16, 16, 12345, 0.02));
  assert.notDeepEqual(grainBuffer(16, 16, 12345, 0.02), grainBuffer(16, 16, 54321, 0.02));
});

test("fallback reason vocabulary is stable and exhaustive", () => {
  assert.deepEqual(FALLBACK_REASONS, [
    "no-profile-path",
    "source-not-cached",
    "source-fetch-failed",
    "source-http-invalid",
    "source-content-type-invalid",
    "source-empty",
    "source-decode-failed",
    "source-dimensions-invalid",
    "source-validation-failed",
  ]);
});

proofTest("locked scope remains exactly 40 people: 24 actors, 16 directors, no Arnold, and Christian Bale in both formats", async () => {
  const lock = JSON.parse(await fs.readFile(path.join(packageRoot, ".work", "people-proof-selection", "drafts", "people-proof-set.lock.draft.json"), "utf8"));
  const portrait = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "portrait-parity.json"), "utf8"));
  assert.equal(lock.selectedStableKeys.length, 40);
  assert.equal(lock.actorSelections.length, 24);
  assert.equal(lock.directorSelections.length, 16);
  assert.equal(new Set(lock.selectedStableKeys).size, 40);
  assert.equal(lock.selectedStableKeys.includes("person:1100"), false);
  assert.deepEqual(portrait.filter((row) => row.stableKey === "person:3894").map((row) => row.formatId), ["landscape", "poster"]);
});

proofTest("promotion proof contains exactly 80 portrait and 12 fallback records at exact byte parity", async () => {
  const portrait = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "portrait-parity.json"), "utf8"));
  const fallback = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "fallback-parity.json"), "utf8"));
  assert.equal(portrait.length, 80);
  assert.equal(fallback.length, 12);
  assert.ok(portrait.every((row) => row.parity && row.actualOutputHash === row.expectedOutputHash && row.actualByteCount === row.expectedByteCount && Object.values(row.checks).every(Boolean)));
  assert.ok(fallback.every((row) => row.parity && row.actualOutputHash === row.expectedOutputHash && row.checks.noPortraitRead && Object.values(row.checks).every(Boolean)));
  assert.ok(portrait.some((row) => /[éōłó]/u.test(row.canonicalName)));
});

proofTest("proof metadata is stable, category-neutral, independently rendered, and never uses an output as source", async () => {
  const validation = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "metadata-contract-validation.json"), "utf8"));
  const portraitMetadata = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "portrait-render-metadata.json"), "utf8"));
  assert.equal(validation.valid, true);
  assert.equal(validation.portraitRecords, 80);
  assert.equal(validation.fallbackRecords, 12);
  assert.equal(validation.categoryNeutralReuse, true);
  assert.equal(validation.deterministicOrdering, true);
  assert.ok(portraitMetadata.records.every((record) => record.independentlyGeneratedFromOriginalSource));
  assert.ok(portraitMetadata.records.every((record) => !record.sourcePath.endsWith(".webp")));
  for (const stableKey of new Set(portraitMetadata.records.map((record) => record.stableKey))) {
    const records = portraitMetadata.records.filter((record) => record.stableKey === stableKey);
    assert.equal(records.length, 2);
    assert.equal(records[0].sourceHash, records[1].sourceHash);
  }
});

proofTest("proof network accounting, deterministic replay, and preservation are all exact", async () => {
  const network = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "network-accounting.json"), "utf8"));
  const determinism = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "determinism-verification.json"), "utf8"));
  const preservation = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "preservation-proof.json"), "utf8"));
  assert.deepEqual({
    profileImageDownloads: network.profileImageDownloads,
    tmdbMetadataRequests: network.tmdbMetadataRequests,
    personImagesRequests: network.personImagesRequests,
    imageCdnRequests: network.imageCdnRequests,
    fontDownloads: network.fontDownloads,
    sourceCacheHits: network.sourceCacheHits,
    generalWebRequests: network.generalWebRequests,
    unauthorisedRequests: network.unauthorisedRequests,
  }, {
    profileImageDownloads: 0,
    tmdbMetadataRequests: 0,
    personImagesRequests: 0,
    imageCdnRequests: 0,
    fontDownloads: 0,
    sourceCacheHits: 40,
    generalWebRequests: 0,
    unauthorisedRequests: 0,
  });
  assert.equal(determinism.valid, true);
  assert.ok(Object.entries(determinism).filter(([key]) => key.startsWith("identical")).every(([, value]) => value));
  assert.equal(preservation.valid, true);
  assert.ok(Object.values(preservation.checks).every(Boolean));
});

proofTest("promotion proof writes no permanent people artwork, production manifest, or studio/network state", async () => {
  const finalValidation = JSON.parse(await fs.readFile(path.join(proofRoot, "reports", "final-validation.json"), "utf8"));
  assert.equal(finalValidation.checks.noPermanentPeopleWrites, true);
  assert.equal(finalValidation.checks.noProductionManifest, true);
  assert.equal(finalValidation.checks.preservation, true);
});

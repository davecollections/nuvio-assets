import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parsePublicationArguments } from "../src/people-publication-cli.mjs";
import { loadPeopleArtworkRuntime } from "../src/people-artwork/runtime-dependencies.mjs";
import {
  OWNER_REVIEW_FIELDS,
  PEOPLE_ASSET_RELATIVE_ROOT,
  PEOPLE_MANIFEST_RELATIVE_PATH,
  buildOwnerReviewRows,
  buildPeopleArtworkManifest,
  calculateManifestFingerprint,
  categoryReuseReport,
  compareRenderWithPromotionEvidence,
  csvDocument,
  generatePublicationContactSheets,
  loadPromotionEvidence,
  proposedRawUrl,
  validateManifestAssets,
  validateOwnerDecisionBindings,
  validateOwnerDecisions,
  validatePeopleArtworkManifest,
  zeroNetworkAccounting,
} from "../src/people-publication.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const validationCli = path.join(packageRoot, "src", "people-publication-validation-cli.mjs");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function createSyntheticCandidate() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-publication-framework-"));
  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.copyFile(
    path.join(repoRoot, "schemas", "people-artwork-manifest.schema.json"),
    path.join(root, "schemas", "people-artwork-manifest.schema.json"),
  );
  const runtime = loadPeopleArtworkRuntime();
  runtime.sharp.cache(false);
  const people = [
    { tmdbPersonId: 101, canonicalName: "Synthetic Actor", categoryMembership: ["actor"], rolloutTierByCategory: { actor: "initial" }, sourceDecision: "registry-default" },
    { tmdbPersonId: 202, canonicalName: "Synthetic Shared Person", categoryMembership: ["actor", "director"], rolloutTierByCategory: { actor: "later", director: "initial" }, sourceDecision: "retain-registry-source" },
  ];
  const records = [];
  for (const person of people) {
    const formatFields = {};
    for (const formatId of ["landscape", "poster"]) {
      const dimensions = formatId === "landscape" ? { width: 1200, height: 675 } : { width: 1000, height: 1500 };
      const buffer = await runtime.sharp({
        create: {
          ...dimensions,
          channels: 3,
          background: person.tmdbPersonId === 101 ? { r: 24, g: 48, b: 72 } : { r: 84, g: 62, b: 40 },
        },
      }).webp({ quality: 80 }).toBuffer();
      const repositoryPath = `${PEOPLE_ASSET_RELATIVE_ROOT}/${formatId}/${person.tmdbPersonId}.webp`;
      await fs.mkdir(path.dirname(path.join(root, repositoryPath)), { recursive: true });
      await fs.writeFile(path.join(root, repositoryPath), buffer);
      formatFields[`${formatId}Path`] = repositoryPath;
      formatFields[`${formatId}UrlProposal`] = proposedRawUrl(repositoryPath);
      formatFields[`${formatId}Hash`] = sha256(buffer);
      formatFields[`${formatId}ByteCount`] = buffer.length;
      formatFields[`${formatId}PresetId`] = `synthetic-${formatId}-v1`;
      formatFields[`${formatId}PresetHash`] = sha256(`synthetic-${formatId}-preset`);
    }
    records.push({
      stableKey: `person:${person.tmdbPersonId}`,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categoryMembership: person.categoryMembership,
      rolloutTierByCategory: person.rolloutTierByCategory,
      sourceDecision: person.sourceDecision,
      resolvedProfilePath: `/Synthetic${person.tmdbPersonId}.jpg`,
      sourceHash: sha256(`synthetic-source-${person.tmdbPersonId}`),
      sourceDimensions: { width: 1600, height: 2400 },
      fallbackUsed: false,
      fallbackReason: null,
      ...formatFields,
      rendererMetadataVersion: "people-artwork-render-metadata-v1",
      ownerReviewStatus: "approved-artwork",
      distributionStatus: "publication-candidate",
      rightsStatus: "third-party-portrait-review-required",
    });
  }
  const manifest = {
    version: "people-artwork-manifest-v1",
    status: "publication-candidate",
    schemaPath: "schemas/people-artwork-manifest.schema.json",
    publicationCandidateAt: "2026-01-01T00:00:00.000Z",
    ordering: "explicit-selection-order",
    recordCount: records.length,
    landscapeCount: records.length,
    posterCount: records.length,
    fallbackCount: 0,
    rendererVersion: "people-artwork-renderer-v1",
    rendererRuntime: {
      sharp: runtime.versions.sharp,
      libvips: runtime.versions.libvips,
      skiaCanvas: runtime.versions.skiaCanvas,
    },
    fontLockHash: sha256("synthetic-font-lock"),
    fontHash: sha256("synthetic-font"),
    fingerprintExcludes: ["publicationCandidateAt", "manifestFingerprint"],
    manifestFingerprint: "0".repeat(64),
    rightsNotice: {
      portraitSources: "Synthetic test portraits retain source provenance.",
      tmdbRole: "TMDB metadata does not establish photography ownership.",
      codeLicenceSeparation: "Code and portrait rights are separate.",
      redistributionDecision: "Public redistribution requires a separate explicit project decision.",
      attributionPolicy: "No unsupported attribution is invented.",
      ownershipClaim: "No ownership of the underlying portrait photography is claimed.",
    },
    records,
  };
  manifest.manifestFingerprint = calculateManifestFingerprint(manifest);
  await fs.writeFile(path.join(root, PEOPLE_MANIFEST_RELATIVE_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest };
}

async function withSyntheticCandidate(callback) {
  const fixture = await createSyntheticCandidate();
  try {
    return await callback(fixture);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test("publication CLI is bounded, offline-only, and requires explicit permanent paths for writes", () => {
  const options = parsePublicationArguments([
    "--locked-pilot", "--format", "both", "--asset-root", PEOPLE_ASSET_RELATIVE_ROOT,
    "--manifest", PEOPLE_MANIFEST_RELATIVE_PATH, "--work-root", "tools/people-seed/.work/publication-test",
    "--source-cache", "tools/people-seed/.work/source-cache", "--proof-root", "tools/people-seed/.work/proof", "--candidate",
  ]);
  assert.equal(options.lockedPilot, true);
  assert.equal(options.format, "both");
  assert.equal(options.candidate, true);
  assert.throws(() => parsePublicationArguments(["--all"]), /Unknown people publication argument/u);
  assert.throws(() => parsePublicationArguments(["--locked-pilot", "--stable-key", "person:1"]), /cannot be combined/u);
  assert.throws(() => parsePublicationArguments(["--locked-pilot", "--format", "poster"]), /requires --format both/u);
});

test("explicit dry run is bounded and performs no render, acquisition, or write", () => {
  const output = execFileSync(process.execPath, [path.join(packageRoot, "src", "people-publication-cli.mjs"), "--stable-key", "person:3894", "--dry-run"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const result = JSON.parse(output);
  assert.equal(result.valid, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.offline, true);
  assert.equal(result.writesPerformed, false);
  assert.equal(result.renderingPerformed, false);
  assert.deepEqual(result.people.map((person) => person.stableKey), ["person:3894"]);
});

test("approved parity evidence supports an arbitrary non-empty bounded record count", async () => {
  const proofRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-publication-evidence-"));
  try {
    const reports = path.join(proofRoot, "reports");
    await fs.mkdir(reports, { recursive: true });
    const documents = {
      "portrait-parity.json": [{ stableKey: "person:1", formatId: "landscape", parity: true }, { stableKey: "person:2", formatId: "poster", parity: true }],
      "portrait-render-metadata.json": { recordCount: 2, records: [{ stableKey: "person:1", formatId: "landscape" }, { stableKey: "person:2", formatId: "poster" }] },
      "final-validation.json": { valid: true, checks: { exactPortraitParity: true } },
      "network-accounting.json": { attemptedRequests: [] },
      "preset-verification.json": { valid: true },
      "font-verification.json": { valid: true },
    };
    await Promise.all(Object.entries(documents).map(([name, value]) => fs.writeFile(path.join(reports, name), `${JSON.stringify(value)}\n`)));
    const evidence = await loadPromotionEvidence({ repoRoot, proofRoot });
    assert.equal(evidence.portraitParity.length, 2);
    assert.equal(evidence.portraitMetadata.recordCount, 2);
  } finally {
    await fs.rm(proofRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("render parity rejects approved evidence rows outside the explicit rendered scope", async () => {
  const renderRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-publication-parity-"));
  try {
    const output = Buffer.from("synthetic rendered bytes");
    await fs.writeFile(path.join(renderRoot, "one.webp"), output);
    const actual = {
      stableKey: "person:1", tmdbPersonId: 1, canonicalName: "One", formatId: "landscape", outputPath: "one.webp",
      profilePathAttempted: "/One.jpg", sourceHash: sha256("source-one"), sourceWidth: 800, sourceHeight: 1200,
      cropRectangle: { left: 1, top: 2, width: 3, height: 4 }, requestedFontSize: 96, finalFontSize: 96,
      nameLines: ["One"], lineCount: 1, textBounds: { x: 1 }, safeMargins: { left: 2 }, presetId: "synthetic-v1",
      presetHash: sha256("preset"), grainSeed: 1, grainAmount: 0.02, gradientBounds: { top: 1 }, canvasWidth: 1200, canvasHeight: 675,
      byteCount: output.length, outputHash: sha256(output), fallbackUsed: false, independentlyGeneratedFromOriginalSource: true, derivedFromOtherFormat: false,
    };
    const extra = { ...actual, stableKey: "person:2", tmdbPersonId: 2, canonicalName: "Two", outputPath: "two.webp" };
    const evidence = {
      portraitParity: [
        { stableKey: actual.stableKey, formatId: actual.formatId, parity: true, profilePath: actual.profilePathAttempted, sourceHash: actual.sourceHash, expectedByteCount: actual.byteCount, expectedOutputHash: actual.outputHash },
        { stableKey: extra.stableKey, formatId: extra.formatId, parity: true, profilePath: extra.profilePathAttempted, sourceHash: extra.sourceHash, expectedByteCount: extra.byteCount, expectedOutputHash: extra.outputHash },
      ],
      portraitMetadata: { records: [actual, extra] },
    };
    const result = await compareRenderWithPromotionEvidence({ renderResult: { metadata: { records: [actual] } }, renderRoot, evidence });
    assert.equal(result.valid, false);
    assert.deepEqual(result.unexpectedEvidenceKeys, ["person:2|landscape"]);
  } finally {
    await fs.rm(renderRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("default publication validation accepts the framework-only state without a permanent candidate", () => {
  const output = execFileSync(process.execPath, [validationCli], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const result = JSON.parse(output);
  assert.equal(result.valid, true);
  assert.equal(result.frameworkAvailable, true);
  assert.equal(result.candidatePresent, false);
  assert.equal(result.numericAssetCount, 0);
  assert.equal(result.manifestPath, PEOPLE_MANIFEST_RELATIVE_PATH);
  const missing = spawnSync(process.execPath, [validationCli, "--manifest", "tools/people-seed/.work/does-not-exist.json"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/u);
});

test("synthetic manifest and WebPs pass schema, hash, byte, format, and dimension validation", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: root, expectedStableKeys: ["person:101", "person:202"] });
    const pathValidation = await validateManifestAssets({ manifest, repoRoot: root });
    assert.deepEqual(manifestValidation.errors, []);
    assert.equal(manifestValidation.valid, true);
    assert.equal(pathValidation.valid, true);
    assert.equal(pathValidation.recordCount, 4);
    assert.ok(pathValidation.records.every((record) => Object.values(record.checks).every(Boolean)));
  });
});

test("numeric filename policy, unique identities, path collisions, and schema fields remain strict", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    const collision = structuredClone(manifest);
    collision.records[1].tmdbPersonId = collision.records[0].tmdbPersonId;
    collision.manifestFingerprint = calculateManifestFingerprint(collision);
    const collisionResult = await validatePeopleArtworkManifest({ manifest: collision, repoRoot: root });
    assert.equal(collisionResult.valid, false);
    assert.ok(collisionResult.errors.some((error) => /TMDB person IDs must be unique/u.test(error)));

    const wrongPath = structuredClone(manifest);
    wrongPath.records[0].landscapePath = `${PEOPLE_ASSET_RELATIVE_ROOT}/landscape/not-numeric.webp`;
    wrongPath.records[0].landscapeUrlProposal = proposedRawUrl(wrongPath.records[0].landscapePath);
    wrongPath.manifestFingerprint = calculateManifestFingerprint(wrongPath);
    const wrongPathResult = await validatePeopleArtworkManifest({ manifest: wrongPath, repoRoot: root });
    assert.equal(wrongPathResult.valid, false);
    assert.ok(wrongPathResult.errors.some((error) => /path is not the numeric identity path|pattern/u.test(error)));

    const additional = structuredClone(manifest);
    additional.records[0].unexpected = true;
    additional.manifestFingerprint = calculateManifestFingerprint(additional);
    const additionalResult = await validatePeopleArtworkManifest({ manifest: additional, repoRoot: root });
    assert.equal(additionalResult.valid, false);
    assert.ok(additionalResult.errors.some((error) => /additional property/u.test(error)));
  });
});

test("asset validation detects a missing synthetic candidate file", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    await fs.rm(path.join(root, manifest.records[0].posterPath));
    const result = await validateManifestAssets({ manifest, repoRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /exists.*validation failed/u.test(error)));
  });
});

test("asset validation rejects any file outside the exact manifest path set", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    const unexpectedPath = path.join(root, PEOPLE_ASSET_RELATIVE_ROOT, "landscape", "unexpected.webp");
    await fs.writeFile(unexpectedPath, "not a candidate image");
    const result = await validateManifestAssets({ manifest, repoRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /unexpected\.webp: unexpected candidate path/u.test(error)));
  });
});

test("manifest validation requires at least one complete format per person", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    const absent = structuredClone(manifest);
    for (const suffix of ["Path", "UrlProposal", "Hash", "ByteCount", "PresetId", "PresetHash"]) {
      absent.records[0][`landscape${suffix}`] = null;
      absent.records[0][`poster${suffix}`] = null;
    }
    absent.landscapeCount -= 1;
    absent.posterCount -= 1;
    absent.manifestFingerprint = calculateManifestFingerprint(absent);
    const absentResult = await validatePeopleArtworkManifest({ manifest: absent, repoRoot: root });
    assert.ok(absentResult.errors.some((error) => /at least one artwork format is required/u.test(error)));

    const partial = structuredClone(manifest);
    partial.records[0].landscapeHash = null;
    partial.manifestFingerprint = calculateManifestFingerprint(partial);
    const partialResult = await validatePeopleArtworkManifest({ manifest: partial, repoRoot: root });
    assert.ok(partialResult.errors.some((error) => /format fields must be entirely populated or entirely null/u.test(error)));
  });
});

test("contact-sheet generation supports an explicitly bounded single-format candidate", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    const landscapeOnly = structuredClone(manifest);
    landscapeOnly.posterCount = 0;
    for (const record of landscapeOnly.records) {
      for (const suffix of ["Path", "UrlProposal", "Hash", "ByteCount", "PresetId", "PresetHash"]) record[`poster${suffix}`] = null;
    }
    landscapeOnly.manifestFingerprint = calculateManifestFingerprint(landscapeOnly);
    const validation = await validatePeopleArtworkManifest({ manifest: landscapeOnly, repoRoot: root });
    assert.equal(validation.valid, true);
    assert.equal(categoryReuseReport(landscapeOnly).valid, true);
    const sheets = await generatePublicationContactSheets({ manifest: landscapeOnly, outputDir: path.join(root, "review"), repoRoot: root });
    assert.equal(sheets.entryCount, 3);
    assert.equal(sheets.ordering, "explicit-selection-pages-then-overview-then-source-overrides");
    assert.ok(sheets.entries.every((entry) => entry.byteCount > 0));
  });
});

test("category-neutral actor and director reuse has no category-specific paths", async () => {
  await withSyntheticCandidate(async ({ manifest }) => {
    const paths = manifest.records.flatMap((record) => [record.landscapePath, record.posterPath]);
    assert.equal(new Set(paths).size, 4);
    assert.ok(paths.every((repositoryPath) => !repositoryPath.includes("/actors/") && !repositoryPath.includes("/directors/")));
    const report = categoryReuseReport(manifest);
    assert.equal(report.valid, true);
    assert.equal(report.actorPathNamespaces, 0);
    assert.equal(report.directorPathNamespaces, 0);
    assert.equal(report.sharedCategoryPersonCount, 1);
  });
});

test("manifest fingerprint excludes only its timestamp and own value", async () => {
  await withSyntheticCandidate(async ({ manifest }) => {
    assert.deepEqual(manifest.fingerprintExcludes, ["publicationCandidateAt", "manifestFingerprint"]);
    assert.equal(manifest.manifestFingerprint, calculateManifestFingerprint(manifest));
    assert.equal(calculateManifestFingerprint({ ...manifest, publicationCandidateAt: "2030-01-01T00:00:00.000Z" }), manifest.manifestFingerprint);
    const changedArtwork = structuredClone(manifest);
    changedArtwork.records[0].landscapeHash = "0".repeat(64);
    assert.notEqual(calculateManifestFingerprint(changedArtwork), manifest.manifestFingerprint);
  });
});

test("candidate statuses, rights boundary, and URL proposals are mandatory", async () => {
  await withSyntheticCandidate(async ({ root, manifest }) => {
    assert.ok(manifest.records.every((record) => record.ownerReviewStatus === "approved-artwork"));
    assert.ok(manifest.records.every((record) => record.distributionStatus === "publication-candidate"));
    assert.ok(manifest.records.every((record) => record.rightsStatus === "third-party-portrait-review-required"));
    assert.ok(manifest.records.every((record) => record.landscapeUrlProposal === proposedRawUrl(record.landscapePath)));
    assert.match(manifest.rightsNotice.codeLicenceSeparation, /Code and portrait rights are separate/u);
    const invalidRights = structuredClone(manifest);
    invalidRights.records[0].rightsStatus = "cleared";
    invalidRights.manifestFingerprint = calculateManifestFingerprint(invalidRights);
    const result = await validatePeopleArtworkManifest({ manifest: invalidRights, repoRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /rightsStatus/u.test(error)));
  });
});

test("owner review rows are deterministic and completed hold decisions validate", async () => {
  await withSyntheticCandidate(async ({ manifest }) => {
    const rows = buildOwnerReviewRows(manifest);
    assert.equal(csvDocument(OWNER_REVIEW_FIELDS, rows).split("\n")[0], OWNER_REVIEW_FIELDS.join(","));
    assert.ok(rows.every((row) => row.owner_publication_decision === "" && row.owner_note === ""));
    const completed = rows.map((row) => ({ ...row, owner_publication_decision: "hold", owner_note: "rights review pending" }));
    assert.deepEqual(validateOwnerDecisions(completed, manifest.records.map((record) => record.stableKey)), []);
    completed[0].owner_publication_decision = "automatic-publish";
    assert.ok(validateOwnerDecisions(completed, manifest.records.map((record) => record.stableKey)).length > 0);
  });
});

test("owner decisions bind the current identity, paths, source decision, and output hashes", async () => {
  await withSyntheticCandidate(async ({ manifest }) => {
    const rows = buildOwnerReviewRows(manifest).map((row) => ({ ...row, owner_publication_decision: "publish", owner_note: "approved" }));
    assert.deepEqual(validateOwnerDecisionBindings(rows, manifest), []);
    rows[0].landscape_hash = "0".repeat(64);
    assert.ok(validateOwnerDecisionBindings(rows, manifest).some((error) => /landscape_hash differs/u.test(error)));
  });
});

test("fallback records are never marked artwork-approved automatically", async () => {
  const person = { stableKey: "person:303", tmdbPersonId: 303, canonicalName: "Synthetic Fallback", categoryMembership: ["actor"] };
  const foundation = { actors: { records: [{ stableKey: person.stableKey, rolloutTier: "review" }] }, directors: { records: [] } };
  const metadata = { records: [{
    stableKey: person.stableKey,
    formatId: "landscape",
    sourceDecision: "registry-default",
    profilePathAttempted: null,
    sourceHash: null,
    sourceWidth: null,
    sourceHeight: null,
    fallbackUsed: true,
    fallbackReason: "no-profile-path",
    outputHash: sha256("synthetic-fallback-output"),
    byteCount: 123,
    presetId: "synthetic-fallback-v1",
    presetHash: sha256("synthetic-fallback-preset"),
    fontHash: sha256("synthetic-font"),
  }] };
  const manifest = await buildPeopleArtworkManifest({ people: [person], foundation, metadata, publicationCandidateAt: "2026-01-01T00:00:00.000Z", repoRoot });
  assert.equal(manifest.records[0].fallbackUsed, true);
  assert.equal(manifest.records[0].ownerReviewStatus, "revision-required");
  const invalid = structuredClone(manifest);
  invalid.records[0].ownerReviewStatus = "approved-artwork";
  invalid.manifestFingerprint = calculateManifestFingerprint(invalid);
  const validation = await validatePeopleArtworkManifest({ manifest: invalid, repoRoot });
  assert.ok(validation.errors.some((error) => /fallback artwork cannot be approved automatically/u.test(error)));
  const commitReady = structuredClone(manifest);
  commitReady.status = "commit-ready";
  commitReady.records[0].distributionStatus = "commit-ready";
  commitReady.manifestFingerprint = calculateManifestFingerprint(commitReady);
  const commitReadyValidation = await validatePeopleArtworkManifest({ manifest: commitReady, repoRoot });
  assert.ok(commitReadyValidation.errors.some((error) => /commit-ready artwork must be portrait-backed and approved/u.test(error)));
});

test("publication network accounting requires zero requests", () => {
  const accounting = zeroNetworkAccounting({
    sourceCacheHits: 2,
    profileImageDownloads: 0,
    imageCdnRequests: 0,
    tmdbMetadataRequests: 0,
    personImagesRequests: 0,
    fontDownloads: 0,
    generalWebRequests: 0,
    unauthorisedRequests: 0,
    attemptedRequests: [],
  }, 2);
  assert.equal(accounting.valid, true);
  assert.equal(accounting.imageDownloads, 0);
  assert.equal(zeroNetworkAccounting({ ...accounting, attemptedRequests: ["https://example.invalid"] }, 2).valid, false);
});

test("publication implementation contains no network opt-in, full-catalogue shortcut, commit, or push automation", async () => {
  const files = [
    path.join(packageRoot, "src", "people-publication.mjs"),
    path.join(packageRoot, "src", "people-publication-cli.mjs"),
  ];
  const source = (await Promise.all(files.map((filePath) => fs.readFile(filePath, "utf8")))).join("\n");
  assert.doesNotMatch(source, /--allow-network|allowNetwork|person\/images|search\/person/iu);
  assert.doesNotMatch(source, /argument === ["']--all["']/u);
  assert.doesNotMatch(source, /execFileSync\([^\n]+["'](?:commit|push)["']/u);
  assert.doesNotMatch(source, /spawn[^\n]+["'](?:commit|push)["']/u);
  assert.match(source, /offline:\s*true/u);
});

test("permanent people artwork contains only unchanged legacy generic JPGs", async () => {
  const expected = ["actor hero.jpg", "actors.jpg", "director hero.jpg", "directors.jpg", "jane_austen_collection.jpg", "people hero backdrop.jpg", "people.jpg"];
  const entries = await fs.readdir(path.join(repoRoot, PEOPLE_ASSET_RELATIVE_ROOT), { withFileTypes: true });
  assert.deepEqual(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jpg")).map((entry) => entry.name).sort(), expected.sort());
  assert.equal(entries.some((entry) => entry.name === "manifest.json" || entry.name === "landscape" || entry.name === "poster"), false);
});

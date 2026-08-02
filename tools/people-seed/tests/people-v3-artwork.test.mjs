import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { readPeopleFoundation } from "../src/people-validation.mjs";
import {
  buildPeoplePresentationManifest,
  calculatePresentationManifestFingerprint,
  inspectSharedPeopleHero,
  loadPeoplePresentationManifestSchema,
  validatePeoplePresentationManifest,
} from "../src/people-presentation-manifest.mjs";
import {
  buildPeopleV3ArtworkReadinessAudit,
  validatePeopleV3ArtworkReadinessAudit,
} from "../src/people-v3-artwork-readiness.mjs";
import {
  buildAtomicPublicationPlan,
  buildPeopleV3FullGenerationPlan,
} from "../src/people-v3-artwork-planning.mjs";
import {
  PEOPLE_V3_PORTRAIT_PROOF_SELECTION,
  selectPortraitProofPeople,
} from "../src/people-v3-artwork-proof.mjs";
import { loadPeopleArtworkRuntime } from "../src/people-artwork/runtime-dependencies.mjs";
import {
  TITLE_LOGO_PROOF_IDENTITIES,
  assertPeopleV3ProofPath,
  loadTitleLogoConfiguration,
  prepareTitleLogoRenderer,
  renderTitleLogo,
  selectTitleLogoProofPeople,
  validateTitleLogoOverrides,
} from "../src/people-artwork/title-logo.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const generatedAt = "2026-08-02T05:00:00.000Z";
const foundation = await readPeopleFoundation(repoRoot);
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "assets", "collection_covers", "people", "manifest.json"), "utf8"));
const runtime = loadPeopleArtworkRuntime();
const execFileAsync = promisify(execFile);

test("title-logo proof identities bind the exact tracked IDs, names, accents, punctuation, and categories", () => {
  const people = selectTitleLogoProofPeople(foundation);
  assert.deepEqual(people.map((person) => [person.tmdbPersonId, person.canonicalName]), TITLE_LOGO_PROOF_IDENTITIES);
  assert.deepEqual(people.find((person) => person.tmdbPersonId === 8630).categoryMembership, ["actor", "director"]);
  assert.deepEqual(people.find((person) => person.tmdbPersonId === 45400).categoryMembership, ["actor", "director"]);
  assert.equal(people.find((person) => person.tmdbPersonId === 47).canonicalName, "Björk");
  assert.equal(people.find((person) => person.tmdbPersonId === 60561).canonicalName, "Mo'Nique");
});

test("manual title-logo line-break overrides are empty by default and fail closed on identity or ordering drift", async () => {
  const configuration = await loadTitleLogoConfiguration({ registry: foundation.registry });
  assert.equal(configuration.overrides.recordCount, 0);
  assert.deepEqual(validateTitleLogoOverrides(configuration.overrides, JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "people-title-logo-line-break-overrides.schema.json"), "utf8")), { registry: foundation.registry }), []);
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "people-title-logo-line-break-overrides.schema.json"), "utf8"));
  const invalid = {
    ...configuration.overrides,
    recordCount: 2,
    records: [
      { stableKey: "person:47", tmdbPersonId: 47, canonicalName: "Björk", lines: ["Wrong"], reason: "test", status: "active" },
      { stableKey: "person:47", tmdbPersonId: 47, canonicalName: "Björk", lines: ["Björk"], reason: "test", status: "active" },
    ],
  };
  assert.match(validateTitleLogoOverrides(invalid, schema, { registry: foundation.registry }).join("\n"), /do not preserve|duplicate|ascending/u);
});

test("title-logo renderer is transparent, exact-size, and preserves the full proof set's canonical text", async () => {
  const people = selectTitleLogoProofPeople(foundation);
  const configuration = await loadTitleLogoConfiguration({ registry: foundation.registry });
  const prepared = await prepareTitleLogoRenderer({ people, configuration, runtime });
  for (const person of people) {
    const rendered = await renderTitleLogo({ person, ...prepared });
    assert.equal(rendered.record.presentationName, person.canonicalName.toLocaleUpperCase("en-US"));
    assert.equal(rendered.record.canonicalNameLines.join(" "), person.canonicalName);
    assert.equal(rendered.record.canvasWidth, 1863);
    assert.equal(rendered.record.canvasHeight, 673);
    assert.equal(rendered.record.alphaTransparent, true);
    assert.ok(Object.values(rendered.record.safeMargins).every((value) => value >= rendered.record.minimumCanvasMargin));
  }
});

test("two fresh-process complete title-logo proof replays are byte-identical", async () => {
  const workerPath = path.join(repoRoot, "tools", "people-seed", "scripts", "people-title-logo-proof-worker.mjs");
  const run = async () => JSON.parse((await execFileAsync(process.execPath, [workerPath, "--generated-at", generatedAt, "--hash-only"], {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  })).stdout);
  const first = await run();
  const second = await run();
  assert.equal(first.recordCount, TITLE_LOGO_PROOF_IDENTITIES.length);
  assert.deepEqual(first, second);
});

test("additive presentation manifest validates and its fingerprint excludes only timestamps and itself", async () => {
  const people = selectTitleLogoProofPeople(foundation).slice(0, 2).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const configuration = await loadTitleLogoConfiguration({ registry: foundation.registry });
  const titleLogoMetadata = {
    recordCount: people.length,
    presetHash: configuration.presetHash,
    fontHash: configuration.fontLock.fontSha256,
    fontLockHash: configuration.fontLockHash,
    records: people.map((person, index) => ({
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categories: person.categoryMembership,
      outputHash: String(index + 1).repeat(64),
      canvasWidth: 1863,
      canvasHeight: 673,
      byteCount: 20000 + index,
      ownerReviewStatus: "pending",
      fontFamily: "Cormorant Garamond",
      fontWeight: 700,
      licenceHash: configuration.fontLock.licenceSha256,
    })),
  };
  const hero = await inspectSharedPeopleHero({ repoRoot, sharp: runtime.sharp });
  const schema = await loadPeoplePresentationManifestSchema({ repoRoot });
  const candidate = buildPeoplePresentationManifest({ titleLogoMetadata, sharedHero: hero, generatedAt });
  assert.deepEqual(validatePeoplePresentationManifest(candidate, schema, { expectedPeople: people, expectedHero: hero }), []);
  const timestampChanged = structuredClone(candidate);
  timestampChanged.generatedAt = "2026-08-03T05:00:00.000Z";
  assert.equal(calculatePresentationManifestFingerprint(timestampChanged), candidate.manifestFingerprint);
  const contentChanged = structuredClone(candidate);
  contentChanged.records[0].canonicalName = "Wrong";
  assert.notEqual(calculatePresentationManifestFingerprint(contentChanged), candidate.manifestFingerprint);
  assert.equal(candidate.sharedHero.repositoryPath, "assets/collection_covers/people/people hero backdrop.jpg");
});

test("current artwork-readiness audit reconciles the exact 663-person delta without inventing sources", async () => {
  const audit = await buildPeopleV3ArtworkReadinessAudit({ repoRoot, generatedAt, runtime });
  assert.deepEqual(validatePeopleV3ArtworkReadinessAudit(audit), []);
  assert.deepEqual(audit.summary, {
    cataloguePeople: 1480,
    publishedManifestPeople: 817,
    runtimePeople: 817,
    catalogueOnlyPeople: 663,
    existingPublishedPeople: 817,
    usableProfilePaths: 496,
    missingProfilePaths: 167,
    usableExistingSourceCacheEntries: 0,
    sourcesRequiringAcquisition: 496,
    expectedFallbackCandidates: 167,
    recordsRequiringManualInvestigation: 167,
    applicableExistingCropOverrides: 0,
    newLandscapeAssetsRequired: 663,
    newPosterAssetsRequired: 663,
    newPortraitAssetsRequired: 1326,
    projectedTitleLogoAssets: 1480,
  });
  assert.deepEqual(audit.reconciliation.categoryMetadataChanges.map((record) => record.tmdbPersonId), [8630, 45400]);
  assert.deepEqual(audit.futureRuntimeCounts, { companies: 1820, networks: 572, people: 1480, totalEntities: 3872, landscapeAssets: 3872, posterAssets: 2052, totalAssets: 5924, presentationTitleLogosExcludedFromRuntimeTotals: 1480 });
  assert.equal(audit.sharedHero.sha256, "5d63ec7bf3c80d2b7437411d67471747749e136e5924840715fb85a49c62a840");
  assert.deepEqual(audit.sharedHero.dimensions, { width: 1695, height: 928 });
});

test("representative portrait selection is exact, catalogue-only, and retains unavailable mandatory identities for investigation", () => {
  const people = selectPortraitProofPeople({ ...foundation, manifest });
  assert.deepEqual(people.map((person) => [person.tmdbPersonId, person.canonicalName]), PEOPLE_V3_PORTRAIT_PROOF_SELECTION.map((record) => [record.tmdbPersonId, record.canonicalName]));
  assert.equal(people.length, 20);
  assert.deepEqual(people.filter((person) => !person.profilePath).map((person) => person.tmdbPersonId), [8, 56446, 62861]);
  assert.deepEqual(people.find((person) => person.tmdbPersonId === 4818).categoryMembership, ["actor", "director"]);
  assert.deepEqual(people.find((person) => person.tmdbPersonId === 8).categoryMembership, ["director"]);
});

test("full-generation and atomic-publication plans retain exact counts and remain non-authorising", async () => {
  const audit = await buildPeopleV3ArtworkReadinessAudit({ repoRoot, generatedAt, runtime });
  const generationPlan = buildPeopleV3FullGenerationPlan({
    audit,
    registry: foundation.registry,
    titleLogoMetadata: { recordCount: 1, records: [{ byteCount: 40000 }] },
    portraitMetadata: { records: [{ formatId: "landscape", byteCount: 40000 }, { formatId: "poster", byteCount: 100000 }] },
    presentationCandidateByteCount: 16000,
    generatedAt,
  });
  assert.equal(generationPlan.counts.totalNewPublicFiles, 2807);
  assert.equal(generationPlan.counts.existingPortraitFilesPreserved, 1634);
  assert.equal(generationPlan.exactScope.portraitAcquisitionPersonIds.length, 496);
  assert.equal(generationPlan.exactScope.fallbackOrInvestigationPersonIds.length, 167);
  assert.equal(generationPlan.exactScope.titleLogoPersonIds.length, 1480);
  const atomicPlan = buildAtomicPublicationPlan({ generationPlan, protectedState: audit.protectedState, generatedAt });
  assert.equal(atomicPlan.status, "not-authorised");
  assert.match(atomicPlan.order.map((record) => record.action).join("\n"), /atomically/u);
  assert.equal(atomicPlan.rollback.existing817PortraitPairs.includes("never overwritten"), true);
});

test("proof output guard accepts only ignored People v3 attempts and rejects permanent artwork", () => {
  const attempt = path.join(repoRoot, "tools", "people-seed", ".work", "people-v3-artwork-proof", "attempt-20260802T050000Z");
  assert.equal(assertPeopleV3ProofPath(attempt), attempt);
  assert.throws(() => assertPeopleV3ProofPath(path.join(repoRoot, "assets", "collection_covers", "people", "title-logo")), /must remain in a unique ignored attempt workspace/u);
});

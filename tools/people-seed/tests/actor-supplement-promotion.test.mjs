import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_EVIDENCE_SHA256,
  mergeActorSupplementFoundation,
  normalisePersonName,
  validateActorSupplement,
} from "../src/actor-supplement-promotion.mjs";
import { readPeopleFoundation, validatePeopleAssetBoundary, validatePeopleFoundation } from "../src/people-validation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const foundation = await readPeopleFoundation(repoRoot);
const supplementIds = new Set(foundation.supplement.records.map((record) => record.tmdbPersonId));

test("tracked supplement has the exact approved schema, decisions, tiers, and identities", () => {
  const result = validateActorSupplement(foundation.supplement, foundation.schemas.supplement);
  assert.deepEqual(result.errors, []);
  assert.equal(foundation.supplement.records.length, 198);
  assert.deepEqual(result.summary.tierDistribution, { initial: 95, later: 103 });
  assert.equal(foundation.supplement.records.filter((record) => record.rolloutTier === "review").length, 0);
  assert.ok(foundation.supplement.records.every((record) => record.identityStatus === "resolved"));
  assert.ok(foundation.supplement.records.every((record) => record.ownerInclusionDecision === "include"));
  assert.ok(foundation.supplement.records.every((record) => record.ownerTierDecision === record.rolloutTier));
  assert.equal(foundation.supplement.approvedEvidence.sha256, APPROVED_EVIDENCE_SHA256);
  assert.equal(new Set(foundation.supplement.records.map((record) => normalisePersonName(record.suppliedName))).size, 198);
  assert.equal(new Set(foundation.supplement.records.map((record) => record.tmdbPersonId)).size, 198);
});

test("approved canonical differences retain the owner spelling as an alias", () => {
  const differences = new Map([
    ["George “Buck” Flower", "George Buck Flower"],
    ["Govardhan Asrani", "Asrani"],
    ["Sammo Hung", "Sammo Hung Kam-Bo"],
    ["Emma D’Arcy", "Emma D'Arcy"],
    ["Lupita Nyong’o", "Lupita Nyong'o"],
  ]);
  for (const [suppliedName, canonicalName] of differences) {
    const record = foundation.supplement.records.find((item) => item.suppliedName === suppliedName);
    assert.equal(record.canonicalName, canonicalName);
    assert.ok(record.alsoKnownAs.includes(suppliedName));
  }
});

test("supplement sources are declared and memberships preserve approved evidence", () => {
  const declared = new Set(foundation.sources.sources.map((source) => source.sourceId));
  const memberships = foundation.supplement.records.flatMap((record) => record.sourceMemberships);
  assert.equal(foundation.supplement.sources.length, 7);
  assert.equal(foundation.sources.sources.length, 13);
  assert.equal(memberships.length, 332);
  assert.ok(memberships.every((membership) => declared.has(membership.sourceId)));
  assert.ok(foundation.supplement.records.every((record) => record.sourceMemberships.some((membership) => membership.sourceId === "owner-actor-supplement-2026-07")));
});

test("supplement validation rejects duplicate identities and unsupported source IDs", () => {
  const duplicate = structuredClone(foundation.supplement);
  duplicate.records[1].tmdbPersonId = duplicate.records[0].tmdbPersonId;
  assert.match(validateActorSupplement(duplicate, foundation.schemas.supplement).errors.join("\n"), /duplicate TMDB person IDs/);

  const unsupported = structuredClone(foundation.supplement);
  unsupported.records[0].sourceMemberships[0].sourceId = "unsupported-actor-source";
  assert.match(validateActorSupplement(unsupported, foundation.schemas.supplement).errors.join("\n"), /must be one of|declared sources/);
});

test("promotion adds 198 non-overlapping actors and preserves final foundation invariants", () => {
  const originalActors = foundation.actors.records.filter((record) => !record.selectionBasis.includes("owner-added"));
  assert.equal(originalActors.length, 325);
  assert.ok(originalActors.every((record) => !supplementIds.has(record.tmdbPersonId)));
  assert.equal(foundation.actors.records.length, 523);
  assert.equal(foundation.registry.records.length, 817);
  assert.equal(foundation.directors.records.length, 300);
  assert.equal(foundation.registry.records.filter((record) => record.categoryMembership.length === 2).length, 6);
  assert.deepEqual(validatePeopleFoundation(foundation).errors, []);
});

test("promotion merge is deterministic and idempotent", () => {
  const first = mergeActorSupplementFoundation({
    registry: foundation.registry,
    actors: foundation.actors,
    directors: foundation.directors,
    sources: foundation.sources,
    supplement: foundation.supplement,
  });
  const second = mergeActorSupplementFoundation({ ...first, supplement: foundation.supplement });
  assert.deepEqual(first, second);
  assert.deepEqual(first.registry, foundation.registry);
  assert.deepEqual(first.actors, foundation.actors);
  assert.deepEqual(first.directors, foundation.directors);
  assert.deepEqual(first.sources, foundation.sources);
});

test("actor-supplement promotion acquires no images and coexists with only the bounded published artwork", async () => {
  assert.deepEqual(await validatePeopleAssetBoundary(repoRoot), []);
  const peopleArtworkRoot = path.join(repoRoot, "assets", "collection_covers", "people");
  const existingGenericFiles = await fs.readdir(peopleArtworkRoot);
  assert.ok(existingGenericFiles.every((name) => !/^[1-9][0-9]*\.webp$/i.test(name)));
  assert.ok(existingGenericFiles.includes("manifest.json"));
  assert.ok(existingGenericFiles.includes("landscape"));
  assert.ok(existingGenericFiles.includes("poster"));
  const manifest = JSON.parse(await fs.readFile(path.join(peopleArtworkRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.status, "published");
  assert.equal(manifest.recordCount, 310);
  for (const formatId of ["landscape", "poster"]) {
    const files = await fs.readdir(path.join(peopleArtworkRoot, formatId));
    assert.equal(files.length, 310);
    assert.ok(files.every((name) => /^[1-9][0-9]*\.webp$/i.test(name)));
  }
  const productionManifestCandidates = [
    path.join(repoRoot, "assets", "collection_covers", "people-manifest.json"),
    path.join(repoRoot, "data", "people", "artwork-manifest.json"),
  ];
  for (const candidate of productionManifestCandidates) assert.equal(await fs.access(candidate).then(() => true, () => false), false);
});

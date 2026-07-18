import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readPeopleFoundation,
  validateChangedPaths,
  validatePeopleAssetBoundary,
  validatePeopleFoundation,
} from "../src/people-validation.mjs";
import { validateAgainstSchema } from "../src/schema-validator.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const registryPath = path.join(repoRoot, "data", "people", "people-registry.json");
const foundationAvailable = await fs.access(registryPath).then(() => true, () => false);
const integration = foundationAvailable ? test : test.skip;

function clone(foundation) {
  return structuredClone({
    registry: foundation.registry,
    actors: foundation.actors,
    directors: foundation.directors,
    sources: foundation.sources,
    supplement: foundation.supplement,
    schemas: foundation.schemas,
  });
}

function messages(result) {
  return result.errors.join("\n");
}

test("schema validator rejects invalid stable keys and additional fields", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["stableKey"],
    properties: { stableKey: { type: "string", pattern: "^person:[1-9][0-9]*$" } },
  };
  assert.deepEqual(validateAgainstSchema({ stableKey: "person:123" }, schema), []);
  assert.match(validateAgainstSchema({ stableKey: "actor:123" }, schema).join("\n"), /must match/);
  assert.match(validateAgainstSchema({ stableKey: "person:123", selectionTier: "core" }, schema).join("\n"), /additional property/);
});

integration("canonical people foundation validates fully offline", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network access is prohibited in people validation"); };
  try {
    const result = validatePeopleFoundation(foundation);
    assert.deepEqual(result.errors, []);
    assert.equal(result.summary.registryCount, 817);
    assert.equal(result.summary.actorCount, 523);
    assert.equal(result.summary.directorCount, 300);
    assert.equal(result.summary.sharedCount, 6);
    assert.deepEqual(result.summary.actorRollout, { initial: 295, later: 203, review: 25 });
    assert.deepEqual(result.summary.directorRollout, { initial: 154, later: 102, review: 44 });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

integration("invalid stable keys and duplicate registry IDs are rejected", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const invalidKey = clone(foundation);
  invalidKey.registry.records[0].stableKey = "actor:1";
  assert.match(messages(validatePeopleFoundation(invalidKey)), /stable key|must match/);

  const duplicate = clone(foundation);
  duplicate.registry.records.splice(1, 0, structuredClone(duplicate.registry.records[0]));
  duplicate.registry.recordCount += 1;
  assert.match(messages(validatePeopleFoundation(duplicate)), /duplicate TMDB person IDs|duplicate stable keys/);
});

integration("missing registry memberships and duplicate category memberships are rejected", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const missing = clone(foundation);
  const actorId = missing.actors.records[0].tmdbPersonId;
  missing.registry.records = missing.registry.records.filter((record) => record.tmdbPersonId !== actorId);
  missing.registry.recordCount -= 1;
  assert.match(messages(validatePeopleFoundation(missing)), /membership is missing from registry/);

  const duplicate = clone(foundation);
  duplicate.actors.records.splice(1, 0, structuredClone(duplicate.actors.records[0]));
  duplicate.actors.recordCount += 1;
  assert.match(messages(validatePeopleFoundation(duplicate)), /must not duplicate TMDB person IDs/);
});

integration("dual actor-director identities keep one registry record and separate category rollout", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const shared = foundation.registry.records.filter((record) => record.categoryMembership.length === 2);
  assert.equal(shared.length, 6);
  for (const person of shared) {
    assert.equal(foundation.actors.records.filter((record) => record.tmdbPersonId === person.tmdbPersonId).length, 1);
    assert.equal(foundation.directors.records.filter((record) => record.tmdbPersonId === person.tmdbPersonId).length, 1);
  }
  assert.ok(shared.some((person) => {
    const actor = foundation.actors.records.find((record) => record.tmdbPersonId === person.tmdbPersonId);
    const director = foundation.directors.records.find((record) => record.tmdbPersonId === person.tmdbPersonId);
    return actor.rolloutTier !== director.rolloutTier;
  }), "at least one shared person should demonstrate category-specific rollout state");
  assert.ok(shared.every((person) => !Object.hasOwn(person, "rolloutTier")));
});

integration("source occurrences retain Ranker boundaries, team expansion, and repeated same-source ranks", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const memberships = foundation.registry.records.flatMap((record) => record.sourceMemberships);
  const rankerRanks = memberships.filter((item) => item.sourceId === "ranker-actors").map((item) => item.sourceRank).sort((a, b) => a - b);
  assert.deepEqual(rankerRanks, Array.from({ length: 300 }, (_, index) => index + 1));
  assert.equal(memberships.filter((item) => item.sourceRowType === "directing-team-member").length, 18);
  const michael = foundation.directors.records.find((record) => record.canonicalName === "Michael Powell");
  assert.deepEqual(michael.sourceRanks["tspdt-directors"], [35, 210]);
  const validation = validatePeopleFoundation(foundation);
  assert.deepEqual(validation.errors, []);
});

integration("rollout counts and deterministic ordering are enforced", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const badRollout = clone(foundation);
  badRollout.actors.records[0].rolloutTier = "review";
  assert.match(messages(validatePeopleFoundation(badRollout)), /rollout tier does not match|rollout counts/);

  const badOrder = clone(foundation);
  [badOrder.directors.records[0], badOrder.directors.records[1]] = [badOrder.directors.records[1], badOrder.directors.records[0]];
  assert.match(messages(validatePeopleFoundation(badOrder)), /numeric TMDB-ID ordering/);
});

integration("external artwork URLs and local absolute paths are rejected", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const externalUrl = clone(foundation);
  externalUrl.registry.records[0].identityEvidence.push("https://example.com/portrait.jpg");
  assert.match(messages(validatePeopleFoundation(externalUrl)), /external URL is allowed only for sourceUrl provenance/);

  const absolutePath = clone(foundation);
  absolutePath.registry.records[0].profilePath = "C:\\portraits\\person.jpg";
  assert.match(messages(validatePeopleFoundation(absolutePath)), /local absolute path|must match/);
});

integration("selection policy preserves original proposals and explicit supplement approval", async () => {
  const foundation = await readPeopleFoundation(repoRoot);
  const actorReview = foundation.actors.records.filter((record) => record.rolloutTier === "review");
  assert.equal(actorReview.length, 25);
  assert.ok(actorReview.every((record) => record.selectionBasis.includes("external-supplement")));
  assert.ok(actorReview.every((record) => !record.selectionBasis.includes("modern-supplement")));
  const promoted = foundation.actors.records.filter((record) => record.selectionBasis.includes("owner-added"));
  assert.equal(promoted.length, 198);
  assert.ok(promoted.every((record) => record.ownerDecision === "include" && record.selectionStatus === "owner-decided"));
  const original = [...foundation.actors.records.filter((record) => !record.selectionBasis.includes("owner-added")), ...foundation.directors.records];
  assert.ok(original.every((record) => record.ownerDecision === null && record.selectionStatus === "proposed"));
});

test("write-boundary validation protects studio/network and unrecognised people paths while accepting the validated publication architecture", async () => {
  assert.deepEqual(validateChangedPaths([
    "data/people/people-registry.json",
    "schemas/people-registry.schema.json",
    "tools/people-seed/src/people-validation.mjs",
  ]), []);
  const errors = validateChangedPaths([
    "tools/studio-network-batch/config/review-state.json",
    "assets/collection_covers/companies/1.webp",
    "assets/collection_covers/people/123.webp",
    "assets/collection_covers/manifest.json",
  ]);
  assert.equal(errors.length, 4);
  assert.deepEqual(validateChangedPaths([
    "assets/collection_covers/people/manifest.json",
    "assets/collection_covers/people/landscape/123.webp",
    "assets/collection_covers/people/poster/123.webp",
  ]), []);
  if (foundationAvailable) assert.deepEqual(await validatePeopleAssetBoundary(repoRoot), []);
});

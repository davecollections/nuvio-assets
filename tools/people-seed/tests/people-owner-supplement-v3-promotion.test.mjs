import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTHORITY_SOURCE_RELATIVE_PATH,
  AUTHORITY_SOURCE_SHA256,
  V3_ACTOR_SOURCE_ID,
  V3_DIRECTOR_SOURCE_ID,
  activeAliasesForV3Record,
  authoritativePackagePayload,
  mergePeopleOwnerSupplementV3Foundation,
  stripPeopleOwnerSupplementV3Foundation,
  validatePeopleOwnerSupplementV3,
  validatePromotedPeopleOwnerSupplementV3Foundation,
} from "../src/people-owner-supplement-v3-promotion.mjs";
import { readPeopleFoundation, sourceMembershipFingerprint, validatePeopleFoundation } from "../src/people-validation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const foundation = await readPeopleFoundation(repoRoot);
const trackedSupplementRaw = await fs.readFile(path.join(repoRoot, "data", "people", "people-owner-supplement-v3.json"), "utf8");
const authorityPath = path.join(repoRoot, AUTHORITY_SOURCE_RELATIVE_PATH);
const authorityRaw = await fs.readFile(authorityPath).catch(() => null);
const stripped = stripPeopleOwnerSupplementV3Foundation({
  registry: foundation.registry,
  actors: foundation.actors,
  directors: foundation.directors,
  sources: foundation.sources,
  supplement: foundation.ownerSupplementV3,
});

const clone = (value) => structuredClone(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const messages = (result) => result.errors.join("\n");

test("tracked v3 supplement is strict, deterministic, and complete", () => {
  const result = validatePeopleOwnerSupplementV3(foundation.ownerSupplementV3, {
    schema: foundation.schemas.ownerSupplementV3,
    authoritativeRaw: Buffer.from(authoritativePackagePayload(foundation.ownerSupplementV3), "utf8"),
    baseline: stripped,
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.summary, {
    valid: true,
    authoritativeSha256: AUTHORITY_SOURCE_SHA256,
    recordCount: 665,
    actorActionCount: 548,
    directorActionCount: 118,
    categoryActionCount: 666,
    netNewIdentityCount: 663,
    existingIdentityMembershipAdditionCount: 2,
    activeAliasExclusionCount: 32,
  });
  assert.equal(trackedSupplementRaw, `${JSON.stringify(foundation.ownerSupplementV3, null, 2)}\n`);
  assert.equal(sha256(authoritativePackagePayload(foundation.ownerSupplementV3)), AUTHORITY_SOURCE_SHA256);
});

test("ignored authoritative source matches the tracked package exactly when available", { skip: authorityRaw === null }, () => {
  assert.equal(sha256(authorityRaw), AUTHORITY_SOURCE_SHA256);
  assert.deepEqual(validatePeopleOwnerSupplementV3(foundation.ownerSupplementV3, {
    schema: foundation.schemas.ownerSupplementV3,
    authoritativeRaw: authorityRaw,
    baseline: stripped,
  }).errors, []);
});

test("exact set arithmetic produces the approved final catalogue without removals", () => {
  assert.deepEqual(
    [stripped.registry.recordCount, stripped.actors.recordCount, stripped.directors.recordCount, stripped.sources.sourceCount, stripped.registry.sourceMembershipCount],
    [817, 523, 300, 13, 1069],
  );
  assert.deepEqual(
    [foundation.registry.recordCount, foundation.actors.recordCount, foundation.directors.recordCount, foundation.sources.sourceCount, foundation.registry.sourceMembershipCount],
    [1480, 1071, 418, 15, 1735],
  );

  const finalRegistryIds = new Set(foundation.registry.records.map((record) => record.tmdbPersonId));
  const finalActorIds = new Set(foundation.actors.records.map((record) => record.tmdbPersonId));
  const finalDirectorIds = new Set(foundation.directors.records.map((record) => record.tmdbPersonId));
  assert.ok(stripped.registry.records.every((record) => finalRegistryIds.has(record.tmdbPersonId)));
  assert.ok(stripped.actors.records.every((record) => finalActorIds.has(record.tmdbPersonId)));
  assert.ok(stripped.directors.records.every((record) => finalDirectorIds.has(record.tmdbPersonId)));

  const overlaps = foundation.registry.records
    .filter((record) => finalActorIds.has(record.tmdbPersonId) && finalDirectorIds.has(record.tmdbPersonId))
    .map(({ tmdbPersonId, canonicalName }) => ({ tmdbPersonId, canonicalName }));
  assert.deepEqual(overlaps, [
    { tmdbPersonId: 40, canonicalName: "Orson Welles" },
    { tmdbPersonId: 190, canonicalName: "Clint Eastwood" },
    { tmdbPersonId: 4818, canonicalName: "Roberto Benigni" },
    { tmdbPersonId: 8630, canonicalName: "Erich von Stroheim" },
    { tmdbPersonId: 8635, canonicalName: "Buster Keaton" },
    { tmdbPersonId: 13294, canonicalName: "Gene Kelly" },
    { tmdbPersonId: 13848, canonicalName: "Charlie Chaplin" },
    { tmdbPersonId: 14639, canonicalName: "Mel Brooks" },
    { tmdbPersonId: 45400, canonicalName: "Greta Gerwig" },
  ]);
});

test("special membership actions bind to exact existing or new TMDB identities", () => {
  const byId = new Map(foundation.registry.records.map((record) => [record.tmdbPersonId, record]));
  const actorIds = new Set(foundation.actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(foundation.directors.records.map((record) => record.tmdbPersonId));
  for (const id of [8630, 45400]) {
    assert.ok(stripped.registry.records.some((record) => record.tmdbPersonId === id));
    assert.equal(new Set(stripped.actors.records.map((record) => record.tmdbPersonId)).has(id), false);
    assert.ok(actorIds.has(id));
    assert.ok(directorIds.has(id));
    assert.deepEqual(byId.get(id).categoryMembership, ["actor", "director"]);
  }
  assert.equal(stripped.registry.records.some((record) => record.tmdbPersonId === 4818), false);
  assert.ok(actorIds.has(4818));
  assert.ok(directorIds.has(4818));
  assert.equal(foundation.registry.records.filter((record) => record.tmdbPersonId === 4818).length, 1);
});

test("v3 provenance is complete without fabricated ranks or retrieval timestamps", () => {
  const sourceIds = new Set([V3_ACTOR_SOURCE_ID, V3_DIRECTOR_SOURCE_ID]);
  const definitions = foundation.sources.sources.filter((source) => sourceIds.has(source.sourceId));
  assert.equal(definitions.length, 2);
  assert.ok(definitions.every((source) => source.sourceFile === "data/people/people-owner-supplement-v3.json"));
  assert.ok(definitions.every((source) => source.retrievalTimestamp === null && source.sourceHash.value === AUTHORITY_SOURCE_SHA256));
  const occurrences = foundation.registry.records.flatMap((record) => record.sourceMemberships).filter((membership) => sourceIds.has(membership.sourceId));
  assert.equal(occurrences.length, 666);
  assert.equal(occurrences.filter((membership) => membership.sourceId === V3_ACTOR_SOURCE_ID).length, 548);
  assert.equal(occurrences.filter((membership) => membership.sourceId === V3_DIRECTOR_SOURCE_ID).length, 118);
  assert.ok(occurrences.every((membership) => membership.sourceRank === null && membership.ownerDecision === "include"));
});

test("unsupported alias sentinels remain evidence-only and cannot move between identities", () => {
  const sourceRecords = foundation.ownerSupplementV3.package.records;
  const sentinelRecords = sourceRecords.filter((record) => record.aliases.includes("-"));
  assert.equal(sentinelRecords.length, 32);
  assert.equal(sourceRecords.reduce((count, record) => count + record.aliases.filter((alias) => alias === "-").length, 0), 32);
  for (const sourceRecord of sourceRecords) {
    const active = foundation.registry.records.find((record) => record.tmdbPersonId === sourceRecord.tmdbPersonId);
    assert.deepEqual(active.alsoKnownAs, activeAliasesForV3Record(sourceRecord, foundation.ownerSupplementV3.promotionMapping));
    assert.equal(active.alsoKnownAs.includes("-"), false);
  }
});

test("promotion is deterministic, idempotent, and matches the tracked foundation", () => {
  const first = mergePeopleOwnerSupplementV3Foundation({ ...stripped, supplement: foundation.ownerSupplementV3 });
  const second = mergePeopleOwnerSupplementV3Foundation({ ...first, supplement: foundation.ownerSupplementV3 });
  for (const name of ["registry", "actors", "directors", "sources"]) {
    assert.deepEqual(first[name], foundation[name]);
    assert.deepEqual(second[name], first[name]);
  }
  assert.deepEqual(validatePromotedPeopleOwnerSupplementV3Foundation({
    ...foundation,
    supplement: foundation.ownerSupplementV3,
    baseline: stripped,
  }).errors, []);
  assert.deepEqual(validatePeopleFoundation(foundation).errors, []);
});

test("foundation validation rejects fabricated v3 source names, ranks, retrieval timestamps, and source definitions", () => {
  const validationInput = () => clone({
    registry: foundation.registry,
    actors: foundation.actors,
    directors: foundation.directors,
    sources: foundation.sources,
    supplement: foundation.supplement,
    ownerSupplementV3: foundation.ownerSupplementV3,
    schemas: foundation.schemas,
  });
  const cases = [
    ["source name", (value) => {
      value.registry.records.find((record) => record.tmdbPersonId === 4818).sourceMemberships
        .find((membership) => membership.sourceId === V3_ACTOR_SOURCE_ID).sourceName = "Wrong Person";
    }],
    ["source rank", (value) => {
      value.registry.records.find((record) => record.tmdbPersonId === 4818).sourceMemberships
        .find((membership) => membership.sourceId === V3_ACTOR_SOURCE_ID).sourceRank = 1;
      value.actors.records.find((record) => record.tmdbPersonId === 4818).sourceRanks = { [V3_ACTOR_SOURCE_ID]: [1] };
    }],
    ["retrieval timestamp", (value) => {
      value.sources.sources.find((source) => source.sourceId === V3_ACTOR_SOURCE_ID).retrievalTimestamp = "2026-08-02T00:00:00.000Z";
    }],
    ["source definition", (value) => {
      value.sources.sources.find((source) => source.sourceId === V3_ACTOR_SOURCE_ID).displayTitle = "Fabricated title";
    }],
  ];
  for (const [label, mutate] of cases) {
    const value = validationInput();
    mutate(value);
    value.registry.sourceMembershipFingerprint = sourceMembershipFingerprint(value.registry.records);
    assert.match(messages(validatePeopleFoundation(value)), /People v3 exact projection: .*differs from the exact deterministic v3 merge/s, label);
  }
});

test("validator rejects authority, identity, action, rollout, decision, state, and namespace drift", () => {
  const cases = [
    ["source SHA", (value) => { value.authoritativeSource.sha256 = "0".repeat(64); }, /authoritative source binding mismatch|must equal/],
    ["missing identity", (value) => { value.package.records.pop(); value.package.recordCount -= 1; }, /must contain 665 records|payload SHA-256 mismatch/],
    ["duplicate identity", (value) => { value.package.records[1].tmdbPersonId = value.package.records[0].tmdbPersonId; }, /duplicate TMDB Person IDs/],
    ["duplicate category", (value) => { value.package.records[0].categoryMembershipActions.push(clone(value.package.records[0].categoryMembershipActions[0])); }, /duplicate category actions|unique items|at most 2/],
    ["rollout", (value) => { value.package.records[0].recommendedRollout = "later"; }, /rollout must be initial|must equal/],
    ["owner decision", (value) => { value.package.records[0].ownerDecision = "hold"; }, /owner decision must be include|must equal/],
    ["current state", (value) => { value.package.records[0].createsNetNewPersonIdentity = false; }, /current registry and net-new fields disagree/],
    ["canonical identity", (value) => { value.package.records.find((record) => record.tmdbPersonId === 45400).canonicalName = "Wrong Person"; }, /existing canonical name conflicts/],
    ["identifier namespace", (value) => { value.package.records[0].imdbPersonId = "nm0000001"; }, /unsupported identifier namespace|additional property/],
    ["malformed action", (value) => { value.package.records[0].categoryMembershipActions[0] = null; }, /record collections are missing or malformed|must have type object/],
    ["malformed approval source", (value) => { value.package.records[0].approvalSources[0] = null; }, /record collections are missing or malformed|must have type object/],
    ["malformed records collection", (value) => { value.package.records = {}; }, /records must have type array|must contain 665 records/],
    ["malformed alias sentinel mapping", (value) => { value.promotionMapping.unsupportedAliasSentinels = 5; }, /unsupportedAliasSentinels.*must have type array/s],
    ["malformed baseline overlap entry", (value) => { value.package.baseline.overlapPeople[0] = null; }, /baseline overlap entries are malformed|must have type object/],
    ["malformed projected overlap entry", (value) => { value.package.projectedOverlapPeople[0] = null; }, /projected overlap entries are malformed|must have type object/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const value = clone(foundation.ownerSupplementV3);
    mutate(value);
    assert.match(messages(validatePeopleOwnerSupplementV3(value, {
      schema: foundation.schemas.ownerSupplementV3,
      baseline: stripped,
    })), pattern, label);
  }
});

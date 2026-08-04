#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  AUTHORITY_SOURCE_RELATIVE_PATH,
  AUTHORITY_SOURCE_SHA256,
  PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS,
  PROMOTION_TIMESTAMP,
  TRACKED_SUPPLEMENT_RELATIVE_PATH,
  buildTrackedPeopleOwnerSupplementV3,
  mergePeopleOwnerSupplementV3Foundation,
  stripPeopleOwnerSupplementV3Foundation,
  validatePeopleOwnerSupplementV3,
  validatePromotedPeopleOwnerSupplementV3Foundation,
} from "../src/people-owner-supplement-v3-promotion.mjs";
import { validateAgainstSchema } from "../src/schema-validator.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const dataRoot = path.join(repoRoot, "data", "people");
const workRoot = path.join(packageRoot, ".work", "people-catalogue-v3-promotion");
const previewRoot = path.join(workRoot, "preview");
const baselineRoot = path.join(previewRoot, "before", "data", "people");
const runRoots = [1, 2].map((number) => path.join(previewRoot, `run-${number}`, "data", "people"));
const reviewRoot = path.join(workRoot, "review");
const supplementPath = path.join(repoRoot, TRACKED_SUPPLEMENT_RELATIVE_PATH);
const supplementSchemaRelativePath = "schemas/people-owner-supplement-v3.schema.json";
const supplementSchemaPath = path.join(repoRoot, supplementSchemaRelativePath);
const authorityPath = path.join(repoRoot, AUTHORITY_SOURCE_RELATIVE_PATH);

const canonicalFiles = Object.freeze({
  registry: Object.freeze({
    fileName: "people-registry.json",
    relativePath: "data/people/people-registry.json",
    schemaRelativePath: "schemas/people-registry.schema.json",
    collection: "records",
    key: "tmdbPersonId",
  }),
  actors: Object.freeze({
    fileName: "actors-seed.json",
    relativePath: "data/people/actors-seed.json",
    schemaRelativePath: "schemas/people-seed.schema.json",
    collection: "records",
    key: "tmdbPersonId",
  }),
  directors: Object.freeze({
    fileName: "directors-seed.json",
    relativePath: "data/people/directors-seed.json",
    schemaRelativePath: "schemas/people-seed.schema.json",
    collection: "records",
    key: "tmdbPersonId",
  }),
  sources: Object.freeze({
    fileName: "sources.json",
    relativePath: "data/people/sources.json",
    schemaRelativePath: "schemas/people-sources.schema.json",
    collection: "sources",
    key: "sourceId",
  }),
});

const protectedPaths = Object.freeze([
  "data/people/actor-owner-supplement.json",
  "assets/collection_covers/people",
  "assets/collection_covers/runtime-lookup.json",
  "assets/collection_covers/companies",
  "assets/collection_covers/networks",
  "assets/collection_covers/manifest.json",
]);

const previewFiles = Object.freeze({
  baselineLock: path.join(previewRoot, "baseline-lock.json"),
  projectedHashes: path.join(previewRoot, "projected-file-hashes.json"),
  reconciliation: path.join(previewRoot, "reconciliation.json"),
  summary: path.join(previewRoot, "promotion-summary.json"),
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const posixPath = (value) => value.replaceAll("\\", "/");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sortedNumeric = (values) => [...values].sort((left, right) => left - right);
const sortedText = (values) => [...values].sort((left, right) => left.localeCompare(right));

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readFoundation(directory = dataRoot) {
  return Object.fromEntries(await Promise.all(Object.entries(canonicalFiles).map(async ([name, definition]) => {
    const raw = await fs.readFile(path.join(directory, definition.fileName));
    return [name, { raw, value: JSON.parse(raw.toString("utf8")) }];
  })));
}

function foundationValues(foundation) {
  return Object.fromEntries(Object.entries(canonicalFiles).map(([name]) => [name, foundation[name].value]));
}

function serializeFoundation(foundation) {
  return Object.fromEntries(Object.entries(canonicalFiles).map(([name]) => [name, Buffer.from(json(foundation[name]), "utf8")]));
}

function canonicalFingerprints(rawByName) {
  return Object.fromEntries(Object.entries(canonicalFiles).map(([name, definition]) => [name, {
    path: definition.relativePath,
    bytes: rawByName[name].length,
    sha256: sha256(rawByName[name]),
  }]));
}

function sameCanonicalBytes(left, right) {
  return Object.keys(canonicalFiles).every((name) => left[name].equals(right[name]));
}

async function writeFoundationTree(directory, rawByName) {
  await Promise.all(Object.entries(canonicalFiles).map(([name, definition]) => (
    atomicWrite(path.join(directory, definition.fileName), rawByName[name])
  )));
}

async function validateCanonicalSchemas(foundation) {
  const schemas = new Map();
  for (const definition of Object.values(canonicalFiles)) {
    if (!schemas.has(definition.schemaRelativePath)) {
      schemas.set(definition.schemaRelativePath, await readJson(path.join(repoRoot, definition.schemaRelativePath)));
    }
  }
  const errors = [];
  for (const [name, definition] of Object.entries(canonicalFiles)) {
    errors.push(...validateAgainstSchema(foundation[name], schemas.get(definition.schemaRelativePath), definition.relativePath));
  }
  return errors;
}

async function hashTree(target) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, fileCount: 0, byteCount: 0, sha256: null };
    throw error;
  }
  if (stat.isFile()) {
    const contents = await fs.readFile(target);
    return { exists: true, fileCount: 1, byteCount: contents.length, sha256: sha256(contents) };
  }
  assert(stat.isDirectory(), `Protected path is neither a regular file nor a directory: ${target}`);
  const files = [];
  async function walk(directory) {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
      else throw new Error(`Protected tree contains an unsupported filesystem entry: ${fullPath}`);
    }
  }
  await walk(target);
  const entries = await Promise.all(files.map(async (filePath) => {
    const contents = await fs.readFile(filePath);
    return {
      path: posixPath(path.relative(target, filePath)),
      bytes: contents.length,
      sha256: sha256(contents),
    };
  }));
  const byteCount = entries.reduce((sum, item) => sum + item.bytes, 0);
  const fingerprintPayload = entries.map((item) => `${item.path}\0${item.bytes}\0${item.sha256}`).join("\n");
  return { exists: true, fileCount: entries.length, byteCount, sha256: sha256(fingerprintPayload) };
}

async function protectedSnapshot() {
  return Promise.all(protectedPaths.map(async (relativePath) => ({
    path: relativePath,
    ...await hashTree(path.join(repoRoot, relativePath)),
  })));
}

function compareProtected(expected, actual) {
  const actualByPath = new Map(actual.map((item) => [item.path, item]));
  return expected.map((before) => {
    const current = actualByPath.get(before.path) ?? { exists: false, fileCount: 0, byteCount: 0, sha256: null };
    return {
      path: before.path,
      before,
      current,
      unchanged: isDeepStrictEqual(before, current),
    };
  });
}

function collectionDiff(beforeDocument, afterDocument, definition) {
  const beforeRecords = beforeDocument[definition.collection];
  const afterRecords = afterDocument[definition.collection];
  const beforeByKey = new Map(beforeRecords.map((record) => [record[definition.key], record]));
  const afterByKey = new Map(afterRecords.map((record) => [record[definition.key], record]));
  const comparator = definition.key === "tmdbPersonId"
    ? (left, right) => left - right
    : (left, right) => left.localeCompare(right);
  const addedKeys = [...afterByKey.keys()].filter((key) => !beforeByKey.has(key)).sort(comparator);
  const removedKeys = [...beforeByKey.keys()].filter((key) => !afterByKey.has(key)).sort(comparator);
  const modifiedKeys = [...beforeByKey.keys()]
    .filter((key) => afterByKey.has(key) && !isDeepStrictEqual(beforeByKey.get(key), afterByKey.get(key)))
    .sort(comparator);
  const unchangedKeys = [...beforeByKey.keys()]
    .filter((key) => afterByKey.has(key) && isDeepStrictEqual(beforeByKey.get(key), afterByKey.get(key)))
    .sort(comparator);
  return {
    beforeCount: beforeRecords.length,
    afterCount: afterRecords.length,
    addedCount: addedKeys.length,
    removedCount: removedKeys.length,
    modifiedCount: modifiedKeys.length,
    unchangedCount: unchangedKeys.length,
    addedKeys,
    removedKeys,
    modifiedKeys,
    unchangedKeys,
  };
}

function overlapRecords(foundation) {
  const actorIds = new Set(foundation.actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(foundation.directors.records.map((record) => record.tmdbPersonId));
  const registryById = new Map(foundation.registry.records.map((record) => [record.tmdbPersonId, record]));
  return sortedNumeric([...actorIds].filter((id) => directorIds.has(id))).map((tmdbPersonId) => ({
    tmdbPersonId,
    stableKey: `person:${tmdbPersonId}`,
    canonicalName: registryById.get(tmdbPersonId)?.canonicalName ?? null,
  }));
}

function sourceMembershipDiff(before, after) {
  const encode = (record, membership) => `${record.stableKey}\0${JSON.stringify(membership)}`;
  const collect = (records) => new Map(records.flatMap((record) => record.sourceMemberships.map((membership) => [
    encode(record, membership),
    { stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, membership },
  ])));
  const beforeMemberships = collect(before.registry.records);
  const afterMemberships = collect(after.registry.records);
  const additions = sortedText([...afterMemberships.keys()].filter((key) => !beforeMemberships.has(key)))
    .map((key) => afterMemberships.get(key));
  const removals = sortedText([...beforeMemberships.keys()].filter((key) => !afterMemberships.has(key)))
    .map((key) => beforeMemberships.get(key));
  return { addedCount: additions.length, removedCount: removals.length, additions, removals };
}

function specialCaseRecord(before, after, tmdbPersonId) {
  const recordFor = (foundation, category) => foundation[category].records.find((record) => record.tmdbPersonId === tmdbPersonId) ?? null;
  return {
    tmdbPersonId,
    stableKey: `person:${tmdbPersonId}`,
    canonicalName: recordFor(after, "registry")?.canonicalName ?? recordFor(before, "registry")?.canonicalName ?? null,
    before: {
      registry: recordFor(before, "registry"),
      actor: recordFor(before, "actors"),
      director: recordFor(before, "directors"),
    },
    after: {
      registry: recordFor(after, "registry"),
      actor: recordFor(after, "actors"),
      director: recordFor(after, "directors"),
    },
  };
}

function reconcileFoundation(before, after, supplement) {
  const files = Object.fromEntries(Object.entries(canonicalFiles).map(([name, definition]) => [
    name,
    collectionDiff(before[name], after[name], definition),
  ]));
  const beforeRegistryIds = new Set(before.registry.records.map((record) => record.tmdbPersonId));
  const newRegistryIds = new Set(files.registry.addedKeys);
  const actorAdditions = files.actors.addedKeys;
  const directorAdditions = files.directors.addedKeys;
  const actualPairs = [
    ...actorAdditions.map((id) => `${id}:actor`),
    ...directorAdditions.map((id) => `${id}:director`),
  ].sort();
  const expectedPairs = supplement.package.records.flatMap((record) => (
    record.categoryMembershipActions.map((action) => `${record.tmdbPersonId}:${action.category}`)
  )).sort();
  const beforeOverlaps = overlapRecords(before);
  const afterOverlaps = overlapRecords(after);
  const beforeOverlapIds = new Set(beforeOverlaps.map((record) => record.tmdbPersonId));
  const membershipChanges = sourceMembershipDiff(before, after);
  const result = {
    version: "people-catalogue-v3-reconciliation-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    authority: { path: AUTHORITY_SOURCE_RELATIVE_PATH, sha256: AUTHORITY_SOURCE_SHA256 },
    counts: {
      before: {
        registry: before.registry.records.length,
        actors: before.actors.records.length,
        directors: before.directors.records.length,
        sources: before.sources.sources.length,
        sourceMemberships: before.registry.sourceMembershipCount,
      },
      after: {
        registry: after.registry.records.length,
        actors: after.actors.records.length,
        directors: after.directors.records.length,
        sources: after.sources.sources.length,
        sourceMemberships: after.registry.sourceMembershipCount,
      },
    },
    actions: {
      expectedCategoryPairs: expectedPairs,
      actualCategoryPairs: actualPairs,
      exactAuthorityMatch: isDeepStrictEqual(actualPairs, expectedPairs),
      uniqueApprovedIdentities: new Set(expectedPairs.map((pair) => Number.parseInt(pair, 10))).size,
      total: actualPairs.length,
      actor: {
        total: actorAdditions.length,
        onNewIdentities: actorAdditions.filter((id) => newRegistryIds.has(id)).length,
        onExistingIdentities: actorAdditions.filter((id) => beforeRegistryIds.has(id)).length,
        addedIds: actorAdditions,
      },
      director: {
        total: directorAdditions.length,
        onNewIdentities: directorAdditions.filter((id) => newRegistryIds.has(id)).length,
        onExistingIdentities: directorAdditions.filter((id) => beforeRegistryIds.has(id)).length,
        addedIds: directorAdditions,
      },
    },
    identities: {
      newRegistryIdentityCount: files.registry.addedCount,
      newRegistryIds: files.registry.addedKeys,
      unchangedExistingPeopleCount: files.registry.unchangedCount,
      modifiedExistingPeopleCount: files.registry.modifiedCount,
      modifiedExistingIds: files.registry.modifiedKeys,
    },
    overlaps: {
      before: beforeOverlaps,
      after: afterOverlaps,
      new: afterOverlaps.filter((record) => !beforeOverlapIds.has(record.tmdbPersonId)),
    },
    files,
    sourceProvenance: {
      addedSourceDefinitions: files.sources.addedKeys.map((sourceId) => after.sources.sources.find((source) => source.sourceId === sourceId)),
      modifiedSourceDefinitionIds: files.sources.modifiedKeys,
      sourceMemberships: membershipChanges,
    },
    specialCases: {
      robertoBenigni: specialCaseRecord(before, after, 4818),
      erichVonStroheim: specialCaseRecord(before, after, 8630),
      gretaGerwig: specialCaseRecord(before, after, 45400),
    },
    preservation: {
      noExistingIdentityRemoved: files.registry.removedCount === 0,
      noActorMembershipRemoved: files.actors.removedCount === 0,
      noDirectorMembershipRemoved: files.directors.removedCount === 0,
      noSourceDefinitionRemoved: files.sources.removedCount === 0,
      noSourceMembershipRemoved: membershipChanges.removedCount === 0,
    },
  };
  return result;
}

function assertExactReconciliation(reconciliation, supplement) {
  const counts = supplement.package.counts;
  const expectedOverlapIds = supplement.package.projectedOverlapPeople.map((record) => record.tmdbPersonId);
  const actualOverlapIds = reconciliation.overlaps.after.map((record) => record.tmdbPersonId);
  assert(reconciliation.actions.exactAuthorityMatch, "Projected category actions differ from the exact authoritative v3 package.");
  assert(reconciliation.actions.uniqueApprovedIdentities === counts.uniqueIdentitiesInApprovalPackage, "Unique approved identity count mismatch.");
  assert(reconciliation.actions.total === counts.totalNewCategoryMemberships, "Total category-action count mismatch.");
  assert(reconciliation.actions.actor.total === counts.approvedActorMembershipAdditions, "Actor action count mismatch.");
  assert(reconciliation.actions.director.total === counts.approvedDirectorMembershipAdditions, "Director action count mismatch.");
  assert(reconciliation.identities.newRegistryIdentityCount === counts.netNewRegistryIdentities, "Net-new registry identity count mismatch.");
  assert(reconciliation.actions.actor.onExistingIdentities === 2, "Expected exactly two Actor additions on existing identities.");
  assert(reconciliation.actions.director.onExistingIdentities === 0, "Expected zero Director additions on existing identities.");
  assert(reconciliation.actions.actor.onNewIdentities === counts.approvedActorMembershipAdditions - 2, "Actor additions on new identities mismatch.");
  assert(reconciliation.actions.director.onNewIdentities === counts.approvedDirectorMembershipAdditions, "Director additions on new identities mismatch.");
  assert(reconciliation.counts.after.registry === counts.projectedUniquePeople, "Projected registry count mismatch.");
  assert(reconciliation.counts.after.actors === counts.projectedActorMemberships, "Projected Actor count mismatch.");
  assert(reconciliation.counts.after.directors === counts.projectedDirectorMemberships, "Projected Director count mismatch.");
  assert(reconciliation.overlaps.after.length === counts.projectedActorDirectorOverlaps, "Projected overlap count mismatch.");
  assert(isDeepStrictEqual(actualOverlapIds, expectedOverlapIds), "Projected overlap identities differ from the authoritative v3 package.");
  assert(reconciliation.overlaps.new.length === 3, "Expected exactly three new Actor/Director overlaps.");
  assert(reconciliation.identities.unchangedExistingPeopleCount === reconciliation.counts.before.registry - 2, "Unchanged existing-person count mismatch.");
  assert(reconciliation.sourceProvenance.sourceMemberships.addedCount === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.categoryActions, "V3 source-membership occurrence count mismatch.");
  assert(reconciliation.sourceProvenance.addedSourceDefinitions.length === 2, "Expected exactly two category-specific v3 source definitions.");
  assert(Object.values(reconciliation.preservation).every(Boolean), "Promotion would remove an existing identity, category membership, or provenance record.");
}

async function loadSupplementValidation({ authorityRequired = false } = {}) {
  const [supplementRaw, schema, authorityRaw] = await Promise.all([
    fs.readFile(supplementPath),
    readJson(supplementSchemaPath),
    readOptional(authorityPath),
  ]);
  if (authorityRequired) assert(authorityRaw !== null, `Required authoritative source is missing: ${AUTHORITY_SOURCE_RELATIVE_PATH}`);
  if (authorityRaw !== null) assert(sha256(authorityRaw) === AUTHORITY_SOURCE_SHA256, "Authoritative v3 source SHA-256 mismatch.");
  const supplement = JSON.parse(supplementRaw.toString("utf8"));
  const initialValidation = validatePeopleOwnerSupplementV3(supplement, { schema, authoritativeRaw: authorityRaw });
  assert(initialValidation.errors.length === 0, `Tracked People v3 supplement is invalid:\n${initialValidation.errors.join("\n")}`);
  return { supplement, supplementRaw, schema, authorityRaw, validation: initialValidation };
}

async function loadPromotionContext({ authorityRequired = false } = {}) {
  const [foundationFiles, supplementInput] = await Promise.all([
    readFoundation(),
    loadSupplementValidation({ authorityRequired }),
  ]);
  const current = foundationValues(foundationFiles);
  const baseline = stripPeopleOwnerSupplementV3Foundation({ ...current, supplement: supplementInput.supplement });
  const baselineValidation = validatePeopleOwnerSupplementV3(supplementInput.supplement, {
    schema: supplementInput.schema,
    authoritativeRaw: supplementInput.authorityRaw,
    baseline,
  });
  assert(baselineValidation.errors.length === 0, `People v3 supplement does not reconcile with the catalogue baseline:\n${baselineValidation.errors.join("\n")}`);
  const projected = mergePeopleOwnerSupplementV3Foundation({ ...baseline, supplement: supplementInput.supplement });
  const projectedValidation = validatePromotedPeopleOwnerSupplementV3Foundation({
    ...projected,
    supplement: supplementInput.supplement,
    baseline,
  });
  assert(projectedValidation.errors.length === 0, `Projected People v3 foundation is invalid:\n${projectedValidation.errors.join("\n")}`);
  const schemaErrors = await validateCanonicalSchemas(projected);
  assert(schemaErrors.length === 0, `Projected People v3 foundation fails schema validation:\n${schemaErrors.join("\n")}`);
  const currentRaw = Object.fromEntries(Object.entries(canonicalFiles).map(([name]) => [name, foundationFiles[name].raw]));
  const baselineRaw = serializeFoundation(baseline);
  const projectedRaw = serializeFoundation(projected);
  const state = sameCanonicalBytes(currentRaw, baselineRaw)
    ? "baseline"
    : sameCanonicalBytes(currentRaw, projectedRaw)
      ? "promoted"
      : "partial-or-drifted";
  return {
    ...supplementInput,
    current,
    currentRaw,
    baseline,
    baselineRaw,
    projected,
    projectedRaw,
    state,
    supplementValidation: baselineValidation,
    projectedValidation,
  };
}

function assertFingerprintSet(actualRaw, expected, label) {
  for (const [name, fingerprint] of Object.entries(expected)) {
    assert(Object.hasOwn(actualRaw, name), `${label} is missing ${name}.`);
    assert(actualRaw[name].length === fingerprint.bytes, `${label} byte length drifted for ${fingerprint.path}.`);
    assert(sha256(actualRaw[name]) === fingerprint.sha256, `${label} SHA-256 drifted for ${fingerprint.path}.`);
  }
}

async function prepare() {
  const [authorityRaw, schema, foundationFiles] = await Promise.all([
    fs.readFile(authorityPath),
    readJson(supplementSchemaPath),
    readFoundation(),
  ]);
  assert(sha256(authorityRaw) === AUTHORITY_SOURCE_SHA256, "Authoritative v3 source SHA-256 mismatch.");
  const authoritativePackage = JSON.parse(authorityRaw.toString("utf8"));
  const supplement = buildTrackedPeopleOwnerSupplementV3(authoritativePackage);
  const current = foundationValues(foundationFiles);
  const baseline = stripPeopleOwnerSupplementV3Foundation({ ...current, supplement });
  const validation = validatePeopleOwnerSupplementV3(supplement, { schema, authoritativeRaw: authorityRaw, baseline });
  assert(validation.errors.length === 0, `Prepared People v3 supplement is invalid:\n${validation.errors.join("\n")}`);
  const serialized = Buffer.from(json(supplement), "utf8");
  await atomicWrite(supplementPath, serialized);
  process.stdout.write(json({
    prepared: true,
    offline: true,
    output: TRACKED_SUPPLEMENT_RELATIVE_PATH,
    sha256: sha256(serialized),
    promotedAt: PROMOTION_TIMESTAMP,
    authoritativeSource: AUTHORITY_SOURCE_RELATIVE_PATH,
    authoritativeSha256: AUTHORITY_SOURCE_SHA256,
    ...validation.summary,
  }));
}

async function validate() {
  const context = await loadPromotionContext();
  assert(context.state !== "partial-or-drifted", "Active People catalogue is in a partial or drifted v3 promotion state.");
  process.stdout.write(json({
    valid: true,
    offline: true,
    state: context.state,
    trackedSupplement: TRACKED_SUPPLEMENT_RELATIVE_PATH,
    trackedSupplementSha256: sha256(context.supplementRaw),
    authoritativeSourceCompared: context.authorityRaw !== null,
    ...context.supplementValidation.summary,
    projectedFoundation: context.projectedValidation.summary,
  }));
}

async function preview() {
  const context = await loadPromotionContext({ authorityRequired: true });
  assert(context.state === "baseline", `Promotion preview requires the exact unpromoted baseline; current state is ${context.state}.`);
  const secondProjection = mergePeopleOwnerSupplementV3Foundation({ ...context.baseline, supplement: context.supplement });
  const secondRaw = serializeFoundation(secondProjection);
  assert(sameCanonicalBytes(context.projectedRaw, secondRaw), "Repeated v3 promotion projections were not byte-identical.");
  const reconciliation = reconcileFoundation(context.baseline, context.projected, context.supplement);
  assertExactReconciliation(reconciliation, context.supplement);
  const [protectedFingerprints, supplementSchemaRaw] = await Promise.all([
    protectedSnapshot(),
    fs.readFile(supplementSchemaPath),
  ]);
  const baselineFingerprints = canonicalFingerprints(context.currentRaw);
  const projectedFingerprints = canonicalFingerprints(context.projectedRaw);
  const baselineLock = {
    version: "people-catalogue-v3-baseline-lock-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    authority: { path: AUTHORITY_SOURCE_RELATIVE_PATH, sha256: AUTHORITY_SOURCE_SHA256 },
    trackedSupplement: { path: TRACKED_SUPPLEMENT_RELATIVE_PATH, bytes: context.supplementRaw.length, sha256: sha256(context.supplementRaw) },
    supplementSchema: { path: supplementSchemaRelativePath, bytes: supplementSchemaRaw.length, sha256: sha256(supplementSchemaRaw) },
    canonicalFiles: baselineFingerprints,
    protectedFingerprints,
  };
  const projectedHashes = {
    version: "people-catalogue-v3-projected-hashes-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    runCount: 2,
    replayByteIdentical: true,
    canonicalFiles: projectedFingerprints,
  };
  const summary = {
    version: "people-catalogue-v3-promotion-preview-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    offline: true,
    activeTrackedCatalogueFilesWritten: 0,
    previewRuns: 2,
    replayByteIdentical: true,
    newRegistryIdentities: reconciliation.identities.newRegistryIdentityCount,
    newActorMembershipsOnNewIdentities: reconciliation.actions.actor.onNewIdentities,
    newDirectorMembershipsOnNewIdentities: reconciliation.actions.director.onNewIdentities,
    actorMembershipsOnExistingIdentities: reconciliation.actions.actor.onExistingIdentities,
    directorMembershipsOnExistingIdentities: reconciliation.actions.director.onExistingIdentities,
    newActorDirectorOverlaps: reconciliation.overlaps.new,
    unchangedExistingPeople: reconciliation.identities.unchangedExistingPeopleCount,
    projectedCounts: reconciliation.counts.after,
    projectedFileHashes: projectedFingerprints,
    previewLocations: {
      before: posixPath(path.relative(repoRoot, baselineRoot)),
      run1: posixPath(path.relative(repoRoot, runRoots[0])),
      run2: posixPath(path.relative(repoRoot, runRoots[1])),
    },
  };
  await Promise.all([
    writeFoundationTree(baselineRoot, context.currentRaw),
    writeFoundationTree(runRoots[0], context.projectedRaw),
    writeFoundationTree(runRoots[1], secondRaw),
    atomicWrite(previewFiles.baselineLock, json(baselineLock)),
    atomicWrite(previewFiles.projectedHashes, json(projectedHashes)),
    atomicWrite(previewFiles.reconciliation, json(reconciliation)),
    atomicWrite(previewFiles.summary, json(summary)),
  ]);
  process.stdout.write(json({ previewed: true, ...summary }));
}

async function readPreviewArtifacts() {
  const [baselineLock, projectedHashes, savedReconciliation, beforeFiles, firstFiles, secondFiles] = await Promise.all([
    readJson(previewFiles.baselineLock),
    readJson(previewFiles.projectedHashes),
    readJson(previewFiles.reconciliation),
    readFoundation(baselineRoot),
    readFoundation(runRoots[0]),
    readFoundation(runRoots[1]),
  ]);
  assert(baselineLock.version === "people-catalogue-v3-baseline-lock-v1", "Unsupported or missing v3 baseline lock.");
  assert(projectedHashes.version === "people-catalogue-v3-projected-hashes-v1", "Unsupported or missing v3 projected hash record.");
  assert(baselineLock.promotedAt === PROMOTION_TIMESTAMP && projectedHashes.promotedAt === PROMOTION_TIMESTAMP, "Preview promotion timestamp drifted.");
  assert(isDeepStrictEqual(baselineLock.authority, { path: AUTHORITY_SOURCE_RELATIVE_PATH, sha256: AUTHORITY_SOURCE_SHA256 }), "Preview authority binding drifted.");
  const beforeRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, beforeFiles[name].raw]));
  const firstRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, firstFiles[name].raw]));
  const secondRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, secondFiles[name].raw]));
  assertFingerprintSet(beforeRaw, baselineLock.canonicalFiles, "Preview baseline");
  assertFingerprintSet(firstRaw, projectedHashes.canonicalFiles, "First preview run");
  assertFingerprintSet(secondRaw, projectedHashes.canonicalFiles, "Second preview run");
  assert(sameCanonicalBytes(firstRaw, secondRaw), "Saved v3 preview runs are not byte-identical.");
  return {
    baselineLock,
    projectedHashes,
    savedReconciliation,
    before: foundationValues(beforeFiles),
    beforeRaw,
    after: foundationValues(firstFiles),
    afterRaw: firstRaw,
  };
}

async function atomicallyWriteCanonicalFiles(rawByName, rollbackRaw) {
  const staged = [];
  let replacements = 0;
  try {
    for (const [name, definition] of Object.entries(canonicalFiles)) {
      const target = path.join(dataRoot, definition.fileName);
      const temporaryPath = path.join(dataRoot, `.${definition.fileName}.${process.pid}.v3-stage`);
      await fs.writeFile(temporaryPath, rawByName[name]);
      staged.push({ name, target, temporaryPath });
    }
    for (const entry of staged) {
      await fs.rename(entry.temporaryPath, entry.target);
      replacements += 1;
    }
  } catch (error) {
    if (replacements > 0) {
      await Promise.all(Object.entries(canonicalFiles).map(([name, definition]) => (
        atomicWrite(path.join(dataRoot, definition.fileName), rollbackRaw[name])
      )));
    }
    throw error;
  } finally {
    await Promise.all(staged.map((entry) => fs.rm(entry.temporaryPath, { force: true })));
  }
}

async function applyPromotion() {
  const [context, previewArtifacts, currentProtected, supplementSchemaRaw] = await Promise.all([
    loadPromotionContext({ authorityRequired: true }),
    readPreviewArtifacts(),
    protectedSnapshot(),
    fs.readFile(supplementSchemaPath),
  ]);
  assert(context.state === "baseline", `Promotion apply requires the exact unpromoted baseline; current state is ${context.state}.`);
  assert(context.supplementRaw.length === previewArtifacts.baselineLock.trackedSupplement.bytes, "Tracked supplement byte length changed after preview.");
  assert(sha256(context.supplementRaw) === previewArtifacts.baselineLock.trackedSupplement.sha256, "Tracked supplement changed after preview.");
  assert(supplementSchemaRaw.length === previewArtifacts.baselineLock.supplementSchema.bytes, "V3 supplement schema byte length changed after preview.");
  assert(sha256(supplementSchemaRaw) === previewArtifacts.baselineLock.supplementSchema.sha256, "V3 supplement schema changed after preview.");
  assertFingerprintSet(context.currentRaw, previewArtifacts.baselineLock.canonicalFiles, "Active catalogue baseline");
  assert(sameCanonicalBytes(context.currentRaw, previewArtifacts.beforeRaw), "Active catalogue bytes differ from the reviewed preview baseline.");
  assertFingerprintSet(context.projectedRaw, previewArtifacts.projectedHashes.canonicalFiles, "Recomputed promotion");
  assert(sameCanonicalBytes(context.projectedRaw, previewArtifacts.afterRaw), "Recomputed promotion differs from the reviewed preview output.");
  const protectedComparisons = compareProtected(previewArtifacts.baselineLock.protectedFingerprints, currentProtected);
  assert(protectedComparisons.every((item) => item.unchanged), "A protected artwork, manifest, runtime, Company, or Network path changed after preview.");
  const reconciliation = reconcileFoundation(context.baseline, context.projected, context.supplement);
  assertExactReconciliation(reconciliation, context.supplement);
  assert(isDeepStrictEqual(reconciliation, previewArtifacts.savedReconciliation), "Recomputed reconciliation differs from the reviewed preview reconciliation.");

  // Revalidate the lock immediately before replacing any active catalogue file.
  const immediateFiles = await readFoundation();
  const immediateRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, immediateFiles[name].raw]));
  assert(sameCanonicalBytes(immediateRaw, context.currentRaw), "Active catalogue changed while promotion was being prepared.");
  await atomicallyWriteCanonicalFiles(context.projectedRaw, context.currentRaw);
  const afterFiles = await readFoundation();
  const afterRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, afterFiles[name].raw]));
  assertFingerprintSet(afterRaw, previewArtifacts.projectedHashes.canonicalFiles, "Promoted active catalogue");
  assert(sameCanonicalBytes(afterRaw, context.projectedRaw), "Promoted active catalogue differs from the previewed bytes.");
  const protectedAfter = await protectedSnapshot();
  const protectedAfterComparisons = compareProtected(previewArtifacts.baselineLock.protectedFingerprints, protectedAfter);
  assert(protectedAfterComparisons.every((item) => item.unchanged), "A protected publication-boundary path changed during promotion.");
  process.stdout.write(json({
    promoted: true,
    offline: true,
    promotedAt: PROMOTION_TIMESTAMP,
    canonicalFilesWritten: Object.values(canonicalFiles).map((definition) => definition.relativePath),
    canonicalFileHashes: previewArtifacts.projectedHashes.canonicalFiles,
    finalCounts: reconciliation.counts.after,
    protectedPathsUnchanged: true,
    artworkFilesWritten: 0,
    manifestFilesWritten: 0,
    runtimeFilesWritten: 0,
  }));
}

async function check() {
  const beforeFiles = await readFoundation();
  const beforeRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, beforeFiles[name].raw]));
  const [context, previewArtifacts, protectedBefore] = await Promise.all([
    loadPromotionContext(),
    readPreviewArtifacts(),
    protectedSnapshot(),
  ]);
  assert(context.state === "promoted", `Idempotence check requires the fully promoted catalogue; current state is ${context.state}.`);
  assert(sameCanonicalBytes(context.currentRaw, previewArtifacts.afterRaw), "Tracked promoted catalogue differs from the reviewed preview output.");
  const replay = mergePeopleOwnerSupplementV3Foundation({ ...context.current, supplement: context.supplement });
  const replayRaw = serializeFoundation(replay);
  assert(sameCanonicalBytes(context.currentRaw, replayRaw), "A second v3 promotion proposes additional catalogue changes.");
  const reconciliation = reconcileFoundation(context.baseline, context.current, context.supplement);
  assertExactReconciliation(reconciliation, context.supplement);
  const protectedComparisons = compareProtected(previewArtifacts.baselineLock.protectedFingerprints, protectedBefore);
  const authorisedPostPreviewPublicationPaths = new Set([
    "assets/collection_covers/people",
    "assets/collection_covers/runtime-lookup.json",
  ]);
  assert(
    protectedComparisons.every((item) => item.unchanged || authorisedPostPreviewPublicationPaths.has(item.path)),
    "A protected path outside the authorised People v3 publication scope differs from the preview lock.",
  );
  const afterFiles = await readFoundation();
  const afterRaw = Object.fromEntries(Object.keys(canonicalFiles).map((name) => [name, afterFiles[name].raw]));
  const protectedAfter = await protectedSnapshot();
  assert(sameCanonicalBytes(beforeRaw, afterRaw), "Write-free idempotence check changed an active catalogue file.");
  assert(compareProtected(protectedBefore, protectedAfter).every((item) => item.unchanged), "Write-free idempotence check changed a protected path.");
  process.stdout.write(json({
    valid: true,
    offline: true,
    writeFree: true,
    idempotent: true,
    additionalChangesProposed: 0,
    promotedAt: PROMOTION_TIMESTAMP,
    finalCounts: reconciliation.counts.after,
    canonicalFileHashes: canonicalFingerprints(context.currentRaw),
    protectedPathsUnchanged: true,
    protectedPathsUnchangedDuringCheck: true,
    authorisedPostPreviewPublicationDifferences: protectedComparisons.filter((item) => !item.unchanged).map((item) => item.path),
  }));
}

async function gitWorktreeStatus() {
  const { stdout } = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const statusShort = stdout.replaceAll("\r\n", "\n").trimEnd();
  const entries = statusShort === "" ? [] : statusShort.split("\n").map((line) => ({
    status: line.slice(0, 2),
    path: line.slice(3),
  }));
  return { statusShort, entries, changedFilenames: entries.map((entry) => entry.path) };
}

function classifyChangedFiles(changedFilenames) {
  const unique = sortedText(new Set(changedFilenames));
  return {
    schemas: unique.filter((file) => file.startsWith("schemas/")),
    tooling: unique.filter((file) => file === "tools/people-seed/package.json" || /^tools\/people-seed\/(?:scripts|src)\//u.test(file)),
    tests: unique.filter((file) => file.startsWith("tools/people-seed/tests/")),
    documentation: unique.filter((file) => /(?:^|\/)(?:README|PUBLICATION)\.md$/u.test(file)),
    canonicalCatalogue: unique.filter((file) => Object.values(canonicalFiles).some((definition) => definition.relativePath === file)),
    trackedSupplement: unique.filter((file) => file === TRACKED_SUPPLEMENT_RELATIVE_PATH),
    all: unique,
  };
}

function representativeRecords(after, ids) {
  const registryById = new Map(after.registry.records.map((record) => [record.tmdbPersonId, record]));
  return ids.slice(0, 5).map((tmdbPersonId) => ({
    tmdbPersonId,
    registry: registryById.get(tmdbPersonId),
  }));
}

function markdownList(items) {
  return items.length === 0 ? "- None" : items.map((item) => `- \`${item}\``).join("\n");
}

function reviewMarkdown(review) {
  const { reconciliation, changedFiles, protectedBoundary } = review;
  const overlapRows = reconciliation.overlaps.after
    .map((record) => `| ${record.tmdbPersonId} | ${record.canonicalName} | ${reconciliation.overlaps.new.some((item) => item.tmdbPersonId === record.tmdbPersonId) ? "new" : "existing"} |`)
    .join("\n");
  const fileRows = Object.entries(reconciliation.files).map(([name, diff]) => (
    `| ${canonicalFiles[name].relativePath} | ${diff.beforeCount} | ${diff.afterCount} | ${diff.addedCount} | ${diff.removedCount} | ${diff.modifiedCount} | ${diff.unchangedCount} |`
  )).join("\n");
  const protectionRows = protectedBoundary.comparisons.map((item) => (
    `| ${item.path} | ${item.before.fileCount} | ${item.before.sha256 ?? "missing"} | ${item.current.sha256 ?? "missing"} | ${item.unchanged ? "yes" : "NO"} |`
  )).join("\n");
  const specialRows = Object.values(reconciliation.specialCases).map((item) => {
    const beforeCategories = [item.before.actor ? "Actor" : null, item.before.director ? "Director" : null].filter(Boolean).join(" + ") || "none";
    const afterCategories = [item.after.actor ? "Actor" : null, item.after.director ? "Director" : null].filter(Boolean).join(" + ") || "none";
    return `| ${item.tmdbPersonId} | ${item.canonicalName} | ${beforeCategories} | ${afterCategories} |`;
  }).join("\n");
  const representativeActors = review.representativeNewActors.map((item) => `- ${item.tmdbPersonId}: ${item.registry.canonicalName}`).join("\n");
  const representativeDirectors = review.representativeNewDirectors.map((item) => `- ${item.tmdbPersonId}: ${item.registry.canonicalName}`).join("\n");
  const addedSources = reconciliation.sourceProvenance.addedSourceDefinitions
    .map((source) => `- \`${source.sourceId}\`: ${source.displayTitle}`)
    .join("\n");
  return `# Nuvio People Catalogue v3 tracked-promotion review

The deterministic promotion adds 663 registry identities, 548 Actor memberships, and 118 Director memberships. The tracked catalogue now contains 1,480 identities, 1,071 Actor memberships, 418 Director memberships, and nine Actor/Director overlaps.

This is catalogue-only work. The published People artwork manifest remains at ${review.publicationBoundary.publishedPeopleCount} people; the 663 new identities are not represented as illustrated or runtime-ready.

## Exact before/after counts

| Collection | Before | After | Added | Removed | Modified | Unchanged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${fileRows}

- New Actor memberships on new identities: ${reconciliation.actions.actor.onNewIdentities}
- New Director memberships on new identities: ${reconciliation.actions.director.onNewIdentities}
- Actor memberships on existing identities: ${reconciliation.actions.actor.onExistingIdentities}
- Director memberships on existing identities: ${reconciliation.actions.director.onExistingIdentities}
- Exact approved category actions: ${reconciliation.actions.total}
- Unchanged existing people: ${reconciliation.identities.unchangedExistingPeopleCount}
- Source-membership occurrences added: ${reconciliation.sourceProvenance.sourceMemberships.addedCount}

## Final Actor/Director overlaps

| TMDB Person ID | Canonical name | Overlap status |
| ---: | --- | --- |
${overlapRows}

## Required special cases

| TMDB Person ID | Canonical name | Before | After |
| ---: | --- | --- | --- |
${specialRows}

Roberto Benigni is one new shared identity. Greta Gerwig and Erich von Stroheim retain their existing Director memberships and gain only the approved Actor membership.

## Representative additions

New Actor records:

${representativeActors}

New Director records:

${representativeDirectors}

## Source provenance

${addedSources}

The promotion adds ${reconciliation.sourceProvenance.sourceMemberships.addedCount} category-specific source-membership occurrences with no fabricated source ranks or retrieval timestamps. Historical source definitions and memberships remain intact.

## Changed worktree filenames

${markdownList(changedFiles.all)}

Schema changes:

${markdownList(changedFiles.schemas)}

Tooling changes:

${markdownList(changedFiles.tooling)}

Test changes:

${markdownList(changedFiles.tests)}

Documentation changes:

${markdownList(changedFiles.documentation)}

## Publication-boundary proof

| Protected path | Files | Preview SHA-256 | Current SHA-256 | Unchanged |
| --- | ---: | --- | --- | --- |
${protectionRows}

No existing registry identity, Actor membership, Director membership, source definition, or source-membership occurrence was removed. No protected People artwork, manifest, runtime lookup, generic hero backdrop, Company asset, or Network asset changed between preview and this review.
`;
}

async function review() {
  const [context, previewArtifacts, currentProtected, status, peopleManifest] = await Promise.all([
    loadPromotionContext(),
    readPreviewArtifacts(),
    protectedSnapshot(),
    gitWorktreeStatus(),
    readJson(path.join(repoRoot, "assets", "collection_covers", "people", "manifest.json")),
  ]);
  assert(context.state === "promoted", `Tracked-diff review requires the fully promoted catalogue; current state is ${context.state}.`);
  assert(sameCanonicalBytes(context.currentRaw, previewArtifacts.afterRaw), "Tracked catalogue differs from the exact previewed promotion.");
  const reconciliation = reconcileFoundation(previewArtifacts.before, previewArtifacts.after, context.supplement);
  assertExactReconciliation(reconciliation, context.supplement);
  assert(isDeepStrictEqual(reconciliation, previewArtifacts.savedReconciliation), "Review reconciliation differs from the preview reconciliation.");
  const comparisons = compareProtected(previewArtifacts.baselineLock.protectedFingerprints, currentProtected);
  assert(comparisons.every((item) => item.unchanged), "A protected publication-boundary path changed after preview.");
  const changedFiles = classifyChangedFiles(status.changedFilenames);
  const reviewDocument = {
    version: "people-catalogue-v3-tracked-diff-review-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    offline: true,
    reconciliation,
    representativeNewActors: representativeRecords(previewArtifacts.after, reconciliation.actions.actor.addedIds.filter((id) => reconciliation.identities.newRegistryIds.includes(id))),
    representativeNewDirectors: representativeRecords(previewArtifacts.after, reconciliation.actions.director.addedIds.filter((id) => reconciliation.identities.newRegistryIds.includes(id))),
    git: { statusShort: status.statusShort, entries: status.entries },
    changedFiles,
    protectedBoundary: { allUnchanged: true, comparisons },
    publicationBoundary: {
      catalogueIdentityCount: reconciliation.counts.after.registry,
      publishedPeopleCount: peopleManifest.recordCount,
      newPeoplePublishedByThisPromotion: 0,
      newArtworkFilesWrittenByThisPromotion: 0,
      manifestOrRuntimeFilesWrittenByThisPromotion: 0,
      statement: "The tracked People catalogue is promoted independently of the existing People artwork manifest and runtime publication.",
    },
  };
  await Promise.all([
    atomicWrite(path.join(reviewRoot, "catalogue-diff.json"), json(reviewDocument)),
    atomicWrite(path.join(reviewRoot, "catalogue-diff.md"), reviewMarkdown(reviewDocument)),
    atomicWrite(path.join(reviewRoot, "category-action-reconciliation.json"), json(reconciliation.actions)),
    atomicWrite(path.join(reviewRoot, "record-diffs.json"), json(reconciliation.files)),
    atomicWrite(path.join(reviewRoot, "source-provenance-diff.json"), json(reconciliation.sourceProvenance)),
    atomicWrite(path.join(reviewRoot, "special-cases.json"), json(reconciliation.specialCases)),
    atomicWrite(path.join(reviewRoot, "protected-boundary.json"), json(reviewDocument.protectedBoundary)),
    atomicWrite(path.join(reviewRoot, "changed-worktree-files.json"), json({ git: reviewDocument.git, changedFiles })),
  ]);
  process.stdout.write(json({
    reviewed: true,
    offline: true,
    reviewRoot: posixPath(path.relative(repoRoot, reviewRoot)),
    finalCounts: reconciliation.counts.after,
    changedWorktreeFileCount: changedFiles.all.length,
    protectedPathsUnchanged: true,
    publishedPeopleCount: peopleManifest.recordCount,
    newPeoplePublishedByThisPromotion: 0,
  }));
}

function usage() {
  return `Usage: node scripts/promote-people-owner-supplement-v3.mjs MODE

Exactly one mode is required:
  --prepare   Build the tracked supplement from the fixed hash-bound authority.
  --validate  Validate the tracked supplement and projected foundation without writing.
  --preview   Write two ignored byte-identical promotion previews and their locks.
  --apply     Revalidate preview locks and write only the four canonical catalogue files.
  --check     Prove the tracked promotion is idempotent and write-free.
  --review    Write the ignored human- and machine-readable tracked-diff review package.
`;
}

const handlers = new Map([
  ["--prepare", prepare],
  ["--validate", validate],
  ["--preview", preview],
  ["--apply", applyPromotion],
  ["--check", check],
  ["--review", review],
]);
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  process.stdout.write(usage());
} else {
  assert(args.length === 1 && handlers.has(args[0]), usage());
  await handlers.get(args[0])();
}

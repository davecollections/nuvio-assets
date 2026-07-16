import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "./schema-validator.mjs";

export const EXPECTED_COUNTS = Object.freeze({
  registry: 619,
  actor: 325,
  director: 300,
  shared: 6,
  sourceMemberships: 737,
});

export const EXPECTED_ROLLOUT = Object.freeze({
  actor: Object.freeze({ initial: 200, later: 100, review: 25 }),
  director: Object.freeze({ initial: 154, later: 102, review: 44 }),
});

const EXPECTED_SHARED_NAMES = [
  "Buster Keaton",
  "Charlie Chaplin",
  "Clint Eastwood",
  "Gene Kelly",
  "Mel Brooks",
  "Orson Welles",
];

const EXPECTED_SOURCE_COUNTS = Object.freeze({
  "imkaptain-actors": 58,
  "imkaptain-directors": 20,
  "ranker-actors": 300,
  "tspdt-21c-directors": 102,
  "tspdt-directors": 257,
});

const EXPECTED_SOURCE_IDS = [
  "imkaptain-actors",
  "imkaptain-directors",
  "ranker-actors",
  "tmdb-identity-resolution",
  "tspdt-21c-directors",
  "tspdt-directors",
];

const ACTOR_SOURCES = new Set(["imkaptain-actors", "ranker-actors"]);
const DIRECTOR_SOURCES = new Set(["imkaptain-directors", "tspdt-21c-directors", "tspdt-directors"]);
const BASIS_ORDER = [
  "ranker-core",
  "tspdt-all-time",
  "tspdt-21st-century",
  "cross-source",
  "external-supplement",
  "modern-supplement",
  "owner-added",
];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIf(errors, condition, message) {
  if (!condition) errors.push(message);
}

function countBy(items, selector) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function sourceMembershipComparator(left, right) {
  return left.sourceId.localeCompare(right.sourceId)
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
    || left.sourceName.localeCompare(right.sourceName)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

export function sourceMembershipFingerprint(records) {
  const occurrences = records.flatMap((record) => record.sourceMemberships.map((membership) => ({
    stableKey: record.stableKey,
    ...membership,
  })));
  return createHash("sha256").update(JSON.stringify(occurrences)).digest("hex");
}

function sourceMembershipsFor(record, category) {
  const allowed = category === "actor" ? ACTOR_SOURCES : DIRECTOR_SOURCES;
  return record.sourceMemberships.filter((membership) => allowed.has(membership.sourceId));
}

function expectedSourceRanks(memberships) {
  const ranks = new Map();
  for (const membership of memberships) {
    if (!Number.isInteger(membership.sourceRank)) continue;
    if (!ranks.has(membership.sourceId)) ranks.set(membership.sourceId, []);
    ranks.get(membership.sourceId).push(membership.sourceRank);
  }
  return Object.fromEntries([...ranks].sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, values]) => [
    sourceId,
    [...new Set(values)].sort((left, right) => left - right),
  ]));
}

function expectedSelectionBasis(category, memberships) {
  const sourceIds = new Set(memberships.map((membership) => membership.sourceId));
  const basis = [];
  if (category === "actor") {
    if (sourceIds.has("ranker-actors")) basis.push("ranker-core");
    if (sourceIds.size > 1) basis.push("cross-source");
    if (!sourceIds.has("ranker-actors") && sourceIds.has("imkaptain-actors")) basis.push("external-supplement");
  } else {
    if (sourceIds.has("tspdt-directors")) basis.push("tspdt-all-time");
    if (sourceIds.has("tspdt-21c-directors")) basis.push("tspdt-21st-century");
    if (sourceIds.size > 1) basis.push("cross-source");
    if (!sourceIds.has("tspdt-directors") && sourceIds.has("imkaptain-directors") && !sourceIds.has("tspdt-21c-directors")) {
      basis.push("external-supplement");
    }
    if (!sourceIds.has("tspdt-directors") && sourceIds.has("tspdt-21c-directors")) basis.push("modern-supplement");
  }
  return basis.sort((left, right) => BASIS_ORDER.indexOf(left) - BASIS_ORDER.indexOf(right));
}

function validateRanks(errors, occurrences, expectedDistinctRanks, label) {
  const ranks = occurrences.map((membership) => membership.sourceRank).filter(Number.isInteger);
  const distinct = [...new Set(ranks)].sort((left, right) => left - right);
  const expected = Array.from({ length: expectedDistinctRanks }, (_, index) => index + 1);
  addIf(errors, sameJson(distinct, expected), `${label} must preserve every rank 1-${expectedDistinctRanks}`);
}

function inspectPortableValues(value, errors, pathName = "$", keyName = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPortableValues(item, errors, `${pathName}[${index}]`, keyName));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) inspectPortableValues(child, errors, `${pathName}.${key}`, key);
    return;
  }
  if (typeof value !== "string") return;
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) errors.push(`${pathName}: local absolute path is prohibited`);
  if (value.startsWith("/") && keyName !== "profilePath") errors.push(`${pathName}: local absolute path is prohibited`);
  if (/^https?:\/\//i.test(value) && keyName !== "sourceUrl") errors.push(`${pathName}: external URL is allowed only for sourceUrl provenance`);
}

function inspectForbiddenKeys(value, errors, pathName = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbiddenKeys(item, errors, `${pathName}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/artwork|portrait|cover.*url|image.*url|hero.*url|logo.*url/i.test(key)) {
      errors.push(`${pathName}.${key}: artwork and image URL fields are prohibited`);
    }
    inspectForbiddenKeys(child, errors, `${pathName}.${key}`);
  }
}

function validateCategory(errors, document, category, registryById) {
  const expectedCount = EXPECTED_COUNTS[category];
  addIf(errors, document.category === category, `${category} document category must be ${category}`);
  addIf(errors, document.recordCount === document.records.length, `${category} recordCount must equal records length`);
  addIf(errors, document.records.length === expectedCount, `${category} membership count must be ${expectedCount}`);

  const ids = document.records.map((record) => record.tmdbPersonId);
  addIf(errors, new Set(ids).size === ids.length, `${category} memberships must not duplicate TMDB person IDs`);
  addIf(errors, ids.every((id, index) => index === 0 || ids[index - 1] < id), `${category} memberships must use numeric TMDB-ID ordering`);

  for (const record of document.records) {
    const registryRecord = registryById.get(record.tmdbPersonId);
    addIf(errors, record.stableKey === `person:${record.tmdbPersonId}`, `${category} ${record.stableKey}: stable key must match TMDB person ID`);
    addIf(errors, Boolean(registryRecord), `${category} ${record.stableKey}: membership is missing from registry`);
    if (!registryRecord) continue;
    addIf(errors, record.stableKey === registryRecord.stableKey, `${category} ${record.stableKey}: registry stable key mismatch`);
    addIf(errors, record.canonicalName === registryRecord.canonicalName, `${category} ${record.stableKey}: canonical name mismatch`);
    addIf(errors, record.category === category, `${category} ${record.stableKey}: record category mismatch`);
    const memberships = sourceMembershipsFor(registryRecord, category);
    addIf(errors, sameJson(record.sourceRanks, expectedSourceRanks(memberships)), `${category} ${record.stableKey}: source-rank occurrences do not match registry provenance`);
    addIf(errors, sameJson(record.selectionBasis, expectedSelectionBasis(category, memberships)), `${category} ${record.stableKey}: selection basis does not match source evidence`);
    const expectedTier = {
      "include-initial": "initial",
      "include-later": "later",
      "manual-selection-review": "review",
    }[record.recommendedAction];
    addIf(errors, record.rolloutTier === expectedTier, `${category} ${record.stableKey}: rollout tier does not match recommendation`);
    addIf(errors, record.selectionStatus === "proposed", `${category} ${record.stableKey}: selection status must remain proposed`);
    addIf(errors, record.ownerDecision === null, `${category} ${record.stableKey}: owner decision must remain blank`);
    addIf(errors, record.ownerNote === "", `${category} ${record.stableKey}: owner note must remain blank`);
    addIf(errors, Object.keys(record.sourceRanks).every((key, index, keys) => index === 0 || keys[index - 1].localeCompare(key) < 0), `${category} ${record.stableKey}: source-rank keys must be ordered`);
    addIf(errors, record.selectionBasis.every((basis, index) => index === 0 || BASIS_ORDER.indexOf(record.selectionBasis[index - 1]) < BASIS_ORDER.indexOf(basis)), `${category} ${record.stableKey}: selection basis must be deterministically ordered`);
  }

  const rollout = countBy(document.records, (record) => record.rolloutTier);
  addIf(errors, sameJson(rollout, EXPECTED_ROLLOUT[category]), `${category} rollout counts do not match the authorised proposal`);
}

export function validatePeopleFoundation({ registry, actors, directors, sources, schemas = null, rawDocuments = null }) {
  const errors = [];
  if (schemas) {
    errors.push(...validateAgainstSchema(registry, schemas.registry, "people-registry.json"));
    errors.push(...validateAgainstSchema(actors, schemas.seed, "actors-seed.json"));
    errors.push(...validateAgainstSchema(directors, schemas.seed, "directors-seed.json"));
    errors.push(...validateAgainstSchema(sources, schemas.sources, "sources.json"));
  }
  if (rawDocuments) {
    for (const [name, document] of Object.entries({
      "people-registry.json": registry,
      "actors-seed.json": actors,
      "directors-seed.json": directors,
      "sources.json": sources,
    })) {
      addIf(errors, rawDocuments[name] === `${JSON.stringify(document, null, 2)}\n`, `${name}: JSON serialization is not deterministic`);
    }
  }

  addIf(errors, registry.recordCount === registry.records.length, "registry recordCount must equal records length");
  addIf(errors, registry.records.length === EXPECTED_COUNTS.registry, `registry must contain ${EXPECTED_COUNTS.registry} people`);
  const registryIds = registry.records.map((record) => record.tmdbPersonId);
  const registryKeys = registry.records.map((record) => record.stableKey);
  addIf(errors, new Set(registryIds).size === registryIds.length, "registry must not duplicate TMDB person IDs");
  addIf(errors, new Set(registryKeys).size === registryKeys.length, "registry must not duplicate stable keys");
  addIf(errors, registryIds.every((id, index) => index === 0 || registryIds[index - 1] < id), "registry must use numeric TMDB-ID ordering");

  for (const record of registry.records) {
    addIf(errors, record.stableKey === `person:${record.tmdbPersonId}`, `${record.stableKey}: stable key must equal person:{tmdbPersonId}`);
    addIf(errors, record.reviewStatus === "candidate", `${record.stableKey}: registry status must remain candidate`);
    addIf(errors, record.profilePath !== null, `${record.stableKey}: profile-path metadata must be present`);
    addIf(errors, record.activityYearRange.first <= record.activityYearRange.last, `${record.stableKey}: activity year range is reversed`);
    addIf(errors, sameJson(record.sourceMemberships, [...record.sourceMemberships].sort(sourceMembershipComparator)), `${record.stableKey}: source memberships must be deterministically ordered`);
  }

  const sourceMemberships = registry.records.flatMap((record) => record.sourceMemberships);
  addIf(errors, registry.sourceMembershipCount === sourceMemberships.length, "registry sourceMembershipCount must equal preserved occurrences");
  addIf(errors, sourceMemberships.length === EXPECTED_COUNTS.sourceMemberships, `registry must preserve ${EXPECTED_COUNTS.sourceMemberships} source occurrences`);
  addIf(errors, registry.sourceMembershipFingerprint === sourceMembershipFingerprint(registry.records), "registry source-membership fingerprint mismatch");
  addIf(errors, sameJson(countBy(sourceMemberships, (membership) => membership.sourceId), EXPECTED_SOURCE_COUNTS), "source occurrence counts do not match the completed build");

  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  validateCategory(errors, actors, "actor", registryById);
  validateCategory(errors, directors, "director", registryById);

  const actorIds = new Set(actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(directors.records.map((record) => record.tmdbPersonId));
  const shared = registry.records.filter((record) => actorIds.has(record.tmdbPersonId) && directorIds.has(record.tmdbPersonId));
  addIf(errors, shared.length === EXPECTED_COUNTS.shared, `shared actor/director count must be ${EXPECTED_COUNTS.shared}`);
  addIf(errors, sameJson(shared.map((record) => record.canonicalName).sort(), EXPECTED_SHARED_NAMES), "shared actor/director identities do not match the resolved draft" );

  for (const record of registry.records) {
    const expectedCategories = [
      ...(actorIds.has(record.tmdbPersonId) ? ["actor"] : []),
      ...(directorIds.has(record.tmdbPersonId) ? ["director"] : []),
    ];
    addIf(errors, sameJson(record.categoryMembership, expectedCategories), `${record.stableKey}: registry categoryMembership does not match category files`);
  }

  const ranker = sourceMemberships.filter((membership) => membership.sourceId === "ranker-actors");
  const imkActors = sourceMemberships.filter((membership) => membership.sourceId === "imkaptain-actors");
  validateRanks(errors, ranker, 300, "Ranker actor source");
  addIf(errors, imkActors.length === 58, "all 58 explicit ImKaptain actor IDs must remain represented");
  const actorCrossSource = actors.records.filter((record) => record.selectionBasis.includes("cross-source"));
  addIf(errors, actorCrossSource.length === 33, "33 cross-source actor overlaps must remain identifiable");
  const actorReview = actors.records.filter((record) => record.rolloutTier === "review");
  addIf(errors, actorReview.length === 25, "25 actor supplements must remain review candidates");
  addIf(errors, actorReview.every((record) => record.selectionBasis.includes("external-supplement")), "actor review candidates must retain external-supplement basis");
  addIf(errors, actorReview.every((record) => !record.selectionBasis.includes("modern-supplement")), "ImKaptain-only actors must not be inferred as modern supplements");

  const tspdtAllTime = sourceMemberships.filter((membership) => membership.sourceId === "tspdt-directors");
  const tspdt21c = sourceMemberships.filter((membership) => membership.sourceId === "tspdt-21c-directors");
  const imkDirectors = sourceMemberships.filter((membership) => membership.sourceId === "imkaptain-directors");
  validateRanks(errors, tspdtAllTime, 250, "TSPDT all-time director source");
  validateRanks(errors, tspdt21c, 100, "TSPDT 21st-century director source");
  addIf(errors, tspdtAllTime.length === 257, "TSPDT all-time expanded source occurrences must total 257");
  addIf(errors, tspdt21c.length === 102, "TSPDT 21st-century expanded source occurrences must total 102");
  const teamMemberships = [...tspdtAllTime, ...tspdt21c].filter((membership) => membership.sourceRowType === "directing-team-member");
  addIf(errors, teamMemberships.length === 18, "all 18 directing-team memberships must retain team-row provenance");
  addIf(errors, teamMemberships.every((membership) => membership.sourceName.includes(" & ")), "directing-team memberships must retain their original group spelling");
  const secondaryCatalogIds = imkDirectors.flatMap((membership) => membership.secondaryCatalogIds ?? []);
  addIf(errors, secondaryCatalogIds.length === 20 && new Set(secondaryCatalogIds).size === 20, "all 20 MDBList catalogue IDs must remain unique secondary provenance");
  const directorImkOverlap = registry.records.filter((record) => {
    const ids = new Set(record.sourceMemberships.map((membership) => membership.sourceId));
    return ids.has("imkaptain-directors") && (ids.has("tspdt-directors") || ids.has("tspdt-21c-directors"));
  });
  addIf(errors, directorImkOverlap.length === 19, "19 ImKaptain/TSPDT director overlaps must remain identifiable");
  const directorCrossSource = directors.records.filter((record) => record.selectionBasis.includes("cross-source"));
  addIf(errors, directorCrossSource.length === 67, "67 multi-source director memberships must retain cross-source basis");
  const greta = directors.records.find((record) => record.canonicalName === "Greta Gerwig");
  addIf(errors, Boolean(greta), "Greta Gerwig must remain in the director candidate pool");
  if (greta) {
    addIf(errors, greta.rolloutTier === "review" && greta.recommendedAction === "manual-selection-review", "Greta Gerwig must remain a manual selection-review candidate");
    addIf(errors, greta.selectionBasis.includes("external-supplement"), "Greta Gerwig must retain external-supplement basis");
  }
  const michaelPowell = directors.records.find((record) => record.canonicalName === "Michael Powell");
  addIf(errors, Boolean(michaelPowell), "Michael Powell must remain in the director candidate pool");
  if (michaelPowell) addIf(errors, sameJson(michaelPowell.sourceRanks["tspdt-directors"], [35, 210]), "Michael Powell must retain both TSPDT source ranks 35 and 210");

  addIf(errors, sources.sourceCount === sources.sources.length, "source registry sourceCount must equal sources length");
  addIf(errors, sources.sources.length === EXPECTED_SOURCE_IDS.length, "source registry must contain six required sources");
  addIf(errors, sameJson(sources.sources.map((source) => source.sourceId), EXPECTED_SOURCE_IDS), "source registry must use deterministic source-ID ordering and include every required source");
  addIf(errors, registry.generatedAt === actors.generatedAt && actors.generatedAt === directors.generatedAt && directors.generatedAt === sources.generatedAt, "all canonical files must share the completed-build timestamp");

  for (const document of [registry, actors, directors, sources]) {
    inspectPortableValues(document, errors);
    inspectForbiddenKeys(document, errors);
  }

  return {
    errors,
    summary: {
      registryCount: registry.records.length,
      actorCount: actors.records.length,
      directorCount: directors.records.length,
      sharedCount: shared.length,
      actorRollout: countBy(actors.records, (record) => record.rolloutTier),
      directorRollout: countBy(directors.records, (record) => record.rolloutTier),
      sourceMembershipCount: sourceMemberships.length,
      sourceMembershipFingerprint: registry.sourceMembershipFingerprint,
      sourceCount: sources.sources.length,
    },
  };
}

export function validateChangedPaths(paths) {
  const protectedPrefixes = [
    "tools/studio-network-batch/",
    "assets/collection_covers/companies/",
    "assets/collection_covers/networks/",
    "assets/collection_covers/people/",
  ];
  const protectedFiles = new Set(["assets/collection_covers/manifest.json"]);
  return paths.map((item) => item.replaceAll("\\", "/")).filter((item) => (
    protectedFiles.has(item) || protectedPrefixes.some((prefix) => item.startsWith(prefix))
  )).map((item) => `protected studio/network or people-artwork path changed: ${item}`);
}

export async function validatePeopleAssetBoundary(repoRoot) {
  const peopleRoot = path.join(repoRoot, "assets", "collection_covers", "people");
  const errors = [];
  let entries = [];
  try {
    entries = await fs.readdir(peopleRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && /^[1-9][0-9]*\.webp$/i.test(entry.name)) errors.push(`people portrait asset exists unexpectedly: assets/collection_covers/people/${entry.name}`);
    if (entry.isFile() && /manifest.*\.json$|people.*manifest.*\.json$/i.test(entry.name)) errors.push(`people artwork manifest exists unexpectedly: assets/collection_covers/people/${entry.name}`);
  }
  return errors;
}

export async function readPeopleFoundation(repoRoot) {
  const dataRoot = path.join(repoRoot, "data", "people");
  const schemaRoot = path.join(repoRoot, "schemas");
  const files = {
    registry: "people-registry.json",
    actors: "actors-seed.json",
    directors: "directors-seed.json",
    sources: "sources.json",
  };
  const rawDocuments = {};
  const documents = {};
  await Promise.all(Object.entries(files).map(async ([key, name]) => {
    const raw = await fs.readFile(path.join(dataRoot, name), "utf8");
    rawDocuments[name] = raw;
    documents[key] = JSON.parse(raw);
  }));
  const [registrySchema, seedSchema, sourcesSchema] = await Promise.all([
    fs.readFile(path.join(schemaRoot, "people-registry.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "people-seed.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "people-sources.schema.json"), "utf8").then(JSON.parse),
  ]);
  return {
    ...documents,
    schemas: { registry: registrySchema, seed: seedSchema, sources: sourcesSchema },
    rawDocuments,
  };
}

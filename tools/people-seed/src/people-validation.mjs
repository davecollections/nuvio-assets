import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "./schema-validator.mjs";
import {
  ACTOR_SUPPLEMENT_COUNTS,
  validateActorSupplement,
} from "./actor-supplement-promotion.mjs";
import { foundationAliasesForPerson } from "./foundation-build-verification.mjs";
import {
  V3_ACTOR_SOURCE_ID,
  V3_DIRECTOR_SOURCE_ID,
  activeAliasesForV3Record,
  validatePeopleOwnerSupplementV3,
  validatePromotedPeopleOwnerSupplementV3Foundation,
} from "./people-owner-supplement-v3-promotion.mjs";

export const EXPECTED_COUNTS = Object.freeze({
  registry: 1480,
  actor: 1071,
  director: 418,
  shared: 9,
  sourceMemberships: 1735,
});

export const EXPECTED_ROLLOUT = Object.freeze({
  actor: Object.freeze({ initial: 843, later: 203, review: 25 }),
  director: Object.freeze({ initial: 272, later: 102, review: 44 }),
});

const EXPECTED_SHARED_PEOPLE = [
  { tmdbPersonId: 40, canonicalName: "Orson Welles" },
  { tmdbPersonId: 190, canonicalName: "Clint Eastwood" },
  { tmdbPersonId: 4818, canonicalName: "Roberto Benigni" },
  { tmdbPersonId: 8630, canonicalName: "Erich von Stroheim" },
  { tmdbPersonId: 8635, canonicalName: "Buster Keaton" },
  { tmdbPersonId: 13294, canonicalName: "Gene Kelly" },
  { tmdbPersonId: 13848, canonicalName: "Charlie Chaplin" },
  { tmdbPersonId: 14639, canonicalName: "Mel Brooks" },
  { tmdbPersonId: 45400, canonicalName: "Greta Gerwig" },
];

const EXPECTED_SOURCE_COUNTS = Object.freeze({
  "filmaholic-top100-actors-2026": 64,
  "imdb-starmeter-2026-07-18": 45,
  "imkaptain-actors": 58,
  "imkaptain-directors": 20,
  "owner-actor-supplement-2026-07": 198,
  "owner-people-v3-actors-2026-08": 548,
  "owner-people-v3-directors-2026-08": 118,
  "ranker-actors": 300,
  "ranker-current-famous-actors-2026": 25,
  "tspdt-21c-directors": 102,
  "tspdt-directors": 257,
});

const EXPECTED_SOURCE_IDS = [
  "filmaholic-top100-actors-2026",
  "imdb-actor-list-ls548798415",
  "imdb-popular-celebrities-ls052283250",
  "imdb-starmeter-2026-07-18",
  "imkaptain-actors",
  "imkaptain-directors",
  "owner-actor-supplement-2026-07",
  "owner-people-v3-actors-2026-08",
  "owner-people-v3-directors-2026-08",
  "ranker-actors",
  "ranker-current-famous-actors-2026",
  "tmdb-identity-resolution",
  "tspdt-21c-directors",
  "tspdt-directors",
  "wikipedia-highest-grossing-actors-2026",
];

const ACTOR_SOURCES = new Set([
  "filmaholic-top100-actors-2026",
  "imdb-starmeter-2026-07-18",
  "imkaptain-actors",
  "owner-actor-supplement-2026-07",
  "owner-people-v3-actors-2026-08",
  "ranker-actors",
  "ranker-current-famous-actors-2026",
]);
const DIRECTOR_SOURCES = new Set(["imkaptain-directors", "owner-people-v3-directors-2026-08", "tspdt-21c-directors", "tspdt-directors"]);
const BASIS_ORDER = [
  "ranker-core",
  "tspdt-all-time",
  "tspdt-21st-century",
  "cross-source",
  "external-supplement",
  "modern-supplement",
  "owner-added",
  "owner-approved-v3",
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
  if (sourceIds.has(category === "actor" ? V3_ACTOR_SOURCE_ID : V3_DIRECTOR_SOURCE_ID)) return ["owner-approved-v3"];
  if (category === "actor") {
    if (sourceIds.has("owner-actor-supplement-2026-07")) return ["owner-added"];
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
    const ownerApprovedSupplement = memberships.some((membership) => membership.sourceId === (category === "actor" ? V3_ACTOR_SOURCE_ID : V3_DIRECTOR_SOURCE_ID))
      || (category === "actor" && memberships.some((membership) => membership.sourceId === "owner-actor-supplement-2026-07"));
    addIf(errors, record.selectionStatus === (ownerApprovedSupplement ? "owner-decided" : "proposed"), `${category} ${record.stableKey}: selection status does not match owner-approval policy`);
    addIf(errors, record.ownerDecision === (ownerApprovedSupplement ? "include" : null), `${category} ${record.stableKey}: owner decision does not match owner-approval policy`);
    addIf(errors, record.ownerNote === "", `${category} ${record.stableKey}: owner note must remain blank`);
    addIf(errors, Object.keys(record.sourceRanks).every((key, index, keys) => index === 0 || keys[index - 1].localeCompare(key) < 0), `${category} ${record.stableKey}: source-rank keys must be ordered`);
    addIf(errors, record.selectionBasis.every((basis, index) => index === 0 || BASIS_ORDER.indexOf(record.selectionBasis[index - 1]) < BASIS_ORDER.indexOf(basis)), `${category} ${record.stableKey}: selection basis must be deterministically ordered`);
  }

  const rollout = countBy(document.records, (record) => record.rolloutTier);
  addIf(errors, sameJson(rollout, EXPECTED_ROLLOUT[category]), `${category} rollout counts do not match the authorised proposal`);
}

export function validatePeopleFoundation({ registry, actors, directors, sources, supplement = null, ownerSupplementV3 = null, schemas = null, rawDocuments = null }) {
  const errors = [];
  if (schemas) {
    errors.push(...validateAgainstSchema(registry, schemas.registry, "people-registry.json"));
    errors.push(...validateAgainstSchema(actors, schemas.seed, "actors-seed.json"));
    errors.push(...validateAgainstSchema(directors, schemas.seed, "directors-seed.json"));
    errors.push(...validateAgainstSchema(sources, schemas.sources, "sources.json"));
    if (supplement && schemas.supplement) errors.push(...validateActorSupplement(supplement, schemas.supplement).errors);
    if (ownerSupplementV3 && schemas.ownerSupplementV3) errors.push(...validatePeopleOwnerSupplementV3(ownerSupplementV3, { schema: schemas.ownerSupplementV3 }).errors);
  }
  if (rawDocuments) {
    for (const [name, document] of Object.entries({
      "people-registry.json": registry,
      "actors-seed.json": actors,
      "directors-seed.json": directors,
      "sources.json": sources,
      ...(supplement ? { "actor-owner-supplement.json": supplement } : {}),
      ...(ownerSupplementV3 ? { "people-owner-supplement-v3.json": ownerSupplementV3 } : {}),
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

  const v3Records = ownerSupplementV3?.package?.records ?? [];
  const v3ById = new Map(v3Records.map((record) => [record.tmdbPersonId, record]));
  const v3NetNewIds = new Set(v3Records.filter((record) => record.createsNetNewPersonIdentity).map((record) => record.tmdbPersonId));

  for (const record of registry.records) {
    addIf(errors, record.stableKey === `person:${record.tmdbPersonId}`, `${record.stableKey}: stable key must equal person:{tmdbPersonId}`);
    addIf(errors, record.reviewStatus === "candidate", `${record.stableKey}: registry status must remain candidate`);
    if (v3NetNewIds.has(record.tmdbPersonId)) {
      addIf(errors, record.knownForDepartment === null, `${record.stableKey}: unavailable v3 department metadata must remain null`);
      addIf(errors, record.actorCreditCount === null && record.directorCreditCount === null, `${record.stableKey}: unavailable v3 credit counts must remain null`);
      addIf(errors, record.activityYearRange === null, `${record.stableKey}: unavailable v3 activity range must remain null`);
      addIf(errors, record.profilePath === v3ById.get(record.tmdbPersonId)?.profilePath, `${record.stableKey}: v3 profile-path metadata must be preserved exactly`);
    } else {
      addIf(errors, record.knownForDepartment !== null, `${record.stableKey}: historical department metadata must be present`);
      addIf(errors, Number.isInteger(record.actorCreditCount) && Number.isInteger(record.directorCreditCount), `${record.stableKey}: historical credit counts must be present`);
      addIf(errors, record.profilePath !== null, `${record.stableKey}: historical profile-path metadata must be present`);
      addIf(errors, record.activityYearRange !== null, `${record.stableKey}: historical activity range must be present`);
      if (record.activityYearRange) addIf(errors, record.activityYearRange.first <= record.activityYearRange.last, `${record.stableKey}: activity year range is reversed`);
    }
    addIf(errors, sameJson(record.sourceMemberships, [...record.sourceMemberships].sort(sourceMembershipComparator)), `${record.stableKey}: source memberships must be deterministically ordered`);
    addIf(errors, sameJson(record.alsoKnownAs, foundationAliasesForPerson(record.tmdbPersonId, record.alsoKnownAs)), `${record.stableKey}: aliases contain an exact-ID invalid source value`);
  }

  const sourceMemberships = registry.records.flatMap((record) => record.sourceMemberships);
  addIf(errors, registry.sourceMembershipCount === sourceMemberships.length, "registry sourceMembershipCount must equal preserved occurrences");
  addIf(errors, sourceMemberships.length === EXPECTED_COUNTS.sourceMemberships, `registry must preserve ${EXPECTED_COUNTS.sourceMemberships} source occurrences`);
  addIf(errors, registry.sourceMembershipFingerprint === sourceMembershipFingerprint(registry.records), "registry source-membership fingerprint mismatch");
  addIf(errors, sameJson(countBy(sourceMemberships, (membership) => membership.sourceId), EXPECTED_SOURCE_COUNTS), "source occurrence counts do not match the completed build");

  const declaredSourceIds = new Set(sources.sources.map((source) => source.sourceId));
  addIf(errors, sourceMemberships.every((membership) => declaredSourceIds.has(membership.sourceId)), "all registry source memberships must reference declared sources");

  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  validateCategory(errors, actors, "actor", registryById);
  validateCategory(errors, directors, "director", registryById);

  const actorIds = new Set(actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(directors.records.map((record) => record.tmdbPersonId));
  const shared = registry.records.filter((record) => actorIds.has(record.tmdbPersonId) && directorIds.has(record.tmdbPersonId));
  addIf(errors, shared.length === EXPECTED_COUNTS.shared, `shared actor/director count must be ${EXPECTED_COUNTS.shared}`);
  addIf(errors, sameJson(shared.map(({ tmdbPersonId, canonicalName }) => ({ tmdbPersonId, canonicalName })), EXPECTED_SHARED_PEOPLE), "shared actor/director identities do not match the exact approved ID set" );

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
  const promotedActors = actors.records.filter((record) => record.selectionBasis.includes("owner-added"));
  addIf(errors, promotedActors.length === ACTOR_SUPPLEMENT_COUNTS.records, "exactly 198 owner-approved actor additions must be identifiable");
  addIf(errors, promotedActors.every((record) => record.selectionStatus === "owner-decided" && record.ownerDecision === "include"), "all promoted actors must retain explicit owner approval");
  addIf(errors, promotedActors.every((record) => record.rolloutTier !== "review"), "no promoted actor may be assigned to review");
  if (supplement) {
    const supplementIds = new Set(supplement.records.map((record) => record.tmdbPersonId));
    addIf(errors, promotedActors.every((record) => supplementIds.has(record.tmdbPersonId)), "promoted actors must match the tracked supplement identities");
    addIf(errors, supplementIds.size === promotedActors.length, "every tracked supplement identity must have one actor membership");
  } else {
    errors.push("tracked actor supplement must be provided for foundation validation");
  }

  const v3ActorIds = v3Records.flatMap((record) => record.categoryMembershipActions
    .filter((action) => action.category === "actor")
    .map(() => record.tmdbPersonId));
  const v3DirectorIds = v3Records.flatMap((record) => record.categoryMembershipActions
    .filter((action) => action.category === "director")
    .map(() => record.tmdbPersonId));
  const v3Actors = actors.records.filter((record) => record.selectionBasis.includes("owner-approved-v3"));
  const v3Directors = directors.records.filter((record) => record.selectionBasis.includes("owner-approved-v3"));
  if (ownerSupplementV3) {
    const exactProjection = validatePromotedPeopleOwnerSupplementV3Foundation({
      registry,
      actors,
      directors,
      sources,
      supplement: ownerSupplementV3,
    });
    errors.push(...exactProjection.errors.map((error) => `People v3 exact projection: ${error}`));
    addIf(errors, sameJson(v3Actors.map((record) => record.tmdbPersonId), v3ActorIds), "v3 Actor memberships must match every authoritative Actor action exactly");
    addIf(errors, sameJson(v3Directors.map((record) => record.tmdbPersonId), v3DirectorIds), "v3 Director memberships must match every authoritative Director action exactly");
    addIf(errors, v3Actors.length === 548 && v3Directors.length === 118, "v3 category memberships must total 548 Actor and 118 Director actions");
    addIf(errors, [...v3Actors, ...v3Directors].every((record) => record.rolloutTier === "initial" && record.recommendedAction === "include-initial"), "every v3 membership must remain initial rollout");
    addIf(errors, [...v3Actors, ...v3Directors].every((record) => record.selectionStatus === "owner-decided" && record.ownerDecision === "include"), "every v3 membership must retain owner include approval");
    for (const sourceRecord of v3Records) {
      const registryRecord = registry.records.find((record) => record.tmdbPersonId === sourceRecord.tmdbPersonId);
      addIf(errors, Boolean(registryRecord), `${sourceRecord.stableKey}: v3 identity is missing from registry`);
      if (!registryRecord) continue;
      addIf(errors, registryRecord.stableKey === sourceRecord.stableKey && registryRecord.canonicalName === sourceRecord.canonicalName, `${sourceRecord.stableKey}: v3 canonical identity conflicts with registry`);
      addIf(errors, sameJson(registryRecord.alsoKnownAs, activeAliasesForV3Record(sourceRecord, ownerSupplementV3.promotionMapping)), `${sourceRecord.stableKey}: v3 aliases do not match the declared active mapping`);
      addIf(errors, registryRecord.identityConfidence === sourceRecord.identityConfidence, `${sourceRecord.stableKey}: v3 identity confidence changed`);
      for (const action of sourceRecord.categoryMembershipActions) {
        const sourceId = action.category === "actor" ? V3_ACTOR_SOURCE_ID : V3_DIRECTOR_SOURCE_ID;
        addIf(errors, registryRecord.sourceMemberships.filter((membership) => membership.sourceId === sourceId).length === 1, `${sourceRecord.stableKey}: v3 ${action.category} provenance must occur exactly once`);
      }
    }
  } else {
    errors.push("tracked People owner supplement v3 must be provided for foundation validation");
  }

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
  addIf(errors, sources.sources.length === EXPECTED_SOURCE_IDS.length, `source registry must contain ${EXPECTED_SOURCE_IDS.length} required sources`);
  addIf(errors, sameJson(sources.sources.map((source) => source.sourceId), EXPECTED_SOURCE_IDS), "source registry must use deterministic source-ID ordering and include every required source");
  addIf(errors, registry.generatedAt === actors.generatedAt && actors.generatedAt === directors.generatedAt && directors.generatedAt === sources.generatedAt, "all canonical files must share the completed-build timestamp");

  for (const document of [registry, actors, directors, sources, ...(supplement ? [supplement] : []), ...(ownerSupplementV3 ? [ownerSupplementV3] : [])]) {
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
      supplementCount: supplement?.records.length ?? 0,
      ownerSupplementV3Count: v3Records.length,
      ownerSupplementV3CategoryActionCount: v3ActorIds.length + v3DirectorIds.length,
    },
  };
}

export function validateChangedPaths(paths) {
  const protectedPrefixes = [
    "tools/studio-network-batch/",
    "assets/collection_covers/companies/",
    "assets/collection_covers/networks/",
  ];
  const protectedFiles = new Set(["assets/collection_covers/manifest.json"]);
  const peopleRoot = "assets/collection_covers/people/";
  const allowedPeoplePublicationPath = (item) => item === `${peopleRoot}manifest.json`
    || new RegExp(`^${peopleRoot}(?:landscape|poster)/[1-9][0-9]*\\.webp$`, "u").test(item);
  return paths.map((item) => item.replaceAll("\\", "/")).filter((item) => (
    protectedFiles.has(item)
    || protectedPrefixes.some((prefix) => item.startsWith(prefix))
    || (item.startsWith(peopleRoot) && !allowedPeoplePublicationPath(item))
  )).map((item) => `protected studio/network or unrecognised people-artwork path changed: ${item}`);
}

export async function validatePeopleAssetBoundary(repoRoot) {
  const peopleRoot = path.join(repoRoot, "assets", "collection_covers", "people");
  const manifestPath = path.join(peopleRoot, "manifest.json");
  const errors = [];
  let entries = [];
  try {
    entries = await fs.readdir(peopleRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && /^[1-9][0-9]*\.webp$/i.test(entry.name)) errors.push(`people portrait asset exists unexpectedly: assets/collection_covers/people/${entry.name}`);
    if (entry.isFile() && /manifest.*\.json$|people.*manifest.*\.json$/i.test(entry.name) && entry.name !== "manifest.json") errors.push(`unrecognised people artwork manifest: assets/collection_covers/people/${entry.name}`);
    if (entry.isDirectory() && !new Set(["landscape", "poster"]).has(entry.name)) errors.push(`unrecognised people artwork directory: assets/collection_covers/people/${entry.name}`);
  }
  const manifestExists = await fs.access(manifestPath).then(() => true, () => false);
  const formatAssetCount = (await Promise.all(["landscape", "poster"].map(async (formatId) => {
    try {
      return (await fs.readdir(path.join(peopleRoot, formatId), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".webp")).length;
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
  }))).reduce((sum, count) => sum + count, 0);
  if (!manifestExists && formatAssetCount > 0) errors.push("people format assets require assets/collection_covers/people/manifest.json");
  if (manifestExists) {
    const { validateTrackedPeopleManifest } = await import("./people-publication.mjs");
    const result = await validateTrackedPeopleManifest({ repoRoot, manifestPath });
    for (const error of [...result.manifestValidation.errors, ...result.pathValidation.errors]) errors.push(`people publication manifest: ${error}`);
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
    supplement: "actor-owner-supplement.json",
    ownerSupplementV3: "people-owner-supplement-v3.json",
  };
  const rawDocuments = {};
  const documents = {};
  await Promise.all(Object.entries(files).map(async ([key, name]) => {
    const raw = await fs.readFile(path.join(dataRoot, name), "utf8");
    rawDocuments[name] = raw;
    documents[key] = JSON.parse(raw);
  }));
  const [registrySchema, seedSchema, sourcesSchema, supplementSchema, ownerSupplementV3Schema] = await Promise.all([
    fs.readFile(path.join(schemaRoot, "people-registry.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "people-seed.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "people-sources.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "actor-owner-supplement.schema.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(schemaRoot, "people-owner-supplement-v3.schema.json"), "utf8").then(JSON.parse),
  ]);
  return {
    ...documents,
    schemas: { registry: registrySchema, seed: seedSchema, sources: sourcesSchema, supplement: supplementSchema, ownerSupplementV3: ownerSupplementV3Schema },
    rawDocuments,
  };
}

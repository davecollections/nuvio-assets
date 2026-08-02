import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { validateAgainstSchema } from "./schema-validator.mjs";

export const PEOPLE_OWNER_SUPPLEMENT_V3_VERSION = "people-owner-supplement-v3";
export const PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256 = "4cfa65603935726d21fef8ce6919f344e6ab834f7a8b730711415ecef730d650";
export const PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_FILENAME = "final-owner-approved-people-v3.json";
export const PEOPLE_OWNER_SUPPLEMENT_V3_AUDIT_WORKSPACE = "tools/people-seed/.work/actor-gap-audit-v2/attempt-20260802T011012Z-complete-actor-triage";
export const PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_PATH = `${PEOPLE_OWNER_SUPPLEMENT_V3_AUDIT_WORKSPACE}/${PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_FILENAME}`;
export const PEOPLE_OWNER_SUPPLEMENT_V3_TRACKED_PATH = "data/people/people-owner-supplement-v3.json";
export const PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT = "2026-08-02T04:41:32.516Z";
export const PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTION_TIMESTAMP = PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT;
export const PEOPLE_OWNER_SUPPLEMENT_V3_ACTOR_SOURCE_ID = "owner-people-v3-actors-2026-08";
export const PEOPLE_OWNER_SUPPLEMENT_V3_DIRECTOR_SOURCE_ID = "owner-people-v3-directors-2026-08";
export const PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_TYPE = "owner-approved-membership-package";
export const PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS = Object.freeze({
  actor: PEOPLE_OWNER_SUPPLEMENT_V3_ACTOR_SOURCE_ID,
  director: PEOPLE_OWNER_SUPPLEMENT_V3_DIRECTOR_SOURCE_ID,
});
export const AUTHORITY_SOURCE_RELATIVE_PATH = PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_PATH;
export const AUTHORITY_SOURCE_SHA256 = PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256;
export const TRACKED_SUPPLEMENT_RELATIVE_PATH = PEOPLE_OWNER_SUPPLEMENT_V3_TRACKED_PATH;
export const PROMOTION_TIMESTAMP = PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT;
export const V3_ACTOR_SOURCE_ID = PEOPLE_OWNER_SUPPLEMENT_V3_ACTOR_SOURCE_ID;
export const V3_DIRECTOR_SOURCE_ID = PEOPLE_OWNER_SUPPLEMENT_V3_DIRECTOR_SOURCE_ID;

export const PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS = Object.freeze({
  records: 665,
  actorActions: 548,
  directorActions: 118,
  categoryActions: 666,
  netNewIdentities: 663,
  existingIdentityMembershipAdditions: 2,
  aliasSentinelOccurrences: 32,
});

const CATEGORY_ORDER = Object.freeze(["actor", "director"]);
const EXPECTED_BASELINE_OVERLAP_IDS = Object.freeze([40, 190, 8635, 13294, 13848, 14639]);
const EXPECTED_PROJECTED_OVERLAP_IDS = Object.freeze([40, 190, 4818, 8630, 8635, 13294, 13848, 14639, 45400]);
const EXPECTED_EXISTING_PACKAGE_IDS = Object.freeze([8630, 45400]);
const FORBIDDEN_IDENTIFIER_KEYS = /^(?:imdb|mdb(?:list)?|tmdbList|wikidata|list)(?:Person)?Id$/iu;
const FORBIDDEN_SECRET_KEYS = /(?:api[_-]?key|access[_-]?token|secret|credential|password)/iu;

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => structuredClone(value);
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const addIf = (errors, condition, message) => { if (!condition) errors.push(message); };

const authoritativeSource = Object.freeze({
  filename: PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_FILENAME,
  repositoryRelativePath: PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_PATH,
  auditWorkspace: PEOPLE_OWNER_SUPPLEMENT_V3_AUDIT_WORKSPACE,
  sha256: PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256,
});

const promotionMapping = Object.freeze({
  identityAuthority: "exact-tmdb-person-id",
  stableKeyFormat: "person:{tmdbPersonId}",
  unsupportedAliasSentinels: Object.freeze(["-"]),
  profilePathPolicy: "preserve-relative-or-null",
  categoryActionPolicy: "exact-approved-add-membership-pairs",
  selectionBasis: "owner-approved-v3",
  categorySourceIds: PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS,
  sourceType: PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_TYPE,
});

function categoryComparator(left, right) {
  return CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right);
}

function sourceMembershipComparator(left, right) {
  return left.sourceId.localeCompare(right.sourceId)
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
    || left.sourceName.localeCompare(right.sourceName)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function sourceMembershipFingerprint(records) {
  const occurrences = records.flatMap((record) => record.sourceMemberships.map((membership) => ({
    stableKey: record.stableKey,
    ...membership,
  })));
  return sha256(JSON.stringify(occurrences));
}

function recordsOf(document) {
  if (Array.isArray(document)) return document;
  return document?.records;
}

function idsOf(document) {
  return new Set((recordsOf(document) ?? []).map((record) => record.tmdbPersonId));
}

function categoryPairs(records) {
  if (!Array.isArray(records)) return [];
  return records.flatMap((record) => (
    record !== null && typeof record === "object" && Array.isArray(record.categoryMembershipActions)
      ? record.categoryMembershipActions
        .filter((action) => action !== null && typeof action === "object")
        .map((action) => `${record.tmdbPersonId}:${action.category}`)
      : []
  ));
}

function hasUsableRecordCollections(record) {
  return record !== null
    && typeof record === "object"
    && Array.isArray(record.aliases)
    && Array.isArray(record.approvedCategories)
    && Array.isArray(record.categoryMembershipActions)
    && record.categoryMembershipActions.every((action) => action !== null && typeof action === "object" && !Array.isArray(action))
    && Array.isArray(record.currentCategoryMemberships)
    && Array.isArray(record.approvalSources)
    && record.approvalSources.every((approval) => approval !== null
      && typeof approval === "object"
      && !Array.isArray(approval)
      && Array.isArray(approval.approvedCategories));
}

function hasUsablePackageCollections(packageValue) {
  return packageValue !== null
    && typeof packageValue === "object"
    && !Array.isArray(packageValue)
    && Array.isArray(packageValue.records)
    && packageValue.records.every(hasUsableRecordCollections)
    && Array.isArray(packageValue.baseline?.overlapPeople)
    && Array.isArray(packageValue.projectedOverlapPeople)
    && packageValue.counts !== null
    && typeof packageValue.counts === "object";
}

function maximumGeneratedAt(...documents) {
  const values = [PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT, ...documents.map((document) => document?.generatedAt).filter(Boolean)];
  return values.reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
}

function inspectPortableAndIdentifierValues(value, errors, pathName = "$", keyName = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPortableAndIdentifierValues(item, errors, `${pathName}[${index}]`, keyName));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_IDENTIFIER_KEYS.test(key)) errors.push(`${pathName}.${key}: unsupported identifier namespace`);
      if (FORBIDDEN_SECRET_KEYS.test(key)) errors.push(`${pathName}.${key}: secret or credential field is prohibited`);
      inspectPortableAndIdentifierValues(child, errors, `${pathName}.${key}`, key);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (/^[A-Za-z]:[\\/]/u.test(value) || /^\\\\/u.test(value)) errors.push(`${pathName}: local absolute path is prohibited`);
  if (/^https?:\/\//iu.test(value)) errors.push(`${pathName}: external URL is prohibited`);
  if (value.startsWith("/") && keyName !== "profilePath") errors.push(`${pathName}: local absolute path is prohibited`);
}

function validateApprovalSource(errors, record, approval, index) {
  const label = `${record.stableKey} approvalSources[${index}]`;
  const authoritativeFields = ["sourceType", "sourcePath", "sourceSha256", "approvalSource", "sourceAttempt", "approvedCategories"];
  const batchFields = ["sourceType", "sourcePath", "sourceSha256", "approvalBatch", "batchReviewOrder", "sourcePriorityOrder", "approvedCategories"];
  const expectedFields = approval.sourceType === "authoritative-v2" ? authoritativeFields : batchFields;
  addIf(errors, sameJson(Object.keys(approval), expectedFields), `${label}: approval source shape does not match its sourceType`);
  addIf(errors, approval.approvedCategories.length === 1, `${label}: approval source must bind exactly one category`);
}

function validateInternalPackage(wrapper, errors) {
  const packageValue = wrapper?.package;
  if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) return;

  addIf(errors, authoritativePackagePayload(wrapper) !== null, "tracked supplement must contain an authoritative package payload");
  addIf(errors, sha256(authoritativePackagePayload(wrapper) ?? "") === PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256, "authoritative package payload SHA-256 mismatch");
  addIf(errors, packageValue.recordCount === packageValue.records?.length, "authoritative package recordCount must equal records length");
  addIf(errors, packageValue.records?.length === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.records, "authoritative package must contain 665 records");
  if (!Array.isArray(packageValue.records)) return;
  if (!packageValue.records.every((record) => record !== null && typeof record === "object" && !Array.isArray(record))) {
    errors.push("authoritative package records must be objects");
    return;
  }

  const ids = packageValue.records.map((record) => record.tmdbPersonId);
  addIf(errors, ids.every(Number.isSafeInteger), "all TMDB Person IDs must be safe integers");
  addIf(errors, new Set(ids).size === ids.length, "authoritative package must not duplicate TMDB Person IDs");
  addIf(errors, ids.every((id, index) => index === 0 || ids[index - 1] < id), "authoritative package must use ascending numeric TMDB Person ID ordering");

  const pairs = categoryPairs(packageValue.records);
  addIf(errors, new Set(pairs).size === pairs.length, "authoritative package must not duplicate category actions");
  const actorActions = pairs.filter((pair) => pair.endsWith(":actor")).length;
  const directorActions = pairs.filter((pair) => pair.endsWith(":director")).length;
  addIf(errors, actorActions === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.actorActions, "authoritative package must contain 548 Actor actions");
  addIf(errors, directorActions === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.directorActions, "authoritative package must contain 118 Director actions");
  addIf(errors, pairs.length === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.categoryActions, "authoritative package must contain 666 category actions");

  let sentinelOccurrences = 0;
  for (const record of packageValue.records) {
    const label = record.stableKey ?? `person:${record.tmdbPersonId}`;
    addIf(errors, record.stableKey === `person:${record.tmdbPersonId}`, `${label}: stable key must bind the exact TMDB Person ID`);
    addIf(errors, record.ownerDecision === "include", `${label}: owner decision must be include`);
    addIf(errors, record.recommendedRollout === "initial", `${label}: rollout must be initial`);
    if (!hasUsableRecordCollections(record)) {
      errors.push(`${label}: record collections are missing or malformed`);
      continue;
    }
    addIf(errors, !record.aliases.includes(record.canonicalName), `${label}: aliases must not repeat the canonical name`);
    addIf(errors, new Set(record.aliases).size === record.aliases.length, `${label}: aliases must be unique within the exact identity`);
    sentinelOccurrences += record.aliases.filter((alias) => alias === "-").length;

    const categories = [...record.approvedCategories].sort(categoryComparator);
    const actionCategories = record.categoryMembershipActions.map((action) => action.category).sort(categoryComparator);
    addIf(errors, sameJson(record.approvedCategories, categories), `${label}: approved categories are not deterministically ordered`);
    addIf(errors, sameJson(categories, actionCategories), `${label}: approved categories and membership actions differ`);
    addIf(errors, record.categoryMembershipActions.every((action) => action.currentMembership === false && action.action === "add-membership"), `${label}: every category action must be a true addition`);

    const currentCategories = [
      ...(record.currentActorMembership ? ["actor"] : []),
      ...(record.currentDirectorMembership ? ["director"] : []),
    ];
    addIf(errors, sameJson(record.currentCategoryMemberships, currentCategories), `${label}: current category fields disagree`);
    const isExisting = record.currentRegistryStatus !== "absent";
    addIf(errors, isExisting === !record.createsNetNewPersonIdentity, `${label}: current registry and net-new fields disagree`);
    addIf(errors, record.personIdentityAction === (isExisting ? "reuse-existing-person" : "create-new-person"), `${label}: person identity action disagrees with current registry state`);
    addIf(errors, record.addsActorMembershipToExistingPerson === (isExisting && categories.includes("actor")), `${label}: existing Actor-addition flag disagrees with actions`);
    addIf(errors, record.addsDirectorMembershipToExistingPerson === (isExisting && categories.includes("director")), `${label}: existing Director-addition flag disagrees with actions`);
    addIf(errors, record.addsBothNewCategoryMemberships === (!isExisting && categories.length === 2), `${label}: dual-category flag disagrees with actions`);
    addIf(errors, record.categoryMembershipActions.every((action) => !currentCategories.includes(action.category)), `${label}: category action already exists in current membership state`);

    record.approvalSources.forEach((approval, index) => validateApprovalSource(errors, record, approval, index));
    const approvedBySources = [...new Set(record.approvalSources.flatMap((approval) => approval.approvedCategories))].sort(categoryComparator);
    addIf(errors, sameJson(categories, approvedBySources), `${label}: approval sources do not cover the exact approved categories`);
  }
  addIf(errors, sentinelOccurrences === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.aliasSentinelOccurrences, "authoritative package must preserve exactly 32 '-' alias sentinels");

  const newCount = packageValue.records.filter((record) => record.createsNetNewPersonIdentity).length;
  const existingIds = packageValue.records.filter((record) => !record.createsNetNewPersonIdentity).map((record) => record.tmdbPersonId);
  addIf(errors, newCount === PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.netNewIdentities, "authoritative package must contain 663 net-new identities");
  addIf(errors, sameJson(existingIds, EXPECTED_EXISTING_PACKAGE_IDS), "existing registry membership-only additions must be Erich von Stroheim and Greta Gerwig");
  addIf(errors, Array.isArray(packageValue.baseline?.overlapPeople), "authoritative package baseline overlap list is missing or malformed");
  if (Array.isArray(packageValue.baseline?.overlapPeople)) {
    const overlapPeopleAreObjects = packageValue.baseline.overlapPeople.every((person) => person !== null && typeof person === "object" && !Array.isArray(person));
    addIf(errors, overlapPeopleAreObjects, "authoritative package baseline overlap entries are malformed");
    if (overlapPeopleAreObjects) {
      addIf(errors, sameJson(packageValue.baseline.overlapPeople.map((person) => person.tmdbPersonId), EXPECTED_BASELINE_OVERLAP_IDS), "authoritative package baseline overlap set changed");
    }
  }
  addIf(errors, Array.isArray(packageValue.projectedOverlapPeople), "authoritative package projected overlap list is missing or malformed");
  if (Array.isArray(packageValue.projectedOverlapPeople)) {
    const overlapPeopleAreObjects = packageValue.projectedOverlapPeople.every((person) => person !== null && typeof person === "object" && !Array.isArray(person));
    addIf(errors, overlapPeopleAreObjects, "authoritative package projected overlap entries are malformed");
    if (overlapPeopleAreObjects) {
      addIf(errors, sameJson(packageValue.projectedOverlapPeople.map((person) => person.tmdbPersonId), EXPECTED_PROJECTED_OVERLAP_IDS), "authoritative package projected overlap set changed");
    }
  }
}

function validateAgainstBaseline(wrapper, baseline, errors) {
  if (!baseline) return;
  const registryRecords = recordsOf(baseline.registry);
  const actorRecords = recordsOf(baseline.actors);
  const directorRecords = recordsOf(baseline.directors);
  if (!Array.isArray(registryRecords) || !Array.isArray(actorRecords) || !Array.isArray(directorRecords)) {
    errors.push("baseline must provide registry, actors, and directors records");
    return;
  }

  const packageValue = wrapper.package;
  const registryById = new Map(registryRecords.map((record) => [record.tmdbPersonId, record]));
  const actorIds = idsOf(actorRecords);
  const directorIds = idsOf(directorRecords);
  addIf(errors, registryRecords.length === packageValue.baseline.uniquePeople, "tracked registry count differs from authoritative baseline");
  addIf(errors, actorRecords.length === packageValue.baseline.actorMemberships, "tracked Actor count differs from authoritative baseline");
  addIf(errors, directorRecords.length === packageValue.baseline.directorMemberships, "tracked Director count differs from authoritative baseline");

  const overlapIds = [...actorIds].filter((id) => directorIds.has(id)).sort((left, right) => left - right);
  addIf(errors, sameJson(overlapIds, EXPECTED_BASELINE_OVERLAP_IDS), "tracked baseline overlap set differs from authoritative baseline");

  for (const record of packageValue.records) {
    const existing = registryById.get(record.tmdbPersonId);
    const currentCategories = [
      ...(actorIds.has(record.tmdbPersonId) ? ["actor"] : []),
      ...(directorIds.has(record.tmdbPersonId) ? ["director"] : []),
    ];
    addIf(errors, Boolean(existing) === !record.createsNetNewPersonIdentity, `${record.stableKey}: tracked registry presence differs from declared current state`);
    addIf(errors, sameJson(currentCategories, record.currentCategoryMemberships), `${record.stableKey}: tracked category state differs from declared current state`);
    for (const action of record.categoryMembershipActions) {
      addIf(errors, !currentCategories.includes(action.category), `${record.stableKey}: ${action.category} action is not a new membership`);
    }
    if (!existing) continue;
    addIf(errors, existing.stableKey === record.stableKey, `${record.stableKey}: existing stable key conflicts`);
    addIf(errors, existing.canonicalName === record.canonicalName, `${record.stableKey}: existing canonical name conflicts`);
    addIf(errors, sameJson(existing.alsoKnownAs, record.aliases), `${record.stableKey}: existing aliases conflict`);
    addIf(errors, existing.profilePath === record.profilePath, `${record.stableKey}: existing profile path conflicts`);
    addIf(errors, existing.identityConfidence === record.identityConfidence, `${record.stableKey}: existing identity confidence conflicts`);
  }

  const projectedRegistry = new Set([...registryById.keys(), ...packageValue.records.map((record) => record.tmdbPersonId)]);
  const projectedActors = new Set(actorIds);
  const projectedDirectors = new Set(directorIds);
  for (const record of packageValue.records) {
    for (const action of record.categoryMembershipActions) {
      (action.category === "actor" ? projectedActors : projectedDirectors).add(record.tmdbPersonId);
    }
  }
  const projectedOverlaps = [...projectedActors].filter((id) => projectedDirectors.has(id)).sort((left, right) => left - right);
  addIf(errors, projectedRegistry.size === packageValue.counts.projectedUniquePeople, "projected registry count differs from authoritative package");
  addIf(errors, projectedActors.size === packageValue.counts.projectedActorMemberships, "projected Actor count differs from authoritative package");
  addIf(errors, projectedDirectors.size === packageValue.counts.projectedDirectorMemberships, "projected Director count differs from authoritative package");
  addIf(errors, sameJson(projectedOverlaps, EXPECTED_PROJECTED_OVERLAP_IDS), "projected overlap set differs from authoritative package");
}

export function buildTrackedPeopleOwnerSupplementV3(authoritativePackage) {
  return {
    trackedSupplementVersion: PEOPLE_OWNER_SUPPLEMENT_V3_VERSION,
    promotedAt: PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT,
    authoritativeSource: clone(authoritativeSource),
    promotionMapping: clone(promotionMapping),
    package: clone(authoritativePackage),
  };
}

export function authoritativePackagePayload(wrapper) {
  if (!wrapper || typeof wrapper !== "object" || !wrapper.package || typeof wrapper.package !== "object" || Array.isArray(wrapper.package)) return null;
  return json(wrapper.package);
}

export function activeAliasesForV3Record(record, mapping = promotionMapping) {
  const aliases = Array.isArray(record?.aliases) ? record.aliases : [];
  const sentinels = Array.isArray(mapping?.unsupportedAliasSentinels) ? mapping.unsupportedAliasSentinels : [];
  const excluded = new Set(sentinels);
  return aliases.filter((alias) => !excluded.has(alias));
}

export function peopleOwnerSupplementV3SourceDefinitions() {
  return CATEGORY_ORDER.map((category) => ({
    sourceId: PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS[category],
    displayTitle: `Nuvio owner-approved People v3 ${category === "actor" ? "Actor" : "Director"} memberships`,
    sourceType: PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_TYPE,
    sourceUrl: null,
    sourceFile: PEOPLE_OWNER_SUPPLEMENT_V3_TRACKED_PATH,
    publicationOrSnapshotYear: 2026,
    retrievalTimestamp: null,
    sourceHash: {
      algorithm: "sha256",
      value: PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256,
      scope: "complete authoritative package payload embedded in the tracked People owner supplement v3",
    },
    extractionMethod: `Promoted only exact owner-approved ${category === "actor" ? "Actor" : "Director"} membership actions from the hash-bound tracked People v3 package.`,
    completenessStatement: `All ${category === "actor" ? PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.actorActions : PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.directorActions} approved ${category === "actor" ? "Actor" : "Director"} membership actions are represented without a fabricated source rank or retrieval timestamp.`,
    knownLimitations: [
      "Catalogue membership approval is not portrait, artwork, manifest, runtime, or publication approval.",
      "Unavailable career snapshot metadata remains null and must not be inferred from category membership.",
    ],
    rankingDynamicWarning: null,
  }));
}

export function validatePeopleOwnerSupplementV3(wrapper, { schema = null, authoritativeRaw = null, baseline = null } = {}) {
  const errors = [];
  if (schema) errors.push(...validateAgainstSchema(wrapper, schema, "people-owner-supplement-v3.json"));

  addIf(errors, wrapper?.trackedSupplementVersion === PEOPLE_OWNER_SUPPLEMENT_V3_VERSION, "tracked supplement version mismatch");
  addIf(errors, wrapper?.promotedAt === PEOPLE_OWNER_SUPPLEMENT_V3_PROMOTED_AT, "tracked supplement promotedAt mismatch");
  addIf(errors, isDeepStrictEqual(wrapper?.authoritativeSource, authoritativeSource), "authoritative source binding mismatch");
  addIf(errors, isDeepStrictEqual(wrapper?.promotionMapping, promotionMapping), "promotion mapping mismatch");
  validateInternalPackage(wrapper, errors);
  if (wrapper?.package) inspectPortableAndIdentifierValues(wrapper.package, errors);

  if (authoritativeRaw !== null) {
    const bytes = Buffer.isBuffer(authoritativeRaw) || authoritativeRaw instanceof Uint8Array
      ? Buffer.from(authoritativeRaw)
      : Buffer.from(String(authoritativeRaw), "utf8");
    addIf(errors, sha256(bytes) === PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256, "raw authoritative source SHA-256 mismatch");
    try {
      const parsed = JSON.parse(bytes.toString("utf8"));
      addIf(errors, isDeepStrictEqual(wrapper?.package, parsed), "tracked package meaning differs from authoritative source");
    } catch (error) {
      errors.push(`raw authoritative source is not valid JSON: ${error.message}`);
    }
  }

  if (hasUsablePackageCollections(wrapper?.package)) validateAgainstBaseline(wrapper, baseline, errors);
  else if (baseline) errors.push("baseline comparison requires a structurally valid authoritative package");
  const records = Array.isArray(wrapper?.package?.records) ? wrapper.package.records : [];
  const pairs = categoryPairs(records);
  return {
    errors,
    summary: {
      valid: errors.length === 0,
      authoritativeSha256: PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256,
      recordCount: records.length,
      actorActionCount: pairs.filter((pair) => pair.endsWith(":actor")).length,
      directorActionCount: pairs.filter((pair) => pair.endsWith(":director")).length,
      categoryActionCount: pairs.length,
      netNewIdentityCount: records.filter((record) => record?.createsNetNewPersonIdentity).length,
      existingIdentityMembershipAdditionCount: records.filter((record) => record && !record.createsNetNewPersonIdentity).length,
      activeAliasExclusionCount: records.reduce((count, record) => Array.isArray(record?.aliases)
        ? count + record.aliases.length - activeAliasesForV3Record(record, wrapper?.promotionMapping ?? promotionMapping).length
        : count, 0),
    },
  };
}

function v3SourceMembership(record, category) {
  return {
    sourceId: PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS[category],
    sourceRank: null,
    sourceName: record.canonicalName,
    ownerDecision: "include",
  };
}

function v3RegistryRecord(record) {
  return {
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    alsoKnownAs: activeAliasesForV3Record(record),
    knownForDepartment: null,
    profilePath: record.profilePath,
    actorCreditCount: null,
    directorCreditCount: null,
    activityYearRange: null,
    categoryMembership: [...record.approvedCategories],
    identityConfidence: record.identityConfidence,
    identityEvidence: [
      `Owner-approved exact TMDB Person ID in the tracked People v3 package bound to authoritative SHA-256 ${PEOPLE_OWNER_SUPPLEMENT_V3_AUTHORITATIVE_SHA256}.`,
    ],
    sourceMemberships: record.approvedCategories.map((category) => v3SourceMembership(record, category)).sort(sourceMembershipComparator),
    reviewStatus: "candidate",
  };
}

function mergeV3RegistryRecord(existingRecord, supplementRecord) {
  const record = clone(existingRecord);
  record.categoryMembership = [...new Set([...record.categoryMembership, ...supplementRecord.approvedCategories])].sort(categoryComparator);
  record.sourceMemberships = [
    ...record.sourceMemberships,
    ...supplementRecord.approvedCategories.map((category) => v3SourceMembership(supplementRecord, category)),
  ].sort(sourceMembershipComparator);
  return record;
}

function v3CategoryRecord(record, category) {
  return {
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    category,
    rolloutTier: "initial",
    selectionBasis: ["owner-approved-v3"],
    sourceRanks: {},
    recommendedAction: "include-initial",
    selectionStatus: "owner-decided",
    ownerDecision: "include",
    ownerNote: "",
  };
}

export function stripPeopleOwnerSupplementV3Foundation({ registry, actors, directors, sources, supplement }) {
  const packageValue = supplement.package;
  const netNewIds = new Set(packageValue.records.filter((record) => record.createsNetNewPersonIdentity).map((record) => record.tmdbPersonId));
  const actionPairs = new Set(categoryPairs(packageValue.records));
  const currentCategoriesById = new Map(packageValue.records.map((record) => [record.tmdbPersonId, record.currentCategoryMemberships]));
  const sourceIds = new Set(Object.values(PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS));

  const registryRecords = registry.records.filter((record) => !netNewIds.has(record.tmdbPersonId)).map((record) => {
    if (!currentCategoriesById.has(record.tmdbPersonId)) return clone(record);
    return {
      ...clone(record),
      categoryMembership: [...currentCategoriesById.get(record.tmdbPersonId)],
      sourceMemberships: record.sourceMemberships.filter((membership) => !sourceIds.has(membership.sourceId)),
    };
  }).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const stripCategory = (document) => document.records.filter((record) => !actionPairs.has(`${record.tmdbPersonId}:${record.category}`)).map(clone).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const actorRecords = stripCategory(actors);
  const directorRecords = stripCategory(directors);
  const sourceRecords = sources.sources.filter((source) => !sourceIds.has(source.sourceId)).map(clone).sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  return {
    registry: {
      ...clone(registry),
      recordCount: registryRecords.length,
      sourceMembershipCount: registryRecords.reduce((sum, record) => sum + record.sourceMemberships.length, 0),
      sourceMembershipFingerprint: sourceMembershipFingerprint(registryRecords),
      records: registryRecords,
    },
    actors: { ...clone(actors), recordCount: actorRecords.length, records: actorRecords },
    directors: { ...clone(directors), recordCount: directorRecords.length, records: directorRecords },
    sources: { ...clone(sources), sourceCount: sourceRecords.length, sources: sourceRecords },
  };
}

function buildPromotedFoundation(base, supplement, generatedAt) {
  const registryById = new Map(base.registry.records.map((record) => [record.tmdbPersonId, clone(record)]));
  const actorRecords = [...base.actors.records];
  const directorRecords = [...base.directors.records];

  for (const record of supplement.package.records) {
    let registryRecord = registryById.get(record.tmdbPersonId);
    if (!registryRecord) {
      registryRecord = v3RegistryRecord(record);
      registryById.set(record.tmdbPersonId, registryRecord);
    } else {
      registryRecord = mergeV3RegistryRecord(registryRecord, record);
      registryById.set(record.tmdbPersonId, registryRecord);
    }
    for (const category of record.approvedCategories) {
      (category === "actor" ? actorRecords : directorRecords).push(v3CategoryRecord(record, category));
    }
  }

  const registryRecords = [...registryById.values()].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  actorRecords.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  directorRecords.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const sourceRecords = [...base.sources.sources, ...peopleOwnerSupplementV3SourceDefinitions()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    registry: {
      ...base.registry,
      generatedAt,
      recordCount: registryRecords.length,
      sourceMembershipCount: registryRecords.reduce((sum, record) => sum + record.sourceMemberships.length, 0),
      sourceMembershipFingerprint: sourceMembershipFingerprint(registryRecords),
      records: registryRecords,
    },
    actors: { ...base.actors, generatedAt, recordCount: actorRecords.length, records: actorRecords },
    directors: { ...base.directors, generatedAt, recordCount: directorRecords.length, records: directorRecords },
    sources: { ...base.sources, generatedAt, sourceCount: sourceRecords.length, sources: sourceRecords },
  };
}

export function validatePromotedPeopleOwnerSupplementV3Foundation({ registry, actors, directors, sources, supplement, baseline = null }) {
  const errors = [];
  const supplementValidation = validatePeopleOwnerSupplementV3(supplement);
  errors.push(...supplementValidation.errors.map((error) => `supplement: ${error}`));
  if (supplementValidation.errors.length > 0) return { errors, summary: { valid: false } };

  const current = { registry, actors, directors, sources };
  const base = baseline ?? stripPeopleOwnerSupplementV3Foundation({ ...current, supplement });
  const generatedAt = maximumGeneratedAt(base.registry, base.actors, base.directors, base.sources);
  const expected = buildPromotedFoundation(base, supplement, generatedAt);
  for (const name of ["registry", "actors", "directors", "sources"]) {
    addIf(errors, isDeepStrictEqual(current[name], expected[name]), `${name}: promoted document differs from the exact deterministic v3 merge`);
    addIf(errors, current[name]?.generatedAt === generatedAt, `${name}: generatedAt must equal ${generatedAt}`);
  }

  const registryRecords = registry?.records ?? [];
  const actorRecords = actors?.records ?? [];
  const directorRecords = directors?.records ?? [];
  const sourceRecords = sources?.sources ?? [];
  const expectedRegistryCount = base.registry.records.length + PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.netNewIdentities;
  const expectedActorCount = base.actors.records.length + PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.actorActions;
  const expectedDirectorCount = base.directors.records.length + PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.directorActions;
  const expectedSourceCount = base.sources.sources.length + Object.keys(PEOPLE_OWNER_SUPPLEMENT_V3_SOURCE_IDS).length;
  const expectedMembershipCount = base.registry.sourceMembershipCount + PEOPLE_OWNER_SUPPLEMENT_V3_COUNTS.categoryActions;
  addIf(errors, registryRecords.length === expectedRegistryCount, `registry must contain ${expectedRegistryCount} identities after v3 promotion`);
  addIf(errors, actorRecords.length === expectedActorCount, `Actor seed must contain ${expectedActorCount} memberships after v3 promotion`);
  addIf(errors, directorRecords.length === expectedDirectorCount, `Director seed must contain ${expectedDirectorCount} memberships after v3 promotion`);
  addIf(errors, sourceRecords.length === expectedSourceCount, `source registry must contain ${expectedSourceCount} definitions after v3 promotion`);
  addIf(errors, registry?.sourceMembershipCount === expectedMembershipCount, `registry must contain ${expectedMembershipCount} source occurrences after v3 promotion`);
  addIf(errors, registry?.sourceMembershipFingerprint === sourceMembershipFingerprint(registryRecords), "promoted registry source-membership fingerprint mismatch");
  addIf(errors, registryRecords.every((record, index) => index === 0 || registryRecords[index - 1].tmdbPersonId < record.tmdbPersonId), "promoted registry is not in ascending TMDB Person ID order");
  addIf(errors, actorRecords.every((record, index) => index === 0 || actorRecords[index - 1].tmdbPersonId < record.tmdbPersonId), "promoted Actor seed is not in ascending TMDB Person ID order");
  addIf(errors, directorRecords.every((record, index) => index === 0 || directorRecords[index - 1].tmdbPersonId < record.tmdbPersonId), "promoted Director seed is not in ascending TMDB Person ID order");
  addIf(errors, registryRecords.flatMap((record) => record.alsoKnownAs).every((alias) => alias !== "-"), "unsupported '-' alias sentinel entered the active registry");

  return {
    errors,
    summary: {
      valid: errors.length === 0,
      generatedAt,
      registryCount: registryRecords.length,
      actorCount: actorRecords.length,
      directorCount: directorRecords.length,
      sourceCount: sourceRecords.length,
      sourceMembershipCount: registry?.sourceMembershipCount ?? 0,
      sourceMembershipFingerprint: registry?.sourceMembershipFingerprint ?? null,
    },
  };
}

export function mergePeopleOwnerSupplementV3Foundation({ registry, actors, directors, sources, supplement }) {
  const supplementValidation = validatePeopleOwnerSupplementV3(supplement);
  if (supplementValidation.errors.length > 0) {
    throw new Error(`People owner supplement v3 is invalid:\n${supplementValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const base = stripPeopleOwnerSupplementV3Foundation({ registry, actors, directors, sources, supplement });
  const generatedAt = maximumGeneratedAt(registry, actors, directors, sources);
  const promoted = buildPromotedFoundation(base, supplement, generatedAt);
  const validation = validatePromotedPeopleOwnerSupplementV3Foundation({ ...promoted, supplement, baseline: base });
  if (validation.errors.length > 0) {
    throw new Error(`Promoted People foundation v3 is invalid:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return promoted;
}

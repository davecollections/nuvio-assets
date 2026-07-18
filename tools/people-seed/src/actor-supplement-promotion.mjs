import { createHash } from "node:crypto";

import { validateAgainstSchema } from "./schema-validator.mjs";

export const ACTOR_SUPPLEMENT_COUNTS = Object.freeze({
  records: 198,
  initial: 95,
  later: 103,
  review: 0,
  sourceDefinitions: 7,
  sourceMemberships: 332,
});

export const ACTOR_SUPPLEMENT_SOURCE_IDS = Object.freeze([
  "filmaholic-top100-actors-2026",
  "imdb-actor-list-ls548798415",
  "imdb-popular-celebrities-ls052283250",
  "imdb-starmeter-2026-07-18",
  "owner-actor-supplement-2026-07",
  "ranker-current-famous-actors-2026",
  "wikipedia-highest-grossing-actors-2026",
]);

export const ACTOR_SUPPLEMENT_MEMBERSHIP_SOURCE_IDS = Object.freeze([
  "filmaholic-top100-actors-2026",
  "imdb-starmeter-2026-07-18",
  "owner-actor-supplement-2026-07",
  "ranker-current-famous-actors-2026",
]);

export const PROMOTION_TIMESTAMP = "2026-07-17T14:00:00.000Z";
export const SOURCE_RETRIEVAL_TIMESTAMP = "2026-07-18T00:00:00.000Z";
export const APPROVED_EVIDENCE_PATH = "tools/people-seed/.work/actor-owner-supplement-review/drafts/actor-owner-supplement.draft.json";
export const APPROVED_EVIDENCE_SHA256 = "ebc3661dd4806ce8bf3a39ef15c1e4e07691202540d71bff7168d1f46b2b94a1";

const GROUP_COUNTS = Object.freeze({ A: 64, B: 25, C: 64, D: 32, E: 13 });
const APPROVED_CANONICAL_DIFFERENCES = Object.freeze({
  "George “Buck” Flower": "George Buck Flower",
  "Govardhan Asrani": "Asrani",
  "Sammo Hung": "Sammo Hung Kam-Bo",
  "Emma D’Arcy": "Emma D'Arcy",
  "Lupita Nyong’o": "Lupita Nyong'o",
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countBy(items, selector) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function addIf(errors, condition, message) {
  if (!condition) errors.push(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalisePersonName(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[“”‘’'\"`]/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function supplementMembershipComparator(left, right) {
  return left.sourceId.localeCompare(right.sourceId)
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
    || left.sourceName.localeCompare(right.sourceName)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function fingerprint(records) {
  const occurrences = records.flatMap((record) => record.sourceMemberships.map((membership) => ({
    stableKey: record.stableKey,
    ...membership,
  })));
  return createHash("sha256").update(JSON.stringify(occurrences)).digest("hex");
}

function sourceRanks(memberships) {
  const grouped = new Map();
  for (const membership of memberships) {
    if (!Number.isInteger(membership.sourceRank)) continue;
    if (!grouped.has(membership.sourceId)) grouped.set(membership.sourceId, []);
    grouped.get(membership.sourceId).push(membership.sourceRank);
  }
  return Object.fromEntries([...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, ranks]) => [
    sourceId,
    [...new Set(ranks)].sort((left, right) => left - right),
  ]));
}

function promotedSourceDefinition(source) {
  const shared = {
    sourceId: source.sourceId,
    displayTitle: source.title,
    sourceType: source.sourceType,
    sourceUrl: source.url,
    sourceFile: source.sourceId === "owner-actor-supplement-2026-07"
      ? "data/people/actor-owner-supplement.json"
      : "tools/people-seed/.work/actor-owner-supplement-review/source-snapshots/preceding-comparison-evidence.json",
    publicationOrSnapshotYear: 2026,
    retrievalTimestamp: SOURCE_RETRIEVAL_TIMESTAMP,
    sourceHash: source.hash === null ? null : source.hash,
  };
  const details = {
    "ranker-current-famous-actors-2026": {
      extractionMethod: "Preserved the complete directly retrieved current-famous actor list from the July 18, 2026 comparison; retained ranks are provenance only.",
      completenessStatement: "The complete compared Ranker list was directly retrieved; the 25 owner-selected supplement occurrences retain captured ranks.",
      knownLimitations: ["Dynamic user-voted current-fame list; rank is provenance, not acting quality or final Nuvio order."],
      rankingDynamicWarning: "Dynamic user-voted list; ranks can change after the captured July 18, 2026 snapshot.",
    },
    "imdb-actor-list-ls548798415": {
      extractionMethod: "Preserved the directly retrieved IMDb user-list comparison as discovery provenance; no individual rank was fabricated where the local comparison evidence did not retain one.",
      completenessStatement: "The complete compared IMDb list was directly retrieved during the owner comparison.",
      knownLimitations: ["IMDb user list; its selection and ordering are not objective measures of acting quality."],
      rankingDynamicWarning: null,
    },
    "imdb-popular-celebrities-ls052283250": {
      extractionMethod: "Preserved the directly retrieved IMDb popular-celebrities comparison as discovery provenance; no individual rank was fabricated where the local comparison evidence did not retain one.",
      completenessStatement: "The complete compared IMDb list was directly retrieved during the owner comparison.",
      knownLimitations: ["IMDb user list; popularity and editorial selection are not objective measures of acting quality."],
      rankingDynamicWarning: null,
    },
    "imdb-starmeter-2026-07-18": {
      extractionMethod: "Preserved the July 18, 2026 STARmeter snapshot and only the individual ranks retained with confidence in the approved comparison evidence.",
      completenessStatement: "The complete 100-person STARmeter chart was directly retrieved; 45 owner-approved actor occurrences are represented and ranks remain null where not safely retained.",
      knownLimitations: ["STARmeter is a volatile weekly popularity snapshot.", "Weekly rank does not establish durable acting importance, quality, or final rollout priority."],
      rankingDynamicWarning: "Volatile weekly snapshot captured July 18, 2026; ranks can change each week.",
    },
    "wikipedia-highest-grossing-actors-2026": {
      extractionMethod: "Preserved the directly retrieved commercial-table comparison as context only; director-only and unapproved entries were excluded.",
      completenessStatement: "The relevant comparison tables were directly retrieved during the owner review.",
      knownLimitations: ["Commercial gross is not acting quality and depends on table methodology, franchise participation, inflation, market coverage, and credit scope."],
      rankingDynamicWarning: "Commercial totals and table methodology can change over time.",
    },
    "filmaholic-top100-actors-2026": {
      extractionMethod: "Direct rendered access was Cloudflare-blocked; the complete exact page was obtained through a recent search-engine crawl and the captured ranks were preserved for the 64 owner-selected occurrences.",
      completenessStatement: "The complete top-100 list was available through the recent crawl of the exact page, not through direct rendered access.",
      knownLimitations: ["Direct rendered access was Cloudflare-blocked.", "The source was weighted conservatively because it was recovered through a search-engine crawl.", "Owner inclusion decisions, rather than this source alone, govern promotion.", "Ranks are provenance, not acting quality."],
      rankingDynamicWarning: null,
    },
    "owner-actor-supplement-2026-07": {
      extractionMethod: "Recorded the explicit owner decision after the bounded cross-source comparison and metadata-only identity resolution.",
      completenessStatement: "All 198 additions were explicitly approved for inclusion; the proposed split of 95 initial and 103 later actors was subsequently approved with zero review additions.",
      knownLimitations: ["Inclusion and rollout are owner catalogue decisions, not an objective ranking of performers."],
      rankingDynamicWarning: null,
    },
  }[source.sourceId];
  assert(details, `Unsupported approved supplement source ${source.sourceId}.`);
  return { ...shared, ...details };
}

export function prepareTrackedActorSupplement({ approvedDraft, approvedSources, approvedEvidenceHash }) {
  assert(approvedEvidenceHash === APPROVED_EVIDENCE_SHA256, "Approved actor supplement evidence hash changed.");
  const records = approvedDraft.records.map((record) => {
    assert(record.identityStatus === "resolved", `${record.suppliedName}: unresolved identity cannot be promoted.`);
    assert(["initial", "later"].includes(record.proposedRolloutTier), `${record.suppliedName}: rollout tier is not approved.`);
    const sourceMemberships = record.sourceOccurrences.map((membership) => {
      const promoted = {
        sourceId: membership.sourceId,
        sourceRank: membership.sourceRank,
        sourceName: membership.sourceName,
      };
      if (membership.comparisonGroup !== undefined) promoted.comparisonGroup = membership.comparisonGroup;
      if (membership.ownerDecision !== undefined) promoted.ownerDecision = "include";
      return promoted;
    }).sort(supplementMembershipComparator);
    return {
      suppliedName: record.suppliedName,
      canonicalName: record.canonicalName,
      stableKey: record.stableKey,
      tmdbPersonId: record.tmdbPersonId,
      alsoKnownAs: [...record.alsoKnownAs],
      knownForDepartment: record.knownForDepartment,
      profilePath: record.profilePath,
      actorCreditCount: record.actorCreditCount,
      directorCreditCount: record.directorCreditCount,
      activityYearRange: { ...record.activityYearRange },
      rolloutTier: record.proposedRolloutTier,
      recommendedAction: record.proposedRolloutTier === "initial" ? "include-initial" : "include-later",
      ownerInclusionDecision: "include",
      ownerTierDecision: record.proposedRolloutTier,
      sourceGroups: [...record.sourceGroups],
      sourceMemberships,
      identityStatus: "resolved",
      identityConfidence: record.identityConfidence,
      identityEvidence: [...record.exactMatchEvidence],
      specialtyPlanningTags: [...record.specialtyTags],
      provenanceReference: "data/people/sources.json#owner-actor-supplement-2026-07",
    };
  }).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const sources = approvedSources.sources.map(promotedSourceDefinition).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    version: "actor-owner-supplement-v1",
    promotedAt: PROMOTION_TIMESTAMP,
    status: "owner-approved",
    ordering: "tmdb-person-id-ascending",
    recordCount: records.length,
    tierDistribution: { initial: 95, later: 103, review: 0 },
    approvedEvidence: {
      path: APPROVED_EVIDENCE_PATH,
      sha256: approvedEvidenceHash,
      reviewedAt: PROMOTION_TIMESTAMP,
      identityBlockerCount: 0,
      decision: "All resolved identities, canonical normalisations, catalogue inclusions, and proposed initial/later tiers approved by the owner.",
    },
    sourceCount: sources.length,
    sources,
    records,
  };
}

export function validateActorSupplement(supplement, schema = null) {
  const errors = [];
  if (schema) errors.push(...validateAgainstSchema(supplement, schema, "actor-owner-supplement.json"));
  addIf(errors, supplement.recordCount === supplement.records.length, "supplement recordCount must equal records length");
  addIf(errors, supplement.records.length === ACTOR_SUPPLEMENT_COUNTS.records, "supplement must contain exactly 198 records");
  addIf(errors, supplement.sourceCount === supplement.sources.length, "supplement sourceCount must equal sources length");
  addIf(errors, supplement.sources.length === ACTOR_SUPPLEMENT_COUNTS.sourceDefinitions, "supplement must contain seven source definitions");
  addIf(errors, sameJson(supplement.sources.map((source) => source.sourceId), ACTOR_SUPPLEMENT_SOURCE_IDS), "supplement sources must use approved deterministic source-ID ordering");
  addIf(errors, supplement.approvedEvidence.sha256 === APPROVED_EVIDENCE_SHA256, "supplement evidence hash must match the approved identity package");
  addIf(errors, supplement.approvedEvidence.identityBlockerCount === 0, "supplement must have zero identity blockers");

  const ids = supplement.records.map((record) => record.tmdbPersonId);
  const keys = supplement.records.map((record) => record.stableKey);
  const suppliedNames = supplement.records.map((record) => normalisePersonName(record.suppliedName));
  addIf(errors, new Set(ids).size === ids.length, "supplement must not duplicate TMDB person IDs");
  addIf(errors, new Set(keys).size === keys.length, "supplement must not duplicate stable keys");
  addIf(errors, new Set(suppliedNames).size === suppliedNames.length, "supplement must not duplicate normalized supplied names");
  addIf(errors, ids.every((id, index) => index === 0 || ids[index - 1] < id), "supplement must use numeric TMDB-ID ordering");
  addIf(errors, sameJson(countBy(supplement.records, (record) => record.rolloutTier), { initial: 95, later: 103 }), "supplement tier counts must be 95 initial and 103 later");
  addIf(errors, sameJson(supplement.tierDistribution, { initial: 95, later: 103, review: 0 }), "supplement tierDistribution must record zero review additions");
  addIf(errors, sameJson(countBy(supplement.records, (record) => record.sourceGroups[0]), GROUP_COUNTS), "supplement source-group counts must remain 64/25/64/32/13");

  const declaredSources = new Set(supplement.sources.map((source) => source.sourceId));
  const memberships = supplement.records.flatMap((record) => record.sourceMemberships);
  addIf(errors, memberships.length === ACTOR_SUPPLEMENT_COUNTS.sourceMemberships, "supplement must preserve exactly 332 source memberships");
  addIf(errors, memberships.every((membership) => declaredSources.has(membership.sourceId)), "supplement source memberships must reference declared sources");
  for (const record of supplement.records) {
    addIf(errors, record.stableKey === `person:${record.tmdbPersonId}`, `${record.suppliedName}: stable key must match TMDB person ID`);
    addIf(errors, record.identityStatus === "resolved", `${record.suppliedName}: identity must be resolved`);
    addIf(errors, record.ownerInclusionDecision === "include", `${record.suppliedName}: owner inclusion must be approved`);
    addIf(errors, record.ownerTierDecision === record.rolloutTier, `${record.suppliedName}: owner tier approval must match rollout tier`);
    addIf(errors, record.recommendedAction === (record.rolloutTier === "initial" ? "include-initial" : "include-later"), `${record.suppliedName}: recommendation must match approved tier`);
    addIf(errors, record.sourceMemberships.some((membership) => membership.sourceId === "owner-actor-supplement-2026-07" && membership.ownerDecision === "include"), `${record.suppliedName}: owner source membership is missing`);
    addIf(errors, sameJson(record.sourceMemberships, [...record.sourceMemberships].sort(supplementMembershipComparator)), `${record.suppliedName}: source memberships are not deterministically ordered`);
  }
  for (const [suppliedName, canonicalName] of Object.entries(APPROVED_CANONICAL_DIFFERENCES)) {
    const record = supplement.records.find((item) => item.suppliedName === suppliedName);
    addIf(errors, Boolean(record), `${suppliedName}: approved canonical-name difference is missing`);
    if (record) {
      addIf(errors, record.canonicalName === canonicalName, `${suppliedName}: approved canonical name changed`);
      addIf(errors, record.alsoKnownAs.includes(suppliedName), `${suppliedName}: owner-supplied spelling must be retained as an alias`);
    }
  }
  return {
    errors,
    summary: {
      recordCount: supplement.records.length,
      tierDistribution: countBy(supplement.records, (record) => record.rolloutTier),
      sourceGroupCounts: countBy(supplement.records, (record) => record.sourceGroups[0]),
      sourceMembershipCount: memberships.length,
      sourceCount: supplement.sources.length,
    },
  };
}

export function mergeActorSupplementFoundation({ registry, actors, directors, sources, supplement }) {
  const validation = validateActorSupplement(supplement);
  assert(validation.errors.length === 0, `Actor supplement is invalid:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  const supplementIds = new Set(supplement.records.map((record) => record.tmdbPersonId));
  const supplementSourceIds = new Set(supplement.sources.map((source) => source.sourceId));

  const baseRegistryRecords = registry.records.filter((record) => !supplementIds.has(record.tmdbPersonId));
  const baseActorRecords = actors.records.filter((record) => !supplementIds.has(record.tmdbPersonId));
  const baseSources = sources.sources.filter((source) => !supplementSourceIds.has(source.sourceId));
  assert(baseRegistryRecords.length === 619, `Promotion base registry must contain 619 identities, found ${baseRegistryRecords.length}.`);
  assert(baseActorRecords.length === 325, `Promotion base actor seed must contain 325 memberships, found ${baseActorRecords.length}.`);
  assert(directors.records.length === 300, `Director seed must remain 300 memberships, found ${directors.records.length}.`);
  assert(baseSources.length === 6, `Promotion base source registry must contain six records, found ${baseSources.length}.`);
  const baseRegistryIds = new Set(baseRegistryRecords.map((record) => record.tmdbPersonId));
  const baseActorIds = new Set(baseActorRecords.map((record) => record.tmdbPersonId));
  assert(supplement.records.every((record) => !baseRegistryIds.has(record.tmdbPersonId)), "Supplement overlaps the original people registry.");
  assert(supplement.records.every((record) => !baseActorIds.has(record.tmdbPersonId)), "Supplement overlaps the original actor seed.");

  const registryAdditions = supplement.records.map((record) => ({
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    alsoKnownAs: [...record.alsoKnownAs],
    knownForDepartment: record.knownForDepartment,
    profilePath: record.profilePath,
    actorCreditCount: record.actorCreditCount,
    directorCreditCount: record.directorCreditCount,
    activityYearRange: { ...record.activityYearRange },
    categoryMembership: ["actor"],
    identityConfidence: record.identityConfidence,
    identityEvidence: [...record.identityEvidence],
    sourceMemberships: record.sourceMemberships.map((membership) => ({ ...membership })).sort(supplementMembershipComparator),
    reviewStatus: "candidate",
  }));
  const actorAdditions = supplement.records.map((record) => ({
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    category: "actor",
    rolloutTier: record.rolloutTier,
    selectionBasis: ["owner-added"],
    sourceRanks: sourceRanks(record.sourceMemberships),
    recommendedAction: record.recommendedAction,
    selectionStatus: "owner-decided",
    ownerDecision: "include",
    ownerNote: "",
  }));
  const registryRecords = [...baseRegistryRecords, ...registryAdditions].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const actorRecords = [...baseActorRecords, ...actorAdditions].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  const sourceRecords = [...baseSources, ...supplement.sources].sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  return {
    registry: {
      ...registry,
      generatedAt: supplement.promotedAt,
      recordCount: registryRecords.length,
      sourceMembershipCount: registryRecords.reduce((sum, record) => sum + record.sourceMemberships.length, 0),
      sourceMembershipFingerprint: fingerprint(registryRecords),
      records: registryRecords,
    },
    actors: {
      ...actors,
      generatedAt: supplement.promotedAt,
      recordCount: actorRecords.length,
      records: actorRecords,
    },
    directors: {
      ...directors,
      generatedAt: supplement.promotedAt,
      records: directors.records,
    },
    sources: {
      ...sources,
      generatedAt: supplement.promotedAt,
      sourceCount: sourceRecords.length,
      sources: sourceRecords,
    },
  };
}

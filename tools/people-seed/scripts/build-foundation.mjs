#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sourceMembershipFingerprint, validatePeopleFoundation } from "../src/people-validation.mjs";
import { mergeActorSupplementFoundation } from "../src/actor-supplement-promotion.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const buildRoot = path.join(packageRoot, ".work", "people-seed-build");
const dataRoot = path.join(repoRoot, "data", "people");
const reviewRoot = path.join(packageRoot, ".work", "people-seed-foundation", "owner-review");

const paths = {
  registryDraft: path.join(buildRoot, "drafts", "people-registry.draft.json"),
  actorsDraft: path.join(buildRoot, "drafts", "actors-seed.draft.json"),
  directorsDraft: path.join(buildRoot, "drafts", "directors-seed.draft.json"),
  summary: path.join(buildRoot, "reports", "summary.json"),
  actorCandidates: path.join(buildRoot, "reports", "actor-candidates.json"),
  directorCandidates: path.join(buildRoot, "reports", "director-candidates.json"),
  actorOverlap: path.join(buildRoot, "reports", "actor-source-overlap.json"),
  directorOverlap: path.join(buildRoot, "reports", "director-source-overlap.json"),
  shared: path.join(buildRoot, "reports", "shared-actor-director-people.json"),
  sourceInventory: path.join(buildRoot, "inputs", "source-inventory.json"),
  actorDecisions: path.join(buildRoot, "owner-review", "actor-decisions.csv"),
  directorDecisions: path.join(buildRoot, "owner-review", "director-decisions.csv"),
  imkEvidence: path.join(packageRoot, "..", "studio-network-batch", ".work", "imkaptain-identity-comparison", "reports", "external-files-accessed.json"),
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeMembership(membership) {
  const normalized = {
    sourceId: membership.sourceId,
    sourceRank: membership.sourceRank,
    sourceName: membership.sourceName,
  };
  if (membership.sourceRowType !== undefined) normalized.sourceRowType = membership.sourceRowType;
  if (membership.sourceOntologyId !== undefined) normalized.sourceOntologyId = membership.sourceOntologyId;
  if (membership.catalogIds !== undefined) normalized.secondaryCatalogIds = [...membership.catalogIds];
  if (membership.identityStatus !== undefined) normalized.identityStatus = membership.identityStatus;
  return normalized;
}

function membershipComparator(left, right) {
  return left.sourceId.localeCompare(right.sourceId)
    || (left.sourceRank ?? Number.MAX_SAFE_INTEGER) - (right.sourceRank ?? Number.MAX_SAFE_INTEGER)
    || left.sourceName.localeCompare(right.sourceName)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function categoryMemberships(record, category) {
  const allowed = category === "actor"
    ? new Set(["imkaptain-actors", "ranker-actors"])
    : new Set(["imkaptain-directors", "tspdt-21c-directors", "tspdt-directors"]);
  return record.sourceMemberships.filter((membership) => allowed.has(membership.sourceId));
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

const basisOrder = [
  "ranker-core",
  "tspdt-all-time",
  "tspdt-21st-century",
  "cross-source",
  "external-supplement",
  "modern-supplement",
  "owner-added",
];

function selectionBasis(category, memberships) {
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
  return basis.sort((left, right) => basisOrder.indexOf(left) - basisOrder.indexOf(right));
}

function rolloutTier(recommendedAction) {
  return {
    "include-initial": "initial",
    "include-later": "later",
    "manual-selection-review": "review",
  }[recommendedAction];
}

function categoryDocument(draft, registryById) {
  const records = draft.records.map((draftRecord) => {
    const registryRecord = registryById.get(draftRecord.tmdbPersonId);
    assert(registryRecord, `Category draft references missing registry person ${draftRecord.tmdbPersonId}.`);
    const memberships = categoryMemberships(registryRecord, draft.category);
    return {
      stableKey: draftRecord.stableKey,
      tmdbPersonId: draftRecord.tmdbPersonId,
      canonicalName: draftRecord.canonicalName,
      category: draft.category,
      rolloutTier: rolloutTier(draftRecord.recommendedAction),
      selectionBasis: selectionBasis(draft.category, memberships),
      sourceRanks: sourceRanks(memberships),
      recommendedAction: draftRecord.recommendedAction,
      selectionStatus: "proposed",
      ownerDecision: null,
      ownerNote: "",
    };
  }).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  return {
    version: "people-seed-v1",
    generatedAt: draft.generatedAt,
    status: "proposed-candidate-rollout",
    category: draft.category,
    ordering: "tmdb-person-id-ascending",
    recordCount: records.length,
    records,
  };
}

function registryDocument(draft) {
  const records = draft.records.map((record) => ({
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    alsoKnownAs: [...record.alsoKnownAs],
    knownForDepartment: record.knownForDepartment,
    profilePath: record.profilePath,
    actorCreditCount: record.actorCreditCount,
    directorCreditCount: record.directorCreditCount,
    activityYearRange: { ...record.activityYearRange },
    categoryMembership: ["actor", "director"].filter((category) => record.categoryMembership.includes(category)),
    identityConfidence: record.identityConfidence,
    identityEvidence: [...record.identityEvidence],
    sourceMemberships: record.sourceMemberships.map(normalizeMembership).sort(membershipComparator),
    reviewStatus: "candidate",
  })).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  return {
    version: "people-registry-v1",
    generatedAt: draft.generatedAt,
    status: "candidate-identities",
    ordering: "tmdb-person-id-ascending",
    recordCount: records.length,
    sourceMembershipCount: records.reduce((total, record) => total + record.sourceMemberships.length, 0),
    sourceMembershipFingerprint: sourceMembershipFingerprint(records),
    records,
  };
}

function sourceHash(value, scope) {
  return { algorithm: "sha256", value, scope };
}

function sourceDocument({ generatedAt, sourceInventory, imkEvidence, registryDraftHash }) {
  const retrieved = new Map(sourceInventory.retrievedSources.map((source) => [source.sourceId, source]));
  const resources = new Map(imkEvidence.resources.filter((resource) => resource.role).map((resource) => [resource.role, resource]));
  const ranker = retrieved.get("ranker-actors");
  const tspdtAllTime = retrieved.get("tspdt-directors");
  const tspdt21c = retrieved.get("tspdt-21c-directors");
  const imkActorResource = resources.get("actors");
  const imkDirectorResource = resources.get("directors");
  const commit = imkEvidence.externalRepository.commit;
  const sources = [
    {
      sourceId: "imkaptain-actors",
      displayTitle: "ImKaptain actor identity cross-check",
      sourceType: "external-catalog-cross-check",
      sourceUrl: `https://raw.githubusercontent.com/ImKaptain/nuvio-assets/${commit}/nuvio-share-hub/collections/actors.json`,
      sourceFile: "tools/studio-network-batch/.work/imkaptain-identity-comparison/external-inputs/actors.json",
      publicationOrSnapshotYear: 2026,
      retrievalTimestamp: imkEvidence.generatedAt,
      sourceHash: sourceHash(imkActorResource.sha256, "complete pinned actors.json response"),
      extractionMethod: "Read 58 explicit TMDB person IDs from the validated text-only identity inventory; artwork fields were excluded.",
      completenessStatement: "All 58 actor identity records in the pinned cross-check file are represented as source memberships.",
      knownLimitations: ["Cross-check source only; absence from Ranker does not imply final Nuvio inclusion."],
      rankingDynamicWarning: null,
    },
    {
      sourceId: "imkaptain-directors",
      displayTitle: "ImKaptain director catalogue cross-check",
      sourceType: "external-catalog-cross-check",
      sourceUrl: `https://raw.githubusercontent.com/ImKaptain/nuvio-assets/${commit}/nuvio-share-hub/collections/legendary_directors.json`,
      sourceFile: "tools/studio-network-batch/.work/imkaptain-identity-comparison/external-inputs/legendary_directors.json",
      publicationOrSnapshotYear: 2026,
      retrievalTimestamp: imkEvidence.generatedAt,
      sourceHash: sourceHash(imkDirectorResource.sha256, "complete pinned legendary_directors.json response"),
      extractionMethod: "Retained 20 MDBList catalogue references as secondary provenance and resolved people independently through TMDB metadata.",
      completenessStatement: "All 20 director catalogue records in the pinned cross-check file are represented as source memberships.",
      knownLimitations: ["MDBList catalogue IDs identify source catalogues, not TMDB people, and must never be used as TMDB person IDs."],
      rankingDynamicWarning: null,
    },
    {
      sourceId: "ranker-actors",
      displayTitle: ranker.title,
      sourceType: "dynamic-user-ranking",
      sourceUrl: ranker.url,
      sourceFile: "tools/people-seed/.work/people-seed-build/inputs/ranker-source-snapshot.json",
      publicationOrSnapshotYear: 2025,
      retrievalTimestamp: ranker.retrievedAt,
      sourceHash: sourceHash(sourceInventory.rankerPageSnapshots[0].responseDataHash, "Ranker list-items JSON response data"),
      extractionMethod: "Extracted the complete requested rank boundary 1-300 from Ranker's text JSON list-items endpoint, retaining source names, ranks, and ontology IDs.",
      completenessStatement: "Every Ranker source rank from 1 through 300 is represented exactly once.",
      knownLimitations: ["Dynamic user-voted ranking with plausible English-language popularity bias; source rank is provenance, not objective quality."],
      rankingDynamicWarning: "Dynamic user-voted list; ranks can change after the captured snapshot.",
    },
    {
      sourceId: "tmdb-identity-resolution",
      displayTitle: "TMDB person identity-resolution metadata",
      sourceType: "identity-metadata",
      sourceUrl: "https://developer.themoviedb.org/reference/person-details",
      sourceFile: "tools/people-seed/.work/people-seed-build/drafts/people-registry.draft.json",
      publicationOrSnapshotYear: 2026,
      retrievalTimestamp: generatedAt,
      sourceHash: sourceHash(registryDraftHash, "completed resolved people registry draft"),
      extractionMethod: "Resolved names through cached TMDB person search, details, alternate names, combined credits, and relative profile-path metadata; the promotion made no network requests.",
      completenessStatement: "All 619 candidate identities are exact explicit-ID or high-confidence name-and-career matches; zero ambiguous, unresolved, or not-found identities entered the registry.",
      knownLimitations: ["Profile paths and career metadata are snapshot metadata and may change in future TMDB data; no profile image was downloaded."],
      rankingDynamicWarning: null,
    },
    {
      sourceId: "tspdt-21c-directors",
      displayTitle: tspdt21c.title,
      sourceType: "critical-aggregation-ranking",
      sourceUrl: tspdt21c.url,
      sourceFile: null,
      publicationOrSnapshotYear: tspdt21c.edition,
      retrievalTimestamp: tspdt21c.retrievedAt,
      sourceHash: sourceHash(sourceInventory.tspdtContentHashes.centuryContentHash, "retrieved TSPDT 21st-century ranking HTML"),
      extractionMethod: "Extracted ranks 1-100 and expanded two directing-team rows to 102 person memberships while preserving the original rank and team spelling.",
      completenessStatement: "All 100 ranking rows and all 102 expanded person occurrences are represented.",
      knownLimitations: ["Bounded modern-supplement evidence; the ranking is a source aggregation, not an objective truth or final Nuvio order."],
      rankingDynamicWarning: "Edition-specific source ranking; source rank does not establish final Nuvio ordering.",
    },
    {
      sourceId: "tspdt-directors",
      displayTitle: tspdtAllTime.title,
      sourceType: "critical-aggregation-ranking",
      sourceUrl: tspdtAllTime.url,
      sourceFile: null,
      publicationOrSnapshotYear: tspdtAllTime.edition,
      retrievalTimestamp: tspdtAllTime.retrievedAt,
      sourceHash: sourceHash(sourceInventory.tspdtContentHashes.allTimeContentHash, "retrieved TSPDT all-time ranking HTML"),
      extractionMethod: "Extracted ranks 1-250 and expanded seven directing-team rows to 257 person occurrences while preserving original ranks and team spelling.",
      completenessStatement: "All 250 ranking rows and all 257 expanded person occurrences are represented.",
      knownLimitations: ["Critical-list aggregation, not objective truth; source rank does not determine final Nuvio inclusion or ordering."],
      rankingDynamicWarning: "Edition-specific source ranking; source rank does not establish final Nuvio ordering.",
    },
  ].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    version: "people-sources-v1",
    generatedAt,
    ordering: "source-id-ascending",
    sourceCount: sources.length,
    sources,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function reviewTemplate(categoryDocumentValue, registryById) {
  const header = [
    "stable_key",
    "canonical_name",
    "tmdb_person_id",
    "selection_basis",
    "source_memberships",
    "recommended_action",
    "owner_decision",
    "owner_note",
  ];
  const rows = categoryDocumentValue.records.filter((record) => record.rolloutTier === "review").map((record) => {
    const registryRecord = registryById.get(record.tmdbPersonId);
    return [
      record.stableKey,
      record.canonicalName,
      record.tmdbPersonId,
      JSON.stringify(record.selectionBasis),
      JSON.stringify(categoryMemberships(registryRecord, record.category)),
      record.recommendedAction,
      "",
      "",
    ];
  });
  return csv([header, ...rows]);
}

function rolloutSummary(actors, directors) {
  const header = ["category", "rollout_tier", "membership_count", "recommended_action", "selection_status"];
  const rows = [];
  for (const document of [actors, directors]) {
    for (const [tier, action] of [["initial", "include-initial"], ["later", "include-later"], ["review", "manual-selection-review"]]) {
      rows.push([document.category, tier, document.records.filter((record) => record.rolloutTier === tier).length, action, "proposed"]);
    }
  }
  return csv([header, ...rows]);
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function main() {
  const [
    registryDraftRaw,
    registryDraft,
    actorsDraft,
    directorsDraft,
    summary,
    actorCandidates,
    directorCandidates,
    actorOverlap,
    directorOverlap,
    shared,
    sourceInventory,
    actorDecisions,
    directorDecisions,
    imkEvidence,
    registrySchema,
    seedSchema,
    sourcesSchema,
    supplement,
    supplementSchema,
  ] = await Promise.all([
    fs.readFile(paths.registryDraft),
    readJson(paths.registryDraft),
    readJson(paths.actorsDraft),
    readJson(paths.directorsDraft),
    readJson(paths.summary),
    readJson(paths.actorCandidates),
    readJson(paths.directorCandidates),
    readJson(paths.actorOverlap),
    readJson(paths.directorOverlap),
    readJson(paths.shared),
    readJson(paths.sourceInventory),
    fs.readFile(paths.actorDecisions, "utf8"),
    fs.readFile(paths.directorDecisions, "utf8"),
    readJson(paths.imkEvidence),
    readJson(path.join(repoRoot, "schemas", "people-registry.schema.json")),
    readJson(path.join(repoRoot, "schemas", "people-seed.schema.json")),
    readJson(path.join(repoRoot, "schemas", "people-sources.schema.json")),
    readJson(path.join(dataRoot, "actor-owner-supplement.json")),
    readJson(path.join(repoRoot, "schemas", "actor-owner-supplement.schema.json")),
  ]);

  assert(summary.registryCount === 619, "Completed summary registry count changed.");
  assert(summary.coverage.actor.candidateCount === 325 && actorCandidates.length === 325, "Actor candidate evidence changed.");
  assert(summary.coverage.director.candidateCount === 300 && directorCandidates.length === 300, "Director candidate evidence changed.");
  assert(actorOverlap.length === 33, "Actor overlap evidence changed.");
  assert(directorOverlap.length === 67, "Director overlap evidence changed; this report includes Michael Powell's repeated same-source occurrence.");
  assert(shared.length === 6, "Shared actor/director evidence changed.");
  assert(actorDecisions.trim().split(/\r?\n/).length === 326 && actorDecisions.trim().split(/\r?\n/).slice(1).every((line) => line.endsWith(",,")), "Actor owner-decision draft must remain blank and complete.");
  assert(directorDecisions.trim().split(/\r?\n/).length === 301 && directorDecisions.trim().split(/\r?\n/).slice(1).every((line) => line.endsWith(",,")), "Director owner-decision draft must remain blank and complete.");

  const baseRegistry = registryDocument(registryDraft);
  const baseRegistryById = new Map(baseRegistry.records.map((record) => [record.tmdbPersonId, record]));
  const baseActors = categoryDocument(actorsDraft, baseRegistryById);
  const baseDirectors = categoryDocument(directorsDraft, baseRegistryById);
  const baseSources = sourceDocument({
    generatedAt: baseRegistry.generatedAt,
    sourceInventory,
    imkEvidence,
    registryDraftHash: sha256(registryDraftRaw),
  });
  const { registry, actors, directors, sources } = mergeActorSupplementFoundation({
    registry: baseRegistry,
    actors: baseActors,
    directors: baseDirectors,
    sources: baseSources,
    supplement,
  });
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));

  const validation = validatePeopleFoundation({
    registry,
    actors,
    directors,
    sources,
    supplement,
    schemas: { registry: registrySchema, seed: seedSchema, sources: sourcesSchema, supplement: supplementSchema },
  });
  if (validation.errors.length) throw new Error(`Generated foundation failed validation:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);

  await Promise.all([
    atomicWrite(path.join(dataRoot, "people-registry.json"), `${JSON.stringify(registry, null, 2)}\n`),
    atomicWrite(path.join(dataRoot, "actors-seed.json"), `${JSON.stringify(actors, null, 2)}\n`),
    atomicWrite(path.join(dataRoot, "directors-seed.json"), `${JSON.stringify(directors, null, 2)}\n`),
    atomicWrite(path.join(dataRoot, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`),
    atomicWrite(path.join(reviewRoot, "actor-supplement-decisions.csv"), reviewTemplate(actors, registryById)),
    atomicWrite(path.join(reviewRoot, "director-supplement-decisions.csv"), reviewTemplate(directors, registryById)),
    atomicWrite(path.join(reviewRoot, "rollout-summary.csv"), rolloutSummary(actors, directors)),
  ]);

  process.stdout.write(`${JSON.stringify({
    valid: true,
    networkRequests: 0,
    artworkDownloaded: 0,
    artworkGenerated: 0,
    peopleAssetsPublished: 0,
    peopleArtworkManifestsCreated: 0,
    ...validation.summary,
    reviewTemplates: {
      actorRows: actors.records.filter((record) => record.rolloutTier === "review").length,
      directorRows: directors.records.filter((record) => record.rolloutTier === "review").length,
      outputRoot: path.relative(repoRoot, reviewRoot).replaceAll("\\", "/"),
    },
  }, null, 2)}\n`);
}

await main();

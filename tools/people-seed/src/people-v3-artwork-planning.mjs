import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "./people-publication.mjs";
import { assertPeopleV3ProofPath } from "./people-artwork/title-logo.mjs";

export const PEOPLE_V3_FULL_GENERATION_PLAN_VERSION = "people-v3-full-generation-plan-v1";
export const PEOPLE_V3_ATOMIC_PUBLICATION_PLAN_VERSION = "people-v3-atomic-publication-plan-v1";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function mean(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function planFingerprint(plan) {
  const { generatedAt: _generatedAt, planFingerprint: _planFingerprint, ...payload } = plan;
  return sha256(stableStringify(payload));
}

export function buildPeopleV3FullGenerationPlan({ audit, registry, titleLogoMetadata, portraitMetadata, presentationCandidateByteCount, generatedAt } = {}) {
  assert(audit?.recordCount === 663 && registry?.records?.length === 1480, "Full-generation plan requires the exact reconciled v3 catalogue and artwork delta.");
  const deltaIds = audit.records.map((record) => record.tmdbPersonId);
  const acquisitionIds = audit.records.filter((record) => record.sourceAcquisitionRequired).map((record) => record.tmdbPersonId);
  const fallbackIds = audit.records.filter((record) => record.fallbackCandidate).map((record) => record.tmdbPersonId);
  const preserveIds = [...new Set(audit.protectedState.people.records
    .map((record) => /\/(?:landscape|poster)\/([1-9][0-9]*)\.webp$/u.exec(record.path)?.[1])
    .filter(Boolean)
    .map(Number))].sort((left, right) => left - right);
  const titleLogoIds = registry.records.map((record) => record.tmdbPersonId);
  const landscapeBytes = portraitMetadata.records.filter((record) => record.formatId === "landscape").map((record) => record.byteCount);
  const posterBytes = portraitMetadata.records.filter((record) => record.formatId === "poster").map((record) => record.byteCount);
  const titleBytes = titleLogoMetadata.records.map((record) => record.byteCount);
  const estimates = {
    basis: "representative-proof-median-for-portraits-and-mean-for-title-logos",
    landscapeMedianBytes: median(landscapeBytes),
    posterMedianBytes: median(posterBytes),
    titleLogoMeanBytes: mean(titleBytes),
    presentationManifestEstimatedBytes: Math.round(presentationCandidateByteCount / titleLogoMetadata.recordCount * registry.records.length),
  };
  estimates.newLandscapeBytes = estimates.landscapeMedianBytes * deltaIds.length;
  estimates.newPosterBytes = estimates.posterMedianBytes * deltaIds.length;
  estimates.titleLogoBytes = estimates.titleLogoMeanBytes * titleLogoIds.length;
  estimates.totalEstimatedStorageGrowthBytes = estimates.newLandscapeBytes + estimates.newPosterBytes + estimates.titleLogoBytes + estimates.presentationManifestEstimatedBytes;
  const plan = {
    version: PEOPLE_V3_FULL_GENERATION_PLAN_VERSION,
    generatedAt,
    status: "awaiting-owner-proof-approval",
    ordering: "tmdb-person-id-ascending",
    exactScope: {
      catalogueOnlyPersonIds: deltaIds,
      portraitAcquisitionPersonIds: acquisitionIds,
      fallbackOrInvestigationPersonIds: fallbackIds,
      newPosterOutputPersonIds: deltaIds,
      newLandscapeOutputPersonIds: deltaIds,
      titleLogoPersonIds: titleLogoIds,
      preservePublishedPersonIds: preserveIds,
      categoryMetadataRefreshes: audit.reconciliation.categoryMetadataChanges,
    },
    counts: {
      catalogueOnlyPeople: deltaIds.length,
      sourcesRequiringAcquisition: acquisitionIds.length,
      fallbackOrInvestigationPeople: fallbackIds.length,
      newPosterFiles: deltaIds.length,
      newLandscapeFiles: deltaIds.length,
      newTitleLogoFiles: titleLogoIds.length,
      publicPresentationManifestFiles: 1,
      totalNewPublicFiles: deltaIds.length * 2 + titleLogoIds.length + 1,
      existingPortraitFilesPreserved: preserveIds.length * 2,
      existingPeopleWithCategoryOnlyRefresh: audit.reconciliation.categoryMetadataChanges.length,
    },
    expectedPublicState: {
      peopleLandscapeWebps: 1480,
      peoplePosterWebps: 1480,
      peopleTitleLogoPngs: 1480,
      sharedExistingHeroJpgs: 1,
      missingPublishedPersonIdentities: 0,
      runtime: audit.futureRuntimeCounts,
    },
    candidateChanges: {
      peopleManifest: { addRecords: deltaIds.length, updateExistingCategoryRecords: audit.reconciliation.categoryMetadataChanges.map((record) => record.tmdbPersonId), finalRecordCount: 1480 },
      runtimeLookup: { addPeople: deltaIds.length, updateExistingPeopleCategories: audit.reconciliation.categoryMetadataChanges.map((record) => record.tmdbPersonId), finalPeopleCount: 1480 },
      presentationManifest: { create: true, finalRecordCount: 1480, sharedHeroRepresentedOnce: true },
    },
    sharedHeroValidation: audit.sharedHero,
    storageEstimate: estimates,
    reviewPagination: {
      portraitIdentitiesPerPage: 64,
      portraitPages: Math.ceil(deltaIds.length / 64),
      titleLogoIdentitiesPerPage: 32,
      titleLogoPages: Math.ceil(titleLogoIds.length / 32),
      fallbackInvestigationIdentitiesPerPage: 32,
      fallbackInvestigationPages: Math.ceil(fallbackIds.length / 32),
    },
    fallbackAndExceptionPolicy: {
      sourcePolicy: "exact tracked TMDB profilePath only",
      noProfilePath: "owner investigation or already-approved text fallback in a separately authorised run",
      invalidSource: "stop that identity; do not substitute another image",
      cropOverride: "exact person ID plus source hash binding; stale bindings return to review",
      automaticFallbackPublication: false,
    },
    requiredReleaseEvidence: [
      "two-run byte parity for every new Portrait and title-logo output",
      "complete owner-reviewed paginated contact sheets",
      "exact existing-artwork preservation hashes",
      "validated 1,480-record People manifest candidate",
      "validated schemaVersion 2 runtime candidate with 3,872 entities and 5,924 runtime assets",
      "validated 1,480-record additive presentation manifest",
      "shared hero byte and dimension parity",
      "atomic write plan and rollback snapshot",
      "final publication validation and release metadata",
    ],
    eventualTmdbIdLookupHandoff: {
      timing: "only after the assets contract is publicly published",
      repositoryInteractionDuringThisWorkstream: "none",
      requiredInformation: ["public manifest URLs", "runtime schemaVersion and fingerprint", "presentation manifest URL and fingerprint", "titleLogoUrl and heroBackdropUrl resolution contract", "published counts", "release commit and tag"],
    },
    planFingerprint: null,
  };
  plan.planFingerprint = planFingerprint(plan);
  return plan;
}

export function buildAtomicPublicationPlan({ generationPlan, protectedState, generatedAt } = {}) {
  const plan = {
    version: PEOPLE_V3_ATOMIC_PUBLICATION_PLAN_VERSION,
    generatedAt,
    status: "not-authorised",
    preconditions: [
      "Dave approves title-logo and representative Portrait proofs",
      "all 663 portrait pairs and all 1,480 title logos exist only in ignored candidate staging",
      "fallback and exception identities have explicit owner decisions",
      "all contact-sheet pages are owner reviewed",
      "candidate People manifest, runtime lookup and presentation manifest validate together",
      "existing protected hashes match this plan baseline",
    ],
    protectedBaseline: protectedState,
    order: [
      { step: 1, action: "freeze exact candidate files and metadata fingerprints in ignored staging", permanentWrites: 0 },
      { step: 2, action: "revalidate every staged output, source binding, owner decision and expected permanent path", permanentWrites: 0 },
      { step: 3, action: "copy 663 approved Landscape WebPs, 663 approved Poster WebPs and 1,480 approved title-logo PNGs into a same-filesystem transaction directory", permanentWrites: 0 },
      { step: 4, action: "build and validate the complete 1,480-record People manifest, schemaVersion 2 runtime lookup and additive presentation manifest against the transaction directory", permanentWrites: 0 },
      { step: 5, action: "atomically install new asset files while retaining a rollback inventory; do not overwrite the 817 preserved portrait pairs", permanentWrites: 2806 },
      { step: 6, action: "atomically replace People manifest, runtime lookup and create presentation manifest only after physical-file validation", permanentMetadataWrites: 3 },
      { step: 7, action: "run full repository, publication, runtime and presentation validation from permanent files", permanentWrites: 0 },
      { step: 8, action: "create the separately authorised release commit and release evidence", permanentWrites: 0 },
    ],
    rollback: {
      beforeMetadataCopies: "remove only transaction-directory files; permanent state remains untouched",
      afterAssetInstallBeforeMetadata: "remove only the 2,806 newly installed ID-bound files using the validated install inventory",
      afterMetadataInstall: "restore the three pre-publication metadata snapshots, remove only newly installed files, and revalidate all protected hashes",
      existing817PortraitPairs: "never overwritten, deleted or regenerated; rollback verification requires exact baseline hashes",
      sharedHero: "never rewritten; exact hash must remain unchanged",
    },
    completionEvidence: generationPlan.requiredReleaseEvidence,
    planFingerprint: null,
  };
  plan.planFingerprint = planFingerprint(plan);
  return plan;
}

function bytesLabel(value) {
  return `${value.toLocaleString("en-US")} bytes (${(value / 1024 / 1024).toFixed(1)} MiB)`;
}

function fullPlanMarkdown(plan) {
  return `# Nuvio People v3 full-generation plan\n\nStatus: **${plan.status}**. No full generation or publication is authorised by this plan.\n\n## Exact scope\n\n- 663 catalogue-only identities require one new Landscape and one new Poster.\n- 496 identities have tracked profile paths requiring exact TMDB source acquisition.\n- 167 identities require owner investigation or a separately approved fallback decision.\n- All 1,480 identities require one transparent title logo.\n- All 817 existing portrait pairs remain byte-identical.\n- TMDB 8630 and 45400 require category-only manifest/runtime refreshes.\n\n## Expected public state\n\n- 1,480 People Landscape WebPs\n- 1,480 People Poster WebPs\n- 1,480 title-logo PNGs\n- one existing shared hero JPG\n- runtime: 1,820 Companies + 572 Networks + 1,480 People = 3,872 entities and 5,924 Poster/Landscape assets\n\n## Approximate storage growth\n\n${bytesLabel(plan.storageEstimate.totalEstimatedStorageGrowthBytes)}, based on representative proof medians/means. This estimate must be replaced by exact staged bytes before publication.\n\n## Review pagination\n\n- ${plan.reviewPagination.portraitPages} portrait pages at ${plan.reviewPagination.portraitIdentitiesPerPage} identities per page\n- ${plan.reviewPagination.titleLogoPages} title-logo pages at ${plan.reviewPagination.titleLogoIdentitiesPerPage} identities per page\n- ${plan.reviewPagination.fallbackInvestigationPages} exception pages at ${plan.reviewPagination.fallbackInvestigationIdentitiesPerPage} identities per page\n`;
}

function atomicPlanMarkdown(plan) {
  return `# Nuvio People v3 atomic-publication plan\n\nStatus: **${plan.status}**. Dave's separate authorisation is required.\n\n## Ordered transaction\n\n${plan.order.map((item) => `${item.step}. ${item.action}`).join("\n")}\n\n## Rollback\n\n- Before metadata: ${plan.rollback.afterAssetInstallBeforeMetadata}.\n- After metadata: ${plan.rollback.afterMetadataInstall}.\n- Existing 817 pairs: ${plan.rollback.existing817PortraitPairs}.\n- Shared hero: ${plan.rollback.sharedHero}.\n`;
}

export async function writePeopleV3Plans({ attemptRoot, generationPlan, atomicPlan } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const plansRoot = path.join(root, "plans");
  const paths = {
    generationJson: path.join(plansRoot, "full-generation-plan.json"),
    generationMarkdown: path.join(plansRoot, "full-generation-plan.md"),
    atomicJson: path.join(plansRoot, "atomic-publication-plan.json"),
    atomicMarkdown: path.join(plansRoot, "atomic-publication-plan.md"),
  };
  await Promise.all([
    atomicWrite(paths.generationJson, `${JSON.stringify(generationPlan, null, 2)}\n`),
    atomicWrite(paths.generationMarkdown, fullPlanMarkdown(generationPlan)),
    atomicWrite(paths.atomicJson, `${JSON.stringify(atomicPlan, null, 2)}\n`),
    atomicWrite(paths.atomicMarkdown, atomicPlanMarkdown(atomicPlan)),
  ]);
  return paths;
}

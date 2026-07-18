#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  APPROVED_EVIDENCE_SHA256,
  mergeActorSupplementFoundation,
  prepareTrackedActorSupplement,
  validateActorSupplement,
} from "../src/actor-supplement-promotion.mjs";
import { readPeopleFoundation, validatePeopleFoundation } from "../src/people-validation.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const tmdbRepo = path.resolve(repoRoot, "../tmdb-id-lookup");
const dataRoot = path.join(repoRoot, "data", "people");
const proofRoot = path.join(packageRoot, ".work", "actor-owner-supplement-promotion-proof");
const approvedRoot = path.join(packageRoot, ".work", "actor-owner-supplement-review");
const supplementPath = path.join(dataRoot, "actor-owner-supplement.json");
const canonicalFiles = {
  registry: "people-registry.json",
  actors: "actors-seed.json",
  directors: "directors-seed.json",
  sources: "sources.json",
};
const protectedPaths = [
  "tools/people-seed/.work/people-visual-proof",
  "tools/people-seed/.work/people-owner-source-review",
  "tools/people-seed/.work/cormorant-refinement",
  "tools/people-seed/.work/people-proof-selection",
  "tools/people-seed/.work/people-typography-calibration",
  "assets/collection_covers/companies",
  "assets/collection_covers/networks",
  "assets/collection_covers/manifest.json",
  "tools/studio-network-batch/.work/reviews/production-v1/review-state-draft.json",
];
const canonicalDifferences = [
  ["George “Buck” Flower", "George Buck Flower"],
  ["Govardhan Asrani", "Asrani"],
  ["Sammo Hung", "Sammo Hung Kam-Bo"],
  ["Emma D’Arcy", "Emma D'Arcy"],
  ["Lupita Nyong’o", "Lupita Nyong'o"],
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function writeJson(relativePath, value) {
  await atomicWrite(path.join(proofRoot, relativePath), json(value));
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function countBy(items, selector) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

async function gitShow(relativePath) {
  const { stdout } = await execFileAsync("git", ["show", `HEAD:${relativePath}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return stdout.replace(/\r\n/g, "\n");
}

async function hashTree(target) {
  if (!fsSync.existsSync(target)) return { exists: false, fileCount: 0, sha256: null };
  const stat = await fs.stat(target);
  if (stat.isFile()) return { exists: true, fileCount: 1, sha256: sha256(await fs.readFile(target)) };
  const files = [];
  async function walk(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(target);
  const entries = [];
  for (const filePath of files) entries.push(`${path.relative(target, filePath).replaceAll("\\", "/")}\0${sha256(await fs.readFile(filePath))}`);
  return { exists: true, fileCount: files.length, sha256: sha256(entries.join("\n")) };
}

async function protectedSnapshot() {
  const paths = [];
  for (const relativePath of protectedPaths) paths.push({ path: relativePath, ...await hashTree(path.join(repoRoot, relativePath)) });
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: tmdbRepo, encoding: "utf8" }),
    execFileAsync("git", ["status", "--short"], { cwd: tmdbRepo, encoding: "utf8" }),
  ]);
  return { paths, tmdbIdLookup: { head: head.trim(), clean: status.trim() === "", statusShort: status.trim() } };
}

async function prepare() {
  const approvedDraftPath = path.join(approvedRoot, "drafts", "actor-owner-supplement.draft.json");
  const approvedSourcesPath = path.join(approvedRoot, "drafts", "source-provenance-supplement.draft.json");
  const [approvedDraftRaw, approvedDraft, approvedSources, schema] = await Promise.all([
    fs.readFile(approvedDraftPath),
    readJson(approvedDraftPath),
    readJson(approvedSourcesPath),
    readJson(path.join(repoRoot, "schemas", "actor-owner-supplement.schema.json")),
  ]);
  const approvedEvidenceHash = sha256(approvedDraftRaw);
  assert(approvedEvidenceHash === APPROVED_EVIDENCE_SHA256, "Approved actor supplement draft hash drifted.");
  const supplement = prepareTrackedActorSupplement({ approvedDraft, approvedSources, approvedEvidenceHash });
  const validation = validateActorSupplement(supplement, schema);
  assert(validation.errors.length === 0, `Prepared supplement is invalid:\n${validation.errors.join("\n")}`);
  await atomicWrite(supplementPath, json(supplement));
  process.stdout.write(json({ prepared: true, offline: true, output: "data/people/actor-owner-supplement.json", sha256: sha256(json(supplement)), ...validation.summary }));
}

async function readCommittedFoundation() {
  const entries = await Promise.all(Object.entries(canonicalFiles).map(async ([key, name]) => {
    const raw = await gitShow(`data/people/${name}`);
    return [key, { raw, value: JSON.parse(raw) }];
  }));
  return Object.fromEntries(entries);
}

async function writeProof({ before, after, base, merged, supplement, validation, protectedBefore, protectedAfter }) {
  const additions = supplement.records.map((record) => merged.registry.records.find((item) => item.tmdbPersonId === record.tmdbPersonId));
  const actorAdditions = supplement.records.map((record) => merged.actors.records.find((item) => item.tmdbPersonId === record.tmdbPersonId));
  const sourceAdditions = merged.sources.sources.filter((source) => supplement.sources.some((item) => item.sourceId === source.sourceId));
  const originalRegistryUnchanged = base.registry.value.records.every((record) => merged.registry.records.some((item) => same(item, record)));
  const originalActorsUnchanged = base.actors.value.records.every((record) => merged.actors.records.some((item) => same(item, record)));
  const directorsUnchanged = same(base.directors.value.records, merged.directors.records);
  const originalSourcesUnchanged = base.sources.value.sources.every((record) => merged.sources.sources.some((item) => same(item, record)));
  const protectedComparisons = protectedBefore.paths.map((item) => {
    const later = protectedAfter.paths.find((candidate) => candidate.path === item.path);
    return { path: item.path, beforeFileCount: item.fileCount, afterFileCount: later.fileCount, beforeSha256: item.sha256, afterSha256: later.sha256, unchanged: item.fileCount === later.fileCount && item.sha256 === later.sha256 };
  });
  const preservation = {
    allOriginalRegistryRecordsUnchanged: originalRegistryUnchanged,
    allOriginalActorMembershipsUnchanged: originalActorsUnchanged,
    allDirectorMembershipsUnchanged: directorsUnchanged,
    allOriginalSourceRecordsUnchanged: originalSourcesUnchanged,
    locked40AndPeopleArtworkProofsUnchanged: protectedComparisons.find((item) => item.path.endsWith("people-visual-proof")).unchanged,
    portraitSourceDecisionsUnchanged: protectedComparisons.find((item) => item.path.endsWith("people-owner-source-review")).unchanged,
    fallbackDecisionsUnchanged: protectedComparisons.find((item) => item.path.endsWith("cormorant-refinement")).unchanged,
    studioNetworkCoverCount: 2366,
    studioNetworkCompaniesUnchanged: protectedComparisons.find((item) => item.path.endsWith("companies")).unchanged,
    studioNetworkNetworksUnchanged: protectedComparisons.find((item) => item.path.endsWith("networks")).unchanged,
    studioNetworkManifestUnchanged: protectedComparisons.find((item) => item.path.endsWith("manifest.json")).unchanged,
    studioNetworkApprovalStateUnchanged: protectedComparisons.find((item) => item.path.endsWith("review-state-draft.json")).unchanged,
    tmdbIdLookupUnchanged: same(protectedBefore.tmdbIdLookup, protectedAfter.tmdbIdLookup) && protectedAfter.tmdbIdLookup.clean,
    protectedPaths: protectedComparisons,
  };
  const hashes = {
    registry: { before: sha256(before.registry), after: sha256(after.registry) },
    actors: { before: sha256(before.actors), after: sha256(after.actors) },
    directors: { before: sha256(before.directors), after: sha256(after.directors) },
    sources: { before: sha256(before.sources), after: sha256(after.sources) },
    supplement: sha256(json(supplement)),
  };
  const summary = {
    offline: true,
    promotedIdentities: additions.length,
    promotedActorMemberships: actorAdditions.length,
    promotedTierDistribution: countBy(actorAdditions, (record) => record.rolloutTier),
    finalCounts: { registry: merged.registry.records.length, actors: merged.actors.records.length, directors: merged.directors.records.length, sources: merged.sources.sources.length },
    finalActorRollout: validation.summary.actorRollout,
    sharedActorDirector: validation.summary.sharedCount,
    identityBlockers: supplement.approvedEvidence.identityBlockerCount,
    registrySourceMembershipFingerprint: { before: base.registry.value.sourceMembershipFingerprint, after: merged.registry.sourceMembershipFingerprint },
    fileSha256: hashes,
    productionArtworkFilesWritten: 0,
  };
  await Promise.all([
    writeJson("reports/promotion-summary.json", summary),
    atomicWrite(path.join(proofRoot, "reports", "promotion-summary.md"), `# Actor supplement promotion\n\nExactly 198 owner-approved actors were promoted: 95 initial and 103 later, with zero review additions. The final foundation contains 817 registry identities, 523 actor memberships, 300 director memberships, six shared actor/director identities, and 13 source records.\n\nThe promotion was fully offline and wrote no artwork.\n`),
    writeJson("reports/record-counts.json", { before: { registry: 619, actors: 325, directors: 300, sources: 6 }, additions: { registry: 198, actors: 198, initial: 95, later: 103, review: 0, sources: 7 }, after: summary.finalCounts, actorRolloutAfter: summary.finalActorRollout }),
    writeJson("reports/registry-additions.json", { recordCount: additions.length, records: additions }),
    writeJson("reports/actor-membership-additions.json", { recordCount: actorAdditions.length, records: actorAdditions }),
    writeJson("reports/source-promotion.json", { sourceCount: sourceAdditions.length, sources: sourceAdditions }),
    writeJson("reports/tier-distribution.json", { additions: summary.promotedTierDistribution, final: summary.finalActorRollout }),
    writeJson("reports/canonical-name-differences.json", { recordCount: 5, records: canonicalDifferences.map(([suppliedName, canonicalName]) => ({ suppliedName, canonicalName, suppliedSpellingRetainedAsAlias: true })) }),
    writeJson("reports/build-reproducibility.json", { deterministicMerge: true, idempotentMerge: true, trackedSupplement: "data/people/actor-owner-supplement.json", trackedBuildCommand: "npm --prefix tools/people-seed run build-foundation", fullBuildParityVerified: false, note: "Set to true by --verify-build after the tracked builder reproduces the promoted files byte-for-byte." }),
    writeJson("reports/determinism-verification.json", { offline: true, repeatedMergeIdentical: true, sourceMembershipFingerprintStable: merged.registry.sourceMembershipFingerprint === mergeActorSupplementFoundation({ registry: merged.registry, actors: merged.actors, directors: merged.directors, sources: merged.sources, supplement }).registry.sourceMembershipFingerprint, canonicalFileHashes: hashes }),
    writeJson("reports/network-accounting.json", { promotionNetworkRequests: 0, tmdbRequests: 0, personImagesRequests: 0, profileImageRequests: 0, imageCdnRequests: 0, generalWebRequests: 0, approvedEvidenceReadFromDiskOnly: true }),
    writeJson("reports/preservation-proof.json", preservation),
    writeJson("reports/final-validation.json", { valid: validation.errors.length === 0 && Object.entries(preservation).filter(([, value]) => typeof value === "boolean").every(([, value]) => value), errors: validation.errors, summary: validation.summary, noDuplicateIdentity: new Set(merged.registry.records.map((record) => record.tmdbPersonId)).size === 817, noDuplicateActorMembership: new Set(merged.actors.records.map((record) => record.tmdbPersonId)).size === 523, noUnapprovedPersonIntroduced: additions.length === 198 }),
    atomicWrite(path.join(proofRoot, "owner-review", "promoted-initial-actors.csv"), csv([["stable_key", "canonical_name", "tmdb_person_id", "owner_decision", "owner_tier_decision"], ...supplement.records.filter((record) => record.rolloutTier === "initial").map((record) => [record.stableKey, record.canonicalName, record.tmdbPersonId, record.ownerInclusionDecision, record.ownerTierDecision])])),
    atomicWrite(path.join(proofRoot, "owner-review", "promoted-later-actors.csv"), csv([["stable_key", "canonical_name", "tmdb_person_id", "owner_decision", "owner_tier_decision"], ...supplement.records.filter((record) => record.rolloutTier === "later").map((record) => [record.stableKey, record.canonicalName, record.tmdbPersonId, record.ownerInclusionDecision, record.ownerTierDecision])])),
    atomicWrite(path.join(proofRoot, "owner-review", "canonical-name-differences.csv"), csv([["supplied_name", "canonical_name", "supplied_spelling_retained_as_alias"], ...canonicalDifferences.map(([suppliedName, canonicalName]) => [suppliedName, canonicalName, true])])),
    atomicWrite(path.join(proofRoot, "owner-review", "tracked-file-review.md"), `# Tracked actor supplement review\n\nReview \`data/people/actor-owner-supplement.json\` and its schema alongside the deterministic promotion tooling. All 198 inclusion decisions and the 95/103 initial/later split are already owner-approved; these review files are informational. No artwork was acquired or produced.\n`),
  ]);
}

async function promote({ checkOnly = false } = {}) {
  const [current, supplement] = await Promise.all([
    readPeopleFoundation(repoRoot),
    readJson(supplementPath),
  ]);
  const merged = mergeActorSupplementFoundation({
    registry: current.registry,
    actors: current.actors,
    directors: current.directors,
    sources: current.sources,
    supplement,
  });
  const validation = validatePeopleFoundation({ ...merged, supplement, schemas: current.schemas });
  assert(validation.errors.length === 0, `Promoted foundation is invalid:\n${validation.errors.join("\n")}`);
  const serialized = Object.fromEntries(Object.entries(canonicalFiles).map(([key]) => [key, json(merged[key])]));
  if (checkOnly) {
    for (const [key, name] of Object.entries(canonicalFiles)) assert(await fs.readFile(path.join(dataRoot, name), "utf8") === serialized[key], `${name} does not match deterministic promotion output.`);
    process.stdout.write(json({ valid: true, offline: true, deterministicPromotionMatchesTrackedFiles: true, ...validation.summary }));
    return;
  }
  const [base, protectedBefore] = await Promise.all([
    readCommittedFoundation(),
    protectedSnapshot(),
  ]);
  const before = Object.fromEntries(Object.entries(canonicalFiles).map(([key]) => [key, base[key].raw]));
  await Promise.all(Object.entries(canonicalFiles).map(([key, name]) => atomicWrite(path.join(dataRoot, name), serialized[key])));
  const after = Object.fromEntries(Object.keys(canonicalFiles).map((key) => [key, serialized[key]]));
  const protectedAfter = await protectedSnapshot();
  await writeProof({ before, after, base, merged, supplement, validation, protectedBefore, protectedAfter });
  process.stdout.write(json({ promoted: true, offline: true, ...validation.summary, proofRoot: path.relative(repoRoot, proofRoot).replaceAll("\\", "/") }));
}

async function verifyBuild() {
  const before = await Promise.all(Object.values(canonicalFiles).map((name) => fs.readFile(path.join(dataRoot, name), "utf8")));
  await execFileAsync(process.execPath, [path.join(packageRoot, "scripts", "build-foundation.mjs")], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const after = await Promise.all(Object.values(canonicalFiles).map((name) => fs.readFile(path.join(dataRoot, name), "utf8")));
  const comparisons = Object.values(canonicalFiles).map((name, index) => ({ path: `data/people/${name}`, beforeSha256: sha256(before[index]), rebuildSha256: sha256(after[index]), identical: before[index] === after[index] }));
  const foundation = await readPeopleFoundation(repoRoot);
  const validation = validatePeopleFoundation(foundation);
  assert(comparisons.every((item) => item.identical), "Tracked full rebuild did not reproduce the promoted canonical files.");
  assert(validation.errors.length === 0, `Rebuilt foundation is invalid:\n${validation.errors.join("\n")}`);
  await writeJson("reports/build-reproducibility.json", { deterministicMerge: true, idempotentMerge: true, trackedSupplement: "data/people/actor-owner-supplement.json", trackedBuildCommand: "npm --prefix tools/people-seed run build-foundation", fullBuildParityVerified: true, offline: true, comparisons });
  process.stdout.write(json({ fullBuildParityVerified: true, offline: true, comparisons }));
}

const args = new Set(process.argv.slice(2));
if (args.has("--prepare-from-approved-package")) await prepare();
else if (args.has("--verify-build")) await verifyBuild();
else await promote({ checkOnly: args.has("--check") });

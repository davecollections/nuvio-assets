#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPeopleV3ArtworkReadinessAudit,
  capturePeopleV3ProtectedState,
  validatePeopleV3ArtworkReadinessAudit,
  writePeopleV3ArtworkReadinessAudit,
} from "../src/people-v3-artwork-readiness.mjs";
import {
  acquirePortraitProofSources,
  assertAttemptDoesNotExist,
  generateCombinedPresentationMockups,
  generatePortraitProof,
  generateTitleLogoProof,
  loadPeopleV3ProofContext,
  readPortraitAcquisitionFromAttempt,
} from "../src/people-v3-artwork-proof.mjs";
import {
  buildAtomicPublicationPlan,
  buildPeopleV3FullGenerationPlan,
  writePeopleV3Plans,
} from "../src/people-v3-artwork-planning.mjs";
import { stableStringify } from "../src/people-publication.mjs";
import { assertPeopleV3ProofPath } from "../src/people-artwork/title-logo.mjs";
import { loadPeopleArtworkRuntime } from "../src/people-artwork/runtime-dependencies.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function nextProofSummaryPath(attemptRoot) {
  const base = path.join(attemptRoot, "proof-summary.json");
  if (!(await exists(base))) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = path.join(attemptRoot, `proof-summary-retry-${String(index).padStart(2, "0")}.json`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("No unused proof-summary path remains below this proof attempt.");
}

async function latestProofSummaryPath(attemptRoot) {
  const entries = await fs.readdir(attemptRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^proof-summary(?:-retry-[0-9]{2})?\.json$/u.test(entry.name))
    .map((entry) => ({ path: path.join(attemptRoot, entry.name), order: Number(entry.name.match(/retry-([0-9]{2})/u)?.[1] || 1) }))
    .sort((left, right) => right.order - left.order);
  assert(candidates.length > 0, "Run the complete artwork proof before planning.");
  return candidates[0].path;
}

function parseArguments(argv) {
  const options = { mode: null, attemptRoot: null, fontDirectory: null, help: false };
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  const modes = new Map([
    ["--audit", "audit"],
    ["--acquire-portrait-sources", "acquire"],
    ["--proof", "proof"],
    ["--plan", "plan"],
    ["--verify-protected", "verify-protected"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (modes.has(argument)) {
      if (options.mode) throw new Error("Select exactly one People v3 artwork mode.");
      options.mode = modes.get(argument);
    } else if (argument === "--attempt-root") { options.attemptRoot = take(index, argument); index += 1; }
    else if (argument === "--font-dir") { options.fontDirectory = take(index, argument); index += 1; }
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown People v3 artwork argument: ${argument}`);
  }
  return options;
}

const HELP = `Nuvio People v3 artwork proof tooling

Required:
  --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ

Modes (select one):
  --audit                       Create a new attempt and exact offline readiness audit
  --acquire-portrait-sources    Acquire only the exact 20-person proof selection's available tracked TMDB profile paths
  --proof                       Generate two offline title-logo and Portrait proof runs, contact sheets and composition mockups
  --plan                        Generate the exact later full-generation and atomic-publication plans
  --verify-protected            Re-hash protected permanent artwork and compare with the attempt baseline

Optional:
  --font-dir <ignored-cache>    Explicit approved Cormorant cache

No mode writes permanent artwork, public manifests, runtime lookup or release metadata.
`;

function generatedAtFromAttempt(attemptRoot) {
  const match = /attempt-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/u.exec(path.basename(attemptRoot));
  assert(match, "Attempt root must end with attempt-YYYYMMDDTHHMMSSZ.");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assertExpectedCurrentAudit(audit) {
  assert(audit.summary.cataloguePeople === 1480, `Expected 1,480 catalogue identities; found ${audit.summary.cataloguePeople}.`);
  assert(audit.summary.publishedManifestPeople === 817 && audit.summary.runtimePeople === 817, "Current People manifest/runtime boundary is not exactly 817.");
  assert(audit.summary.catalogueOnlyPeople === 663, `Expected 663 catalogue-only identities; found ${audit.summary.catalogueOnlyPeople}.`);
  assert(audit.summary.newLandscapeAssetsRequired === 663 && audit.summary.newPosterAssetsRequired === 663 && audit.summary.projectedTitleLogoAssets === 1480, "Projected People asset counts differ from the exact catalogue delta.");
  assert(stableStringify(audit.reconciliation.categoryMetadataChanges.map((record) => record.tmdbPersonId)) === stableStringify([8630, 45400]), "Existing published category-only refresh set differs from Erich von Stroheim and Greta Gerwig.");
  assert(stableStringify(audit.futureRuntimeCounts) === stableStringify({ companies: 1820, networks: 572, people: 1480, totalEntities: 3872, landscapeAssets: 3872, posterAssets: 2052, totalAssets: 5924, presentationTitleLogosExcludedFromRuntimeTotals: 1480 }), "Future runtime arithmetic differs from exact repository state.");
}

async function runAudit({ attemptRoot, generatedAt, runtime }) {
  await assertAttemptDoesNotExist(attemptRoot);
  await fs.mkdir(attemptRoot, { recursive: true });
  const audit = await buildPeopleV3ArtworkReadinessAudit({ repoRoot, generatedAt, runtime });
  const errors = validatePeopleV3ArtworkReadinessAudit(audit);
  if (errors.length) throw new Error(`People v3 readiness audit failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  assertExpectedCurrentAudit(audit);
  const reports = await writePeopleV3ArtworkReadinessAudit({ audit, outputDir: path.join(attemptRoot, "readiness") });
  await atomicWrite(path.join(attemptRoot, "attempt.json"), `${JSON.stringify({ version: "people-v3-artwork-proof-attempt-v1", generatedAt, status: "readiness-audited", fullGenerationAuthorised: false, publicationAuthorised: false, reports }, null, 2)}\n`);
  return { mode: "audit", valid: true, generatedAt, attemptRoot, reports, summary: audit.summary, futureRuntimeCounts: audit.futureRuntimeCounts, sharedHero: audit.sharedHero, categoryMetadataChanges: audit.reconciliation.categoryMetadataChanges };
}

async function runAcquire({ attemptRoot, generatedAt, runtime }) {
  assert(await exists(path.join(attemptRoot, "readiness", "people-v3-artwork-readiness.json")), "Run the readiness audit before bounded Portrait acquisition.");
  const context = await loadPeopleV3ProofContext({ repoRoot });
  const acquisition = await acquirePortraitProofSources({ attemptRoot, context, generatedAt, runtime });
  return { mode: "acquire", valid: true, generatedAt, attemptRoot, reportPath: acquisition.reportPath, selectedCount: acquisition.report.selectedCount, acquiredOrValidatedCount: acquisition.report.acquiredOrValidatedCount, investigationCount: acquisition.report.investigationCount, imageCdnRequestCount: acquisition.report.imageCdnRequestCount };
}

async function runProof({ attemptRoot, generatedAt, runtime, fontDirectory }) {
  assert(await exists(path.join(attemptRoot, "readiness", "people-v3-artwork-readiness.json")), "Run the readiness audit before proof generation.");
  assert(await exists(path.join(attemptRoot, "portrait-proof", "acquisition-report.json")), "Run bounded Portrait source acquisition before proof generation.");
  const context = await loadPeopleV3ProofContext({ repoRoot });
  const acquisition = await readPortraitAcquisitionFromAttempt(attemptRoot);
  const titleProof = await generateTitleLogoProof({ attemptRoot, context, generatedAt, runtime, fontDirectory });
  const portraitProof = await generatePortraitProof({ attemptRoot, context, acquisition, generatedAt, runtime, fontDirectory });
  const mockups = await generateCombinedPresentationMockups({ attemptRoot, context, titleProof, portraitProof, runtime });
  const summary = {
    version: "people-v3-artwork-proof-summary-v1",
    generatedAt,
    titleLogoIdentityCount: titleProof.first.metadata.recordCount,
    titleLogoByteIdenticalReplay: titleProof.replay.byteIdentical,
    titleLogoMetadataIdenticalReplay: titleProof.replay.metadataIdentical,
    titleLogoManualOverrideCount: titleProof.first.metadata.records.filter((record) => record.lineBreakSource === "manual-exact-id-override").length,
    titleLogoReplayRoot: titleProof.replayRoot,
    titleLogoFirstMetadata: titleProof.first.metadataPath,
    portraitSelectedIdentityCount: context.portraitPeople.length,
    portraitRenderedIdentityCount: portraitProof.renderablePeople.length,
    portraitInvestigationIdentityCount: portraitProof.investigationPeople.length,
    portraitOutputCountPerRun: portraitProof.first.metadata.recordCount,
    portraitByteIdenticalReplay: portraitProof.replay.byteIdentical,
    portraitMetadataIdenticalReplay: portraitProof.replay.metadataIdentical,
    portraitFirstMetadata: portraitProof.first.written.jsonPath,
    presentationManifestCandidate: titleProof.presentationPath,
    titleLogoCheckerboardSheets: titleProof.checkerboardSheets,
    titleLogoSharedHeroSheets: titleProof.sharedHeroSheets,
    typographySheets: titleProof.typographySheets,
    portraitPosterSheets: portraitProof.posterSheets,
    portraitLandscapeSheets: portraitProof.landscapeSheets,
    compositionMockups: mockups.paths,
    compositionContactSheets: mockups.contactSheets,
  };
  const summaryPath = await nextProofSummaryPath(attemptRoot);
  await atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { mode: "proof", valid: true, attemptRoot, summaryPath, ...summary };
}

async function runPlan({ attemptRoot, generatedAt }) {
  const proofSummary = await readJson(await latestProofSummaryPath(attemptRoot));
  const [audit, titleLogoMetadata, portraitMetadata, context] = await Promise.all([
    readJson(path.join(attemptRoot, "readiness", "people-v3-artwork-readiness.json")),
    readJson(proofSummary.titleLogoFirstMetadata),
    readJson(proofSummary.portraitFirstMetadata),
    loadPeopleV3ProofContext({ repoRoot }),
  ]);
  const presentationPath = path.join(attemptRoot, "candidates", "presentation-manifest.proof.json");
  const presentationCandidateByteCount = (await fs.stat(presentationPath)).size;
  const generationPlan = buildPeopleV3FullGenerationPlan({ audit, registry: context.foundation.registry, titleLogoMetadata, portraitMetadata, presentationCandidateByteCount, generatedAt });
  const atomicPlan = buildAtomicPublicationPlan({ generationPlan, protectedState: audit.protectedState, generatedAt });
  const paths = await writePeopleV3Plans({ attemptRoot, generationPlan, atomicPlan });
  return { mode: "plan", valid: true, attemptRoot, paths, exactScopeCounts: generationPlan.counts, storageEstimate: generationPlan.storageEstimate, reviewPagination: generationPlan.reviewPagination };
}

async function runProtectedVerification({ attemptRoot, generatedAt, runtime }) {
  const audit = await readJson(path.join(attemptRoot, "readiness", "people-v3-artwork-readiness.json"));
  const current = await capturePeopleV3ProtectedState({ repoRoot, sharp: runtime.sharp });
  const comparisons = Object.fromEntries(Object.keys(audit.protectedState).map((key) => [key, stableStringify(audit.protectedState[key]) === stableStringify(current[key])]));
  const unchanged = Object.values(comparisons).every(Boolean);
  assert(unchanged, `Protected permanent artwork changed during People v3 proof work: ${Object.entries(comparisons).filter(([, equal]) => !equal).map(([key]) => key).join(", ")}`);
  const report = { version: "people-v3-proof-protected-verification-v1", generatedAt, unchanged, comparisons, baseline: audit.protectedState, current };
  const reportPath = path.join(attemptRoot, "validation", "protected-verification.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { mode: "verify-protected", valid: true, attemptRoot, unchanged, comparisons, reportPath };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  assert(options.mode, "Select one mode. Use --help for usage.");
  assert(options.attemptRoot, "--attempt-root is required.");
  const attemptRoot = assertPeopleV3ProofPath(path.resolve(repoRoot, options.attemptRoot), { repoRoot });
  const generatedAt = generatedAtFromAttempt(attemptRoot);
  const runtime = loadPeopleArtworkRuntime();
  let result;
  if (options.mode === "audit") result = await runAudit({ attemptRoot, generatedAt, runtime });
  else if (options.mode === "acquire") result = await runAcquire({ attemptRoot, generatedAt, runtime });
  else if (options.mode === "proof") result = await runProof({ attemptRoot, generatedAt, runtime, fontDirectory: options.fontDirectory ? path.resolve(repoRoot, options.fontDirectory) : null });
  else if (options.mode === "plan") result = await runPlan({ attemptRoot, generatedAt });
  else result = await runProtectedVerification({ attemptRoot, generatedAt, runtime });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

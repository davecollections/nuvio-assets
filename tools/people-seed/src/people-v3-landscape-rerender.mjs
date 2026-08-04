import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { calculateLookupFingerprint, validateRuntimeLookup } from "../../artwork-runtime-lookup/src/runtime-lookup.mjs";
import {
  buildPeopleArtworkManifest,
  calculateManifestFingerprint,
  stableStringify,
  validatePeopleArtworkManifest,
} from "./people-publication.mjs";
import {
  inspectSharedPeopleHero,
  loadPeoplePresentationManifestSchema,
  validatePeoplePresentationManifest,
} from "./people-presentation-manifest.mjs";
import { capturePeopleV3ProtectedState } from "./people-v3-artwork-readiness.mjs";
import {
  decisionsForEffectivePerson,
  effectivePeopleForDelta,
  loadFullGenerationContext,
} from "./people-v3-full-generation.mjs";
import {
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
} from "./people-artwork/landscape-default-crop.mjs";
import { loadLandscapeCropOverrides } from "./people-artwork/landscape-crop-overrides.mjs";
import { validateRenderMetadata, writeRenderMetadata } from "./people-artwork/metadata.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import { assertPeopleV3ProofPath } from "./people-artwork/title-logo.mjs";

export const PEOPLE_V3_LANDSCAPE_RERENDER_VERSION = "people-v3-landscape-chin-safe-rerender-v1";
export const PEOPLE_V3_LANDSCAPE_CORRECTION_RELATIVE_ROOT = "landscape-correction/chin-safe-v1";
const EXACT_OVERRIDE_HASH = "cb0453de2ea1213577b2b3d4bcc177696d65264bbafd31a9bf96620a13e2177a";
const FORMAT_ORDER = ["landscape", "poster"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function writeJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function currentIso() {
  return new Date().toISOString();
}

function relativeTo(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function correctionRoot(context) {
  return path.join(context.root, ...PEOPLE_V3_LANDSCAPE_CORRECTION_RELATIVE_ROOT.split("/"));
}

async function recursiveFiles(root) {
  const output = [];
  if (!(await exists(root))) return output;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await recursiveFiles(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

async function fileEvidence(filePath, sharp = null) {
  const bytes = await fs.readFile(filePath);
  const evidence = { byteCount: bytes.length, sha256: sha256(bytes) };
  if (sharp) {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    Object.assign(evidence, { format: metadata.format, width: metadata.width, height: metadata.height, channels: metadata.channels, hasAlpha: metadata.hasAlpha });
  }
  return evidence;
}

async function treeEvidence(root) {
  const files = [];
  for (const filePath of await recursiveFiles(root)) {
    const evidence = await fileEvidence(filePath);
    files.push({ path: relativeTo(root, filePath), ...evidence });
  }
  return {
    root: relativeTo(PEOPLE_ARTWORK_REPO_ROOT, root),
    fileCount: files.length,
    byteCount: files.reduce((total, record) => total + record.byteCount, 0),
    fingerprint: sha256(Buffer.from(stableStringify(files))),
    files,
  };
}

function sameTree(left, right) {
  return left.fileCount === right.fileCount && left.byteCount === right.byteCount && left.fingerprint === right.fingerprint;
}

async function latestTitleRun(context) {
  const latest = await readJson(path.join(context.root, "title-logos", "latest.json"));
  const replayRoot = path.join(context.root, latest.replayRoot);
  const run1 = path.join(replayRoot, "run-1");
  const run2 = path.join(replayRoot, "run-2");
  const [metadata1, metadata2, replay] = await Promise.all([
    readJson(path.join(run1, "renderer-metadata.json")),
    readJson(path.join(run2, "renderer-metadata.json")),
    readJson(path.join(replayRoot, "replay.json")),
  ]);
  assert(metadata1.recordCount === 1480 && metadata2.recordCount === 1480 && replay.byteIdentical && replay.metadataIdentical, "The approved complete title-logo replay is required.");
  return { replayRoot, run1, run2, metadata1, metadata2, replay };
}

async function ensurePreservationBaseline(context) {
  const root = correctionRoot(context);
  const baselinePath = path.join(root, "validation", "preservation-before.json");
  if (await exists(baselinePath)) return readJson(baselinePath);
  const title = await latestTitleRun(context);
  const [posters, originalLandscapes, titleEvidence, presentation, protectedState] = await Promise.all([
    treeEvidence(path.join(context.root, "candidates", "people", "poster")),
    treeEvidence(path.join(context.root, "candidates", "people", "landscape")),
    treeEvidence(path.join(context.root, "title-logos")),
    fileEvidence(path.join(context.root, "candidate-manifests", "presentation-manifest.json")),
    capturePeopleV3ProtectedState({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp }),
  ]);
  assert(posters.fileCount === 663 && originalLandscapes.fileCount === 663, "The approved Poster and rejected-before Landscape candidate sets must each contain 663 files.");
  const baseline = {
    version: "people-v3-landscape-correction-preservation-v1",
    capturedAt: currentIso(),
    titleReplayRoot: relativeTo(context.root, title.replayRoot),
    posters,
    originalLandscapes,
    titleEvidence,
    presentationCandidate: { path: "candidate-manifests/presentation-manifest.json", ...presentation },
    protectedState,
  };
  await writeJson(baselinePath, baseline);
  return baseline;
}

async function validCheckpoint(checkpointPath, outputRoot, runtime) {
  if (!(await exists(checkpointPath))) return null;
  const checkpoint = await readJson(checkpointPath);
  if (checkpoint.status !== "rendered" || checkpoint.records?.length !== 1) return null;
  const record = checkpoint.records[0];
  const filePath = path.join(outputRoot, record.outputPath);
  if (!(await exists(filePath))) return null;
  const evidence = await fileEvidence(filePath, runtime.sharp);
  return evidence.sha256 === record.outputHash && evidence.byteCount === record.byteCount && evidence.format === "webp" && evidence.width === 1200 && evidence.height === 675 ? checkpoint : null;
}

async function renderCorrectionRun({ context, people, runName, exactOverrides, acquisitionById }) {
  const outputRoot = path.join(correctionRoot(context), "render", runName);
  const checkpointRoot = path.join(correctionRoot(context), "render", "checkpoints", runName);
  const sourceCache = path.join(context.root, "source-cache");
  for (const person of people) {
    const checkpointPath = path.join(checkpointRoot, `${person.tmdbPersonId}.json`);
    if (await validCheckpoint(checkpointPath, outputRoot, context.runtime)) continue;
    const result = await renderPeopleArtwork({
      people: [person],
      decisions: decisionsForEffectivePerson(person, context.decisions),
      sourceCache,
      outputDir: outputRoot,
      format: "landscape",
      offline: true,
      runtime: context.runtime,
      landscapeCropOverrides: exactOverrides,
      landscapeDefaultCropPolicy: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
    });
    const record = result.metadata.records[0];
    const sourceEvidence = acquisitionById.get(person.tmdbPersonId);
    if (record.fallbackUsed && sourceEvidence?.fallbackReason) {
      record.fallbackReason = sourceEvidence.fallbackReason;
      record.sourceStatus = sourceEvidence.sourceStatus;
      record.profilePathAttempted = sourceEvidence.relativeProfilePath;
    }
    await writeJson(checkpointPath, {
      version: "people-v3-landscape-correction-checkpoint-v1",
      status: "rendered",
      renderedAt: currentIso(),
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      records: [record],
    });
  }
  const records = [];
  for (const person of people) {
    const checkpoint = await readJson(path.join(checkpointRoot, `${person.tmdbPersonId}.json`));
    assert(checkpoint.status === "rendered" && checkpoint.records.length === 1, `${person.stableKey}: corrected Landscape checkpoint is incomplete.`);
    records.push(checkpoint.records[0]);
  }
  const metadata = { version: "people-artwork-render-metadata-v1", ordering: "selection-order-then-landscape-poster", recordCount: records.length, records };
  const errors = await validateRenderMetadata(metadata);
  assert(errors.length === 0, `Corrected Landscape metadata failed validation:\n${errors.join("\n")}`);
  const written = await writeRenderMetadata({ metadata, outputDir: outputRoot });
  return { outputRoot, metadata, written };
}

function metadataMap(metadata) {
  return new Map(metadata.records.map((record) => [record.tmdbPersonId, record]));
}

function correctionSource(record) {
  if (record.cropOverrideUsed) return "existing exact override";
  if (record.landscapeDefaultCropStatus === "active-tier-1-slight") return "new tier-1 default";
  if (record.landscapeDefaultCropStatus === "source-bound-maximum") return "source-bound maximum";
  if (record.landscapeDefaultCropStatus === "source-unavailable-fallback") return "source-unavailable fallback";
  return "unclassified";
}

export function classifyLandscapeResidualRisk(record, before = null) {
  const reasons = [];
  if (record.fallbackUsed) reasons.push("source-unavailable-fallback");
  if (record.landscapeDefaultCropStatus === "source-bound-maximum") reasons.push("source-bounds-limited-tier-1");
  if (!record.fallbackUsed && (record.sourceWidth < 600 || record.sourceHeight < 800)) reasons.push("low-resolution-source");
  if (!record.fallbackUsed && Number(record.upscaleFactor || 0) > 2) reasons.push("major-upscale-over-2x");
  if (!record.fallbackUsed && Number(record.cropRetainedAreaFraction || 1) < 0.67) reasons.push("especially-tight-source-crop");
  if (!record.fallbackUsed) {
    const right = Number(record.portraitBounds?.x || 0) + Number(record.portraitBounds?.width || 0);
    if (record.cropRectangle?.top !== 0 || record.portraitBounds?.y !== 0 || record.portraitBounds?.height !== 675 || right !== 1098) reasons.push("renderer-safety-geometry-failed");
    if (record.landscapeDefaultCropStatus === "active-tier-1-slight" && before && record.cropRectangle.height < Math.round(before.cropRectangle.height * 1.08)) reasons.push("tier-1-vertical-gain-below-8-percent");
  }
  return [...new Set(reasons)];
}

export async function renderPeopleV3LandscapeCorrection({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const baseline = await ensurePreservationBaseline(context);
  const [people, acquisition, originalPortrait, exactOverrides] = await Promise.all([
    effectivePeopleForDelta(context),
    readJson(path.join(context.root, "source-acquisition", "report.json")),
    readJson(path.join(context.root, "portrait-render", "report.json")),
    loadLandscapeCropOverrides({ registry: context.foundation.registry }),
  ]);
  assert(people.length === 663 && acquisition.records.length === 663 && originalPortrait.landscapeCount === 663 && originalPortrait.posterCount === 663, "The exact 663-identity staged correction boundary is incomplete.");
  assert(exactOverrides.configHash === EXACT_OVERRIDE_HASH && exactOverrides.config.recordCount === 167, "The exact Landscape override set or locked hash changed.");
  const acquisitionById = new Map(acquisition.records.map((record) => [record.tmdbPersonId, record]));
  const first = await renderCorrectionRun({ context, people, runName: "run-1", exactOverrides, acquisitionById });
  const second = await renderCorrectionRun({ context, people, runName: "run-2", exactOverrides, acquisitionById });
  const before = metadataMap({ records: originalPortrait.records.filter((record) => record.formatId === "landscape") });
  const firstById = metadataMap(first.metadata);
  const secondById = metadataMap(second.metadata);
  const records = people.map((person) => {
    const prior = before.get(person.tmdbPersonId);
    const revised = firstById.get(person.tmdbPersonId);
    const replayed = secondById.get(person.tmdbPersonId);
    assert(revised.outputHash === replayed.outputHash && revised.byteCount === replayed.byteCount && stableStringify(revised) === stableStringify(replayed), `${person.stableKey}: corrected Landscape replay differs.`);
    const source = correctionSource(revised);
    if (source === "existing exact override") {
      assert(revised.cropOverrideConfigHash === EXACT_OVERRIDE_HASH, `${person.stableKey}: exact override hash changed.`);
      assert(revised.outputHash === prior.outputHash && revised.byteCount === prior.byteCount, `${person.stableKey}: retained exact override changed output bytes.`);
    }
    if (source === "new tier-1 default" || source === "source-bound maximum") assert(revised.outputHash !== prior.outputHash, `${person.stableKey}: the default correction did not change rejected Landscape bytes.`);
    if (source === "source-unavailable fallback") assert(revised.outputHash === prior.outputHash && revised.byteCount === prior.byteCount, `${person.stableKey}: source-less fallback bytes changed.`);
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      correctionSource: source,
      changed: revised.outputHash !== prior.outputHash,
      before: prior,
      after: revised,
      residualRiskReasons: classifyLandscapeResidualRisk(revised, prior),
    };
  });
  const counts = {
    identities: records.length,
    tier1Default: records.filter((record) => record.correctionSource === "new tier-1 default").length,
    exactOverrides: records.filter((record) => record.correctionSource === "existing exact override").length,
    sourceBoundMaximum: records.filter((record) => record.correctionSource === "source-bound maximum").length,
    sourceUnavailableFallbacks: records.filter((record) => record.correctionSource === "source-unavailable fallback").length,
    changed: records.filter((record) => record.changed).length,
    unchanged: records.filter((record) => !record.changed).length,
    residualRisk: records.filter((record) => record.residualRiskReasons.length > 0).length,
  };
  assert(stableStringify(counts) === stableStringify({ identities: 663, tier1Default: 648, exactOverrides: 13, sourceBoundMaximum: 0, sourceUnavailableFallbacks: 2, changed: 648, unchanged: 15, residualRisk: counts.residualRisk }), "Corrected Landscape classification differs from the exact expected boundary.");
  const report = {
    version: PEOPLE_V3_LANDSCAPE_RERENDER_VERSION,
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    publicationAuthorised: false,
    policyId: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
    policyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    exactOverrideConfigHash: exactOverrides.configHash,
    exactOverrideRecordCount: exactOverrides.config.recordCount,
    ownerReviewFeedback: { previousCompleteLandscapeSetRequiresCorrection: true, identityCount: 663, zeroProposedOverridesMeansZeroVisibleConcern: false },
    counts,
    deterministicReplay: { byteIdentical: true, metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata), comparisonCount: records.length },
    originalLandscapeEvidence: baseline.originalLandscapes,
    run1: { root: relativeTo(context.root, first.outputRoot), metadata: relativeTo(context.root, first.written.jsonPath) },
    run2: { root: relativeTo(context.root, second.outputRoot), metadata: relativeTo(context.root, second.written.jsonPath) },
    revisedLandscapeByteCount: records.reduce((total, record) => total + record.after.byteCount, 0),
    records,
  };
  const reportPath = path.join(correctionRoot(context), "reports", "landscape-correction.json");
  await writeJson(reportPath, report);
  return { context, baseline, first, second, report, reportPath };
}

function existingManifestMetadata(publicManifest) {
  return publicManifest.records.flatMap((record) => FORMAT_ORDER.map((formatId) => ({
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    categoryMembership: record.categoryMembership,
    formatId,
    fallbackUsed: record.fallbackUsed,
    fallbackReason: record.fallbackReason,
    profilePathAttempted: record.resolvedProfilePath,
    sourceStatus: "published-source-preserved",
    sourceDecision: record.sourceDecision,
    sourceHash: record.sourceHash,
    sourceWidth: record.sourceDimensions?.width || null,
    sourceHeight: record.sourceDimensions?.height || null,
    presetId: record[`${formatId}PresetId`],
    presetHash: record[`${formatId}PresetHash`],
    fontHash: publicManifest.fontHash,
    outputHash: record[`${formatId}Hash`],
    byteCount: record[`${formatId}ByteCount`],
  })));
}

function candidateRuntimeRecord(record) {
  return {
    id: record.tmdbPersonId,
    name: record.canonicalName,
    categories: record.categoryMembership,
    status: "published",
    landscape: { path: record.landscapePath, sha256: record.landscapeHash },
    poster: { path: record.posterPath, sha256: record.posterHash },
    fallbackUsed: record.fallbackUsed,
    reviewRequired: false,
  };
}

async function writeCandidate(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await atomicWrite(filePath, bytes);
  return { path: filePath, byteCount: bytes.length, sha256: sha256(bytes) };
}

export async function buildPeopleV3LandscapeCorrectionCandidates({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const root = correctionRoot(context);
  const [correction, portrait, originalBundle] = await Promise.all([
    readJson(path.join(root, "reports", "landscape-correction.json")),
    readJson(path.join(context.root, "portrait-render", "report.json")),
    readJson(path.join(context.root, "candidate-manifests", "bundle-report.json")),
  ]);
  assert(correction.counts.identities === 663 && correction.deterministicReplay.byteIdentical, "A complete deterministic corrected Landscape run is required.");
  const correctedMetadata = await readJson(path.join(root, "render", "run-1", "render-metadata.json"));
  const posterRecords = portrait.records.filter((record) => record.formatId === "poster");
  const metadata = { version: "people-artwork-render-metadata-v1", ordering: "tmdb-person-id-ascending-then-format", recordCount: 0, records: [...existingManifestMetadata(context.publicManifest), ...correctedMetadata.records, ...posterRecords] };
  metadata.records.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId || FORMAT_ORDER.indexOf(left.formatId) - FORMAT_ORDER.indexOf(right.formatId));
  metadata.recordCount = metadata.records.length;
  assert(metadata.recordCount === 2960 && posterRecords.length === 663 && correctedMetadata.recordCount === 663, "Corrected candidate portrait metadata counts differ.");
  const manifest = await buildPeopleArtworkManifest({ people: context.people, foundation: context.foundation, metadata, publicationCandidateAt: context.workspace.generatedAt, distributionStatus: "publication-candidate", repoRoot: PEOPLE_ARTWORK_REPO_ROOT });
  manifest.ordering = "tmdb-person-id-ascending";
  const newIds = new Set(context.audit.records.map((record) => record.tmdbPersonId));
  for (const record of manifest.records) if (newIds.has(record.tmdbPersonId)) record.ownerReviewStatus = "revision-required";
  manifest.manifestFingerprint = calculateManifestFingerprint(manifest);
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: PEOPLE_ARTWORK_REPO_ROOT, expectedStableKeys: context.people.map((person) => person.stableKey) });
  assert(manifestValidation.valid && manifest.recordCount === 1480, `Corrected People manifest is invalid:\n${manifestValidation.errors.join("\n")}`);
  const candidateRoot = path.join(root, "candidate-manifests");
  const manifestFile = await writeCandidate(path.join(candidateRoot, "people-manifest.json"), manifest);
  const people = Object.fromEntries(manifest.records.map((record) => [String(record.tmdbPersonId), candidateRuntimeRecord(record)]));
  const runtime = {
    schemaVersion: 2,
    status: "published",
    fingerprint: null,
    generatedFrom: {
      studioNetworkManifest: structuredClone(context.currentRuntime.generatedFrom.studioNetworkManifest),
      peopleManifest: { path: "assets/collection_covers/people/manifest.json", sha256: manifestFile.sha256, fingerprint: manifest.manifestFingerprint },
    },
    counts: {
      companies: Object.keys(context.currentRuntime.companies).length,
      networks: Object.keys(context.currentRuntime.networks).length,
      people: Object.keys(people).length,
      totalEntities: Object.keys(context.currentRuntime.companies).length + Object.keys(context.currentRuntime.networks).length + Object.keys(people).length,
      landscapeAssets: Object.keys(context.currentRuntime.companies).length + Object.keys(context.currentRuntime.networks).length + Object.keys(people).length,
      posterAssets: Object.keys(context.currentRuntime.networks).length + Object.keys(people).length,
      totalAssets: Object.keys(context.currentRuntime.companies).length + (Object.keys(context.currentRuntime.networks).length * 2) + (Object.keys(people).length * 2),
    },
    formats: structuredClone(context.currentRuntime.formats),
    companies: structuredClone(context.currentRuntime.companies),
    networks: structuredClone(context.currentRuntime.networks),
    people,
  };
  runtime.fingerprint = calculateLookupFingerprint(runtime);
  const runtimeSchema = await readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "schemas", "artwork-runtime-lookup-v2.schema.json"));
  validateRuntimeLookup(runtime, runtimeSchema);
  assert(stableStringify(runtime.counts) === stableStringify({ companies: 1820, networks: 572, people: 1480, totalEntities: 3872, landscapeAssets: 3872, posterAssets: 2052, totalAssets: 5924 }), "Corrected runtime counts differ from the approved boundary.");
  const runtimeFile = await writeCandidate(path.join(candidateRoot, "runtime-lookup.json"), runtime);
  const originalPresentationPath = path.join(context.root, originalBundle.presentationManifest.path);
  const originalPresentationBytes = await fs.readFile(originalPresentationPath);
  const presentationPath = path.join(candidateRoot, "presentation-manifest.json");
  await atomicWrite(presentationPath, originalPresentationBytes);
  const presentation = JSON.parse(originalPresentationBytes);
  const [hero, presentationSchema] = await Promise.all([
    inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp }),
    loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT }),
  ]);
  const presentationErrors = validatePeoplePresentationManifest(presentation, presentationSchema, { expectedPeople: context.people, expectedHero: hero });
  assert(presentationErrors.length === 0, `Preserved presentation manifest is invalid:\n${presentationErrors.join("\n")}`);
  const presentationFile = { path: presentationPath, byteCount: originalPresentationBytes.length, sha256: sha256(originalPresentationBytes) };
  assert(presentationFile.sha256 === originalBundle.presentationManifest.sha256 && presentationFile.byteCount === originalBundle.presentationManifest.byteCount, "Presentation manifest is not byte-identical to the approved candidate.");
  const manifestRuntimeParity = manifest.records.every((record) => {
    const lookup = runtime.people[String(record.tmdbPersonId)];
    return lookup?.landscape.sha256 === record.landscapeHash && lookup?.poster.sha256 === record.posterHash;
  });
  assert(manifestRuntimeParity, "Corrected People manifest and runtime hashes differ.");
  const report = {
    version: "people-v3-landscape-correction-candidate-bundle-v1",
    generatedAt: context.workspace.generatedAt,
    peopleManifest: { ...manifestFile, path: relativeTo(root, manifestFile.path), fingerprint: manifest.manifestFingerprint, recordCount: manifest.recordCount, fallbackCount: manifest.fallbackCount },
    runtime: { ...runtimeFile, path: relativeTo(root, runtimeFile.path), fingerprint: runtime.fingerprint, counts: runtime.counts },
    presentationManifest: { ...presentationFile, path: relativeTo(root, presentationFile.path), fingerprint: presentation.manifestFingerprint, recordCount: presentation.recordCount, byteIdenticalToOriginalCandidate: true, originalSha256: originalBundle.presentationManifest.sha256 },
    sharedHero: hero,
    manifestRuntimeParity,
    noSecretsOrAbsolutePaths: !/(?:^|["'])[A-Za-z]:[\\/]|(?:TMDB_API_KEY|TMDB_API_READ_TOKEN|Authorization|Bearer\s+)/iu.test(JSON.stringify([manifest, runtime, presentation])),
  };
  assert(report.noSecretsOrAbsolutePaths, "Corrected candidate public JSON contains an absolute path or secret marker.");
  await writeJson(path.join(candidateRoot, "bundle-report.json"), report);
  const release = { version: "people-v3-landscape-correction-release-candidate-v1", generatedAt: context.workspace.generatedAt, status: "awaiting-owner-review-not-authorised", publicationAuthorised: false, candidateBundle: report, physicalInventory: null, validation: null };
  await writeJson(path.join(root, "release", "candidate-release-metadata.json"), release);
  return { context, root, manifest, runtime, presentation, report };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelSvg(width, height, lines, { warning = false } = {}) {
  const safe = lines.slice(0, 4);
  const text = safe.map((line, index) => `<text x="14" y="${24 + index * 20}" font-family="Arial, sans-serif" font-size="${index === 0 ? 17 : 14}" font-weight="${index === 0 ? 700 : 400}" fill="${index === 0 ? "#f3f3ef" : warning ? "#ffd08a" : "#b7b7b0"}">${escapeXml(line)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111315"/>${text}</svg>`);
}

async function composeSheet({ cells, columns, cellWidth, cellHeight, header, outputPath, runtime }) {
  const headerHeight = 58;
  const rows = Math.ceil(cells.length / columns);
  const width = columns * cellWidth;
  const height = headerHeight + rows * cellHeight;
  const composites = [{ input: labelSvg(width, headerHeight, [header]), left: 0, top: 0 }];
  for (const [index, cell] of cells.entries()) composites.push({ input: cell, left: (index % columns) * cellWidth, top: headerHeight + Math.floor(index / columns) * cellHeight });
  const bytes = await runtime.sharp({ create: { width, height, channels: 4, background: "#0d0f11" } }).composite(composites).png().toBuffer();
  await atomicWrite(outputPath, bytes);
  return { path: outputPath, sha256: sha256(bytes), byteCount: bytes.length, width, height, itemCount: cells.length };
}

async function renderPaged({ items, pageSize, columns, cellWidth, cellHeight, header, outputRoot, makeCell, runtime }) {
  const pages = [];
  for (let offset = 0, page = 1; offset < items.length; offset += pageSize, page += 1) {
    const pageItems = items.slice(offset, offset + pageSize);
    const cells = [];
    for (const item of pageItems) cells.push(await makeCell(item));
    pages.push(await composeSheet({ cells, columns, cellWidth, cellHeight, header: `${header} · page ${page}`, outputPath: path.join(outputRoot, `page-${String(page).padStart(3, "0")}.png`), runtime }));
  }
  const index = {
    version: "people-v3-landscape-correction-review-index-v1",
    generatedAt: null,
    title: header,
    itemCount: items.length,
    pageSize,
    pageCount: pages.length,
    pages,
  };
  return index;
}

function cropText(record) {
  const crop = record.cropRectangle;
  return crop ? `${crop.left},${crop.top},${crop.width}×${crop.height}` : "none";
}

function scaleText(record) {
  const scale = record.resizeScale;
  return scale ? `${Number(scale.x).toFixed(4)}×${Number(scale.y).toFixed(4)}` : "none";
}

async function standardCell({ imagePath, record, width, imageHeight, labelHeight, runtime, extra = [] }) {
  const image = await runtime.sharp(imagePath).resize(width, imageHeight, { fit: "fill", kernel: "cubic" }).toBuffer();
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 4, background: "#111315" } }).composite([
    { input: image, left: 0, top: 0 },
    { input: labelSvg(width, labelHeight, [`${record.tmdbPersonId} · ${record.canonicalName}`, ...extra]), left: 0, top: imageHeight },
  ]).png().toBuffer();
}

async function beforeAfterCell({ item, beforeRoot, afterRoot, runtime }) {
  const half = 480;
  const imageHeight = 270;
  const labelHeight = 96;
  const [before, after] = await Promise.all([
    runtime.sharp(path.join(beforeRoot, `${item.tmdbPersonId}.webp`)).resize(half, imageHeight, { fit: "fill", kernel: "cubic" }).toBuffer(),
    runtime.sharp(path.join(afterRoot, `${item.tmdbPersonId}.webp`)).resize(half, imageHeight, { fit: "fill", kernel: "cubic" }).toBuffer(),
  ]);
  const lines = [
    `${item.tmdbPersonId} · ${item.canonicalName} · ${item.correctionSource}`,
    `OLD crop ${cropText(item.before)} · scale ${scaleText(item.before)}`,
    `NEW crop ${cropText(item.after)} · scale ${scaleText(item.after)}`,
  ];
  return runtime.sharp({ create: { width: half * 2, height: imageHeight + labelHeight, channels: 4, background: "#111315" } }).composite([
    { input: before, left: 0, top: 0 },
    { input: after, left: half, top: 0 },
    { input: labelSvg(half, 34, ["OLD · rejected candidate"]), left: 0, top: 0 },
    { input: labelSvg(half, 34, ["REVISED · owner review candidate"]), left: half, top: 0 },
    { input: labelSvg(half * 2, labelHeight, lines), left: 0, top: imageHeight },
  ]).png().toBuffer();
}

async function chinZoneCell({ item, afterRoot, runtime }) {
  const width = 480;
  const imageHeight = 446;
  const labelHeight = 74;
  const focused = await runtime.sharp(path.join(afterRoot, `${item.tmdbPersonId}.webp`)).extract({ left: 480, top: 80, width: 640, height: 595 }).resize(width, imageHeight, { fit: "fill", kernel: "cubic" }).toBuffer();
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 4, background: "#111315" } }).composite([
    { input: focused, left: 0, top: 0 },
    { input: labelSvg(width, labelHeight, [`${item.tmdbPersonId} · ${item.canonicalName}`, `${item.correctionSource} · right portrait y=80…675`]), left: 0, top: imageHeight },
  ]).png().toBuffer();
}

async function writeReviewIndex(root, name, index) {
  index.generatedAt = (await readJson(path.join(root, "..", "..", "workspace.json"))).generatedAt;
  index.pages = index.pages.map((record) => ({ ...record, path: relativeTo(root, record.path) }));
  const indexPath = path.join(root, "review", "landscapes", name, "index.json");
  await writeJson(indexPath, index);
  return { ...index, indexPath };
}

export async function generatePeopleV3LandscapeCorrectionReviews({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const root = correctionRoot(context);
  const correction = await readJson(path.join(root, "reports", "landscape-correction.json"));
  const items = correction.records;
  assert(items.length === 663, "Complete corrected Landscape metadata is required for review generation.");
  const beforeRoot = path.join(context.root, "candidates", "people", "landscape");
  const afterRoot = path.join(root, "render", "run-1", "landscape");
  const reviewRoot = path.join(root, "review", "landscapes");
  const all = await renderPaged({
    items, pageSize: 64, columns: 8, cellWidth: 240, cellHeight: 199, header: "All 663 revised People v3 Landscapes · exact overrides / tier-1 default / source bounds", outputRoot: path.join(reviewRoot, "all-v3"), runtime: context.runtime,
    makeCell: (item) => standardCell({ imagePath: path.join(afterRoot, `${item.tmdbPersonId}.webp`), record: item.after, width: 240, imageHeight: 135, labelHeight: 64, runtime: context.runtime, extra: [item.correctionSource] }),
  });
  const changed = items.filter((item) => item.changed);
  const beforeAfter = await renderPaged({
    items: changed, pageSize: 8, columns: 2, cellWidth: 960, cellHeight: 366, header: "People v3 Landscape before / after · all changed candidates", outputRoot: path.join(reviewRoot, "before-after-v1"), runtime: context.runtime,
    makeCell: (item) => beforeAfterCell({ item, beforeRoot, afterRoot, runtime: context.runtime }),
  });
  const chinZone = await renderPaged({
    items, pageSize: 16, columns: 4, cellWidth: 480, cellHeight: 520, header: "People v3 revised Landscape chin-zone review · all 663 identities", outputRoot: path.join(reviewRoot, "chin-zone-v1"), runtime: context.runtime,
    makeCell: (item) => chinZoneCell({ item, afterRoot, runtime: context.runtime }),
  });
  const residualItems = items.filter((item) => item.residualRiskReasons.length > 0);
  const residual = await renderPaged({
    items: residualItems, pageSize: 32, columns: 4, cellWidth: 480, cellHeight: 356, header: "People v3 revised Landscape residual risk · complete-set geometry and source QA", outputRoot: path.join(reviewRoot, "residual-risk-v1"), runtime: context.runtime,
    makeCell: (item) => standardCell({ imagePath: path.join(afterRoot, `${item.tmdbPersonId}.webp`), record: item.after, width: 480, imageHeight: 270, labelHeight: 86, runtime: context.runtime, extra: [item.residualRiskReasons.join(" · ")] }),
  });
  const [allIndex, beforeAfterIndex, chinZoneIndex, residualIndex] = await Promise.all([
    writeReviewIndex(root, "all-v3", all),
    writeReviewIndex(root, "before-after-v1", beforeAfter),
    writeReviewIndex(root, "chin-zone-v1", chinZone),
    writeReviewIndex(root, "residual-risk-v1", residual),
  ]);
  const report = {
    version: "people-v3-landscape-correction-review-package-v1",
    generatedAt: context.workspace.generatedAt,
    all: { itemCount: allIndex.itemCount, index: relativeTo(root, allIndex.indexPath) },
    beforeAfter: { itemCount: beforeAfterIndex.itemCount, index: relativeTo(root, beforeAfterIndex.indexPath) },
    chinZone: { itemCount: chinZoneIndex.itemCount, index: relativeTo(root, chinZoneIndex.indexPath) },
    residualRisk: { itemCount: residualIndex.itemCount, index: relativeTo(root, residualIndex.indexPath), identities: residualItems.map(({ tmdbPersonId, canonicalName, residualRiskReasons }) => ({ tmdbPersonId, canonicalName, reasons: residualRiskReasons })) },
    allIdentitiesExaminedForResidualRisk: items.length,
    zeroProposedOverridesInterpretedAsZeroConcern: false,
    externalComputerVisionUsed: false,
    alternateSourcesUsed: false,
    generatedPortraitAssetsModifiedForReview: false,
  };
  await writeJson(path.join(root, "review", "index.json"), report);
  return { context, root, report, allIndex, beforeAfterIndex, chinZoneIndex, residualIndex };
}

async function validatePhysical({ filePath, expectedHash, expectedBytes, format, width, height, runtime }) {
  const evidence = await fileEvidence(filePath, runtime.sharp);
  return { valid: evidence.sha256 === expectedHash && evidence.byteCount === expectedBytes && evidence.format === format && evidence.width === width && evidence.height === height, path: relativeTo(PEOPLE_ARTWORK_REPO_ROOT, filePath), evidence };
}

export async function buildPeopleV3LandscapeCorrectionPhysicalInventory({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const root = correctionRoot(context);
  const bundle = await readJson(path.join(root, "candidate-manifests", "bundle-report.json"));
  const [manifest, presentation, title] = await Promise.all([
    readJson(path.join(root, bundle.peopleManifest.path)),
    readJson(path.join(root, bundle.presentationManifest.path)),
    latestTitleRun(context),
  ]);
  const publicIds = new Set(context.publicManifest.records.map((record) => record.tmdbPersonId));
  const portraits = [];
  for (const record of manifest.records) {
    for (const formatId of FORMAT_ORDER) {
      const isPublic = publicIds.has(record.tmdbPersonId);
      const filePath = isPublic
        ? path.join(PEOPLE_ARTWORK_REPO_ROOT, record[`${formatId}Path`])
        : formatId === "landscape"
          ? path.join(root, "render", "run-1", "landscape", `${record.tmdbPersonId}.webp`)
          : path.join(context.root, "candidates", "people", "poster", `${record.tmdbPersonId}.webp`);
      const dimensions = formatId === "landscape" ? [1200, 675] : [1000, 1500];
      portraits.push({ stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, formatId, source: isPublic ? "protected-public" : formatId === "landscape" ? "revised-candidate" : "approved-candidate-poster", ...(await validatePhysical({ filePath, expectedHash: record[`${formatId}Hash`], expectedBytes: record[`${formatId}ByteCount`], format: "webp", width: dimensions[0], height: dimensions[1], runtime: context.runtime })) });
    }
  }
  const titleLogos = [];
  for (const record of presentation.records) {
    const filePath = path.join(title.run1, "individual", `${record.tmdbPersonId}.png`);
    titleLogos.push({ stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, ...(await validatePhysical({ filePath, expectedHash: record.titleLogoSha256, expectedBytes: record.byteCount, format: "png", width: 1863, height: 673, runtime: context.runtime })) });
  }
  const report = {
    version: "people-v3-landscape-correction-physical-inventory-v1",
    generatedAt: context.workspace.generatedAt,
    valid: portraits.every((record) => record.valid) && titleLogos.every((record) => record.valid),
    counts: {
      portraits: portraits.length,
      protectedPortraits: portraits.filter((record) => record.source === "protected-public").length,
      revisedLandscapes: portraits.filter((record) => record.source === "revised-candidate").length,
      approvedCandidatePosters: portraits.filter((record) => record.source === "approved-candidate-poster").length,
      titleLogos: titleLogos.length,
    },
    inventoryFingerprint: sha256(Buffer.from(stableStringify([...portraits, ...titleLogos].map((record) => ({ stableKey: record.stableKey, formatId: record.formatId || "title-logo", path: record.path, sha256: record.evidence.sha256, byteCount: record.evidence.byteCount }))))),
    portraits,
    titleLogos,
  };
  assert(report.valid && stableStringify(report.counts) === stableStringify({ portraits: 2960, protectedPortraits: 1634, revisedLandscapes: 663, approvedCandidatePosters: 663, titleLogos: 1480 }), "Corrected physical inventory failed or counts differ.");
  const reportPath = path.join(root, "candidate-manifests", "physical-file-inventory.json");
  await writeJson(reportPath, report);
  const releasePath = path.join(root, "release", "candidate-release-metadata.json");
  const release = await readJson(releasePath);
  release.physicalInventory = { path: relativeTo(root, reportPath), sha256: sha256(await fs.readFile(reportPath)), fingerprint: report.inventoryFingerprint, counts: report.counts };
  await writeJson(releasePath, release);
  return { context, root, report, reportPath };
}

function compareProtected(before, after) {
  const groups = {};
  for (const key of Object.keys(before)) groups[key] = stableStringify(before[key]) === stableStringify(after[key]);
  return { unchanged: Object.values(groups).every(Boolean), groups };
}

export async function validatePeopleV3LandscapeCorrection({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const root = correctionRoot(context);
  const [baseline, correction, bundle, physical, review, exactOverrides, protectedAfter, postersAfter, landscapesAfter, titlesAfter, originalPresentationAfter] = await Promise.all([
    readJson(path.join(root, "validation", "preservation-before.json")),
    readJson(path.join(root, "reports", "landscape-correction.json")),
    readJson(path.join(root, "candidate-manifests", "bundle-report.json")),
    readJson(path.join(root, "candidate-manifests", "physical-file-inventory.json")),
    readJson(path.join(root, "review", "index.json")),
    loadLandscapeCropOverrides({ registry: context.foundation.registry }),
    capturePeopleV3ProtectedState({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp }),
    treeEvidence(path.join(context.root, "candidates", "people", "poster")),
    treeEvidence(path.join(context.root, "candidates", "people", "landscape")),
    treeEvidence(path.join(context.root, "title-logos")),
    fileEvidence(path.join(context.root, "candidate-manifests", "presentation-manifest.json")),
  ]);
  const [manifest, runtime, presentation, presentationBytes, originalPresentationBytes] = await Promise.all([
    readJson(path.join(root, bundle.peopleManifest.path)),
    readJson(path.join(root, bundle.runtime.path)),
    readJson(path.join(root, bundle.presentationManifest.path)),
    fs.readFile(path.join(root, bundle.presentationManifest.path)),
    fs.readFile(path.join(context.root, "candidate-manifests", "presentation-manifest.json")),
  ]);
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: PEOPLE_ARTWORK_REPO_ROOT, expectedStableKeys: context.people.map((person) => person.stableKey) });
  const runtimeSchema = await readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "schemas", "artwork-runtime-lookup-v2.schema.json"));
  validateRuntimeLookup(runtime, runtimeSchema);
  const presentationSchema = await loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT });
  const hero = await inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp });
  const presentationErrors = validatePeoplePresentationManifest(presentation, presentationSchema, { expectedPeople: context.people, expectedHero: hero });
  const protectedParity = compareProtected(baseline.protectedState, protectedAfter);
  const manifestRuntimeParity = manifest.records.every((record) => runtime.people[String(record.tmdbPersonId)]?.landscape.sha256 === record.landscapeHash && runtime.people[String(record.tmdbPersonId)]?.poster.sha256 === record.posterHash);
  const checks = {
    exactScope: correction.counts.identities === 663 && correction.counts.tier1Default === 648 && correction.counts.exactOverrides === 13 && correction.counts.sourceBoundMaximum === 0 && correction.counts.sourceUnavailableFallbacks === 2,
    exactOverrides: exactOverrides.configHash === EXACT_OVERRIDE_HASH && exactOverrides.config.recordCount === 167,
    deterministicReplay: correction.deterministicReplay.byteIdentical && correction.deterministicReplay.metadataIdentical && correction.deterministicReplay.comparisonCount === 663,
    peopleManifest: manifestValidation.valid && manifest.recordCount === 1480,
    runtime: runtime.schemaVersion === 2 && runtime.counts.people === 1480 && runtime.counts.totalEntities === 3872 && runtime.counts.totalAssets === 5924,
    manifestRuntimeParity,
    presentation: presentationErrors.length === 0 && Buffer.compare(presentationBytes, originalPresentationBytes) === 0 && originalPresentationAfter.sha256 === baseline.presentationCandidate.sha256,
    physicalInventory: physical.valid && physical.counts.revisedLandscapes === 663 && physical.counts.approvedCandidatePosters === 663 && physical.counts.titleLogos === 1480,
    reviewPackage: review.all.itemCount === 663 && review.beforeAfter.itemCount === correction.counts.changed && review.chinZone.itemCount === 663 && review.allIdentitiesExaminedForResidualRisk === 663,
    posterCandidatesPreserved: sameTree(baseline.posters, postersAfter),
    originalLandscapeEvidencePreserved: sameTree(baseline.originalLandscapes, landscapesAfter),
    titleEvidencePreserved: sameTree(baseline.titleEvidence, titlesAfter),
    protectedPublishedArtwork: protectedParity.unchanged,
    sharedHero: stableStringify(hero) === stableStringify(protectedAfter.hero),
  };
  const report = {
    version: "people-v3-landscape-correction-validation-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    valid: Object.values(checks).every(Boolean),
    checks,
    manifestErrors: manifestValidation.errors,
    presentationErrors,
    protectedParity,
    preservation: { posters: sameTree(baseline.posters, postersAfter), originalLandscapes: sameTree(baseline.originalLandscapes, landscapesAfter), titles: sameTree(baseline.titleEvidence, titlesAfter), presentationOriginal: originalPresentationAfter.sha256 === baseline.presentationCandidate.sha256 },
    counts: correction.counts,
    residualRisk: review.residualRisk,
  };
  assert(report.valid, `Corrected Landscape validation failed:\n${Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => `- ${name}`).join("\n")}`);
  const reportPath = path.join(root, "validation", "final-validation.json");
  await Promise.all([writeJson(path.join(root, "validation", "protected-after.json"), protectedAfter), writeJson(reportPath, report)]);
  const releasePath = path.join(root, "release", "candidate-release-metadata.json");
  const release = await readJson(releasePath);
  release.validation = { path: relativeTo(root, reportPath), sha256: sha256(await fs.readFile(reportPath)), valid: report.valid, checks: report.checks };
  await writeJson(releasePath, release);
  return { context, root, report, reportPath, manifest, runtime, presentation };
}

async function directorySummary(root) {
  const files = await recursiveFiles(root);
  let byteCount = 0;
  for (const filePath of files) byteCount += (await fs.stat(filePath)).size;
  return { fileCount: files.length, byteCount };
}

export async function updatePeopleV3LandscapeCorrectionPlan({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot: assertPeopleV3ProofPath(runRoot) });
  const root = correctionRoot(context);
  const [validation, bundle, correction, review, release, posterSummary, landscapeSummary, title] = await Promise.all([
    readJson(path.join(root, "validation", "final-validation.json")),
    readJson(path.join(root, "candidate-manifests", "bundle-report.json")),
    readJson(path.join(root, "reports", "landscape-correction.json")),
    readJson(path.join(root, "review", "index.json")),
    readJson(path.join(root, "release", "candidate-release-metadata.json")),
    directorySummary(path.join(context.root, "candidates", "people", "poster")),
    directorySummary(path.join(root, "render", "run-1", "landscape")),
    latestTitleRun(context),
  ]);
  assert(validation.valid, "The corrected atomic-publication plan requires a valid staged candidate set.");
  const [titleSummary, candidateSummary, currentManifest, currentRuntime] = await Promise.all([
    directorySummary(path.join(title.run1, "individual")),
    directorySummary(path.join(root, "candidate-manifests")),
    fs.stat(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "people", "manifest.json")),
    fs.stat(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "runtime-lookup.json")),
  ]);
  const replacementMetadataDeltaBytes = (bundle.peopleManifest.byteCount - currentManifest.size) + (bundle.runtime.byteCount - currentRuntime.size) + bundle.presentationManifest.byteCount;
  const growth = {
    newPosterFiles: posterSummary.fileCount,
    newPosterBytes: posterSummary.byteCount,
    newLandscapeFiles: landscapeSummary.fileCount,
    newLandscapeBytes: landscapeSummary.byteCount,
    newPortraitFiles: posterSummary.fileCount + landscapeSummary.fileCount,
    newPortraitBytes: posterSummary.byteCount + landscapeSummary.byteCount,
    titleLogoFiles: titleSummary.fileCount,
    titleLogoBytes: titleSummary.byteCount,
    candidateMetadataFiles: candidateSummary.fileCount,
    candidateMetadataBytes: candidateSummary.byteCount,
    replacementMetadataDeltaBytes,
    projectedRepositoryGrowthBytes: posterSummary.byteCount + landscapeSummary.byteCount + titleSummary.byteCount + replacementMetadataDeltaBytes,
  };
  const plan = {
    version: "people-v3-atomic-publication-plan-v3-chin-safe-candidates",
    generatedAt: context.workspace.generatedAt,
    updatedAt: currentIso(),
    status: "awaiting-owner-review-and-explicit-publication-authorisation",
    publicationAuthorised: false,
    workspace: relativeTo(PEOPLE_ARTWORK_REPO_ROOT, root),
    correctionCounts: correction.counts,
    candidateFiles: bundle,
    physicalInventory: release.physicalInventory,
    releaseMetadata: { path: "release/candidate-release-metadata.json", status: release.status },
    actualGrowth: growth,
    reviewPackage: review,
    protectedParity: validation.protectedParity,
    preconditions: [
      "Dave reviews every all-v3, before/after, chin-zone and residual-risk Landscape page",
      "all revised Landscape hashes and unchanged Poster/title/public hashes are revalidated",
      "Dave separately and explicitly authorises permanent publication",
    ],
    publicationOrder: [
      { step: 1, action: "freeze the reviewed 663 revised Landscape hashes and the already approved Poster/title hashes", permanentWrites: 0 },
      { step: 2, action: "revalidate protected public bytes and all staged source/output bindings", permanentWrites: 0 },
      { step: 3, action: "prepare a same-filesystem transaction containing 663 Posters, 663 revised Landscapes and 1,480 title logos", permanentWrites: 0 },
      { step: 4, action: "validate the 1,480-record People, runtime and byte-preserved presentation candidates", permanentWrites: 0 },
      { step: 5, action: "install only the 2,806 reviewed new files without rewriting 817 published pairs or the shared hero", permanentWrites: 2806 },
      { step: 6, action: "atomically replace People/runtime metadata and add the presentation manifest", permanentMetadataWrites: 3 },
      { step: 7, action: "run permanent physical, runtime, presentation and protected-hash validation", permanentWrites: 0 },
    ],
    rollback: {
      beforeMetadata: "remove only transaction files; permanent state remains untouched",
      afterAssetInstall: "remove only the 2,806 new ID-bound files from the validated install inventory",
      afterMetadata: "restore the three metadata snapshots, remove only the new files, and revalidate all protected hashes",
      existing817Pairs: "never overwritten or recompressed",
      sharedHero: "never rewritten",
    },
    planFingerprint: null,
  };
  plan.planFingerprint = sha256(Buffer.from(stableStringify({ ...plan, planFingerprint: null })));
  const planRoot = path.join(root, "plans");
  const planPath = path.join(planRoot, "atomic-publication-plan.actual.json");
  const markdownPath = path.join(planRoot, "atomic-publication-plan.actual.md");
  await Promise.all([
    writeJson(planPath, plan),
    atomicWrite(markdownPath, `# Nuvio People v3 chin-safe candidate publication plan\n\nStatus: **awaiting owner review and separate publication authorisation**.\n\n- ${growth.newPosterFiles} approved Poster candidates (${growth.newPosterBytes.toLocaleString("en-US")} bytes)\n- ${growth.newLandscapeFiles} revised Landscape candidates (${growth.newLandscapeBytes.toLocaleString("en-US")} bytes)\n- ${growth.titleLogoFiles} approved title logos (${growth.titleLogoBytes.toLocaleString("en-US")} bytes)\n- Projected repository growth: ${growth.projectedRepositoryGrowthBytes.toLocaleString("en-US")} bytes\n\nNo publication is authorised by this plan.\n`),
  ]);
  return { context, root, plan, planPath, markdownPath };
}

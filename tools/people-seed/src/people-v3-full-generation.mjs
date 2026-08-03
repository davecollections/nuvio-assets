import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { calculateLookupFingerprint, validateRuntimeLookup } from "../../artwork-runtime-lookup/src/runtime-lookup.mjs";
import {
  buildPeopleArtworkManifest,
  calculateManifestFingerprint,
  stableStringify,
  validatePeopleArtworkManifest,
} from "./people-publication.mjs";
import {
  TITLE_LOGO_DESIGN_ID,
  assertPeopleV3ProofPath,
  compareTitleLogoReplay,
  loadTitleLogoConfiguration,
  validateTitleLogoMetadata,
} from "./people-artwork/title-logo.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { loadLandscapeCropOverrides } from "./people-artwork/landscape-crop-overrides.mjs";
import { resolvePortraitSource } from "./people-artwork/source-resolution.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import {
  buildPeoplePresentationManifest,
  inspectSharedPeopleHero,
  loadPeoplePresentationManifestSchema,
  validatePeoplePresentationManifest,
} from "./people-presentation-manifest.mjs";
import {
  buildPeopleV3ArtworkReadinessAudit,
  capturePeopleV3ProtectedState,
  validatePeopleV3ArtworkReadinessAudit,
} from "./people-v3-artwork-readiness.mjs";
import { readPeopleFoundation } from "./people-validation.mjs";

export const PEOPLE_V3_FULL_GENERATION_VERSION = "people-v3-full-generation-v1";
const PROFILE_PATH = /^\/[A-Za-z0-9_-]+\.jpg$/u;
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);

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

function posixRelative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function categoryMembership(tmdbPersonId, actorIds, directorIds) {
  return ["actor", "director"].filter((category) => category === "actor" ? actorIds.has(tmdbPersonId) : directorIds.has(tmdbPersonId));
}

function currentIso() {
  return new Date().toISOString();
}

function workspacePath(runRoot, ...segments) {
  return path.join(assertPeopleV3ProofPath(runRoot), ...segments);
}

async function fileEvidence(filePath, sharp = null) {
  const bytes = await fs.readFile(filePath);
  const evidence = { byteCount: bytes.length, sha256: sha256(bytes) };
  if (sharp) {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    evidence.format = metadata.format;
    evidence.width = metadata.width;
    evidence.height = metadata.height;
    evidence.channels = metadata.channels;
    evidence.hasAlpha = metadata.hasAlpha;
  }
  return evidence;
}

async function checkpointRecords(directory) {
  if (!(await exists(directory))) return [];
  const names = (await fs.readdir(directory)).filter((name) => /^[1-9][0-9]*\.json$/u.test(name)).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  return Promise.all(names.map((name) => readJson(path.join(directory, name))));
}

async function writeCheckpoint(directory, tmdbPersonId, value) {
  return writeJson(path.join(directory, `${tmdbPersonId}.json`), value);
}

export async function initialiseFullGenerationWorkspace({ runRoot, generatedAt, runtime: providedRuntime = null } = {}) {
  const root = assertPeopleV3ProofPath(runRoot);
  assert(!(await exists(root)), `Full-generation workspace already exists; use resume modes instead: ${root}`);
  await fs.mkdir(root, { recursive: true });
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const [foundation, publicManifest, decisions, currentRuntime, protectedState] = await Promise.all([
    readPeopleFoundation(PEOPLE_ARTWORK_REPO_ROOT),
    readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "people", "manifest.json")),
    readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "data", "people", "portrait-source-decisions.json")),
    readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "runtime-lookup.json")),
    capturePeopleV3ProtectedState({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp }),
  ]);
  const audit = await buildPeopleV3ArtworkReadinessAudit({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, generatedAt, runtime });
  const errors = validatePeopleV3ArtworkReadinessAudit(audit);
  assert(errors.length === 0, `Full-generation readiness failed:\n${errors.join("\n")}`);
  const actorIds = new Set(foundation.actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(foundation.directors.records.map((record) => record.tmdbPersonId));
  const people = foundation.registry.records.map((record) => ({
    ...record,
    categoryMembership: categoryMembership(record.tmdbPersonId, actorIds, directorIds),
  }));
  const workspace = {
    version: PEOPLE_V3_FULL_GENERATION_VERSION,
    generatedAt,
    status: "staged-generation-in-progress",
    publicationAuthorised: false,
    ordering: "tmdb-person-id-ascending",
    catalogueCounts: { people: people.length, actors: foundation.actors.records.length, directors: foundation.directors.records.length, overlaps: people.filter((person) => person.categoryMembership.length === 2).length },
    expected: { catalogueOnly: audit.recordCount, trackedProfilePaths: audit.summary.usableProfilePaths, missingProfilePaths: audit.summary.missingProfilePaths, titleLogos: people.length },
    publicBoundary: { peopleManifestRecords: publicManifest.recordCount, runtimePeople: currentRuntime.counts.people },
    rendererVersions: { ...runtime.versions, pango: runtime.sharp.versions.pango },
  };
  await Promise.all([
    writeJson(path.join(root, "workspace.json"), workspace),
    writeJson(path.join(root, "readiness", "audit.json"), audit),
    writeJson(path.join(root, "validation", "protected-before.json"), protectedState),
    writeJson(path.join(root, "inputs", "people.json"), { version: "people-v3-full-generation-selection-v1", recordCount: people.length, records: people }),
    writeJson(path.join(root, "inputs", "portrait-decisions.json"), decisions),
  ]);
  return { root, workspace, audit, foundation, publicManifest, currentRuntime, protectedState, people, decisions };
}

export async function loadFullGenerationContext({ runRoot, runtime: providedRuntime = null } = {}) {
  const root = assertPeopleV3ProofPath(runRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const [workspace, audit, selection, decisions, foundation, publicManifest, currentRuntime] = await Promise.all([
    readJson(path.join(root, "workspace.json")),
    readJson(path.join(root, "readiness", "audit.json")),
    readJson(path.join(root, "inputs", "people.json")),
    readJson(path.join(root, "inputs", "portrait-decisions.json")),
    readPeopleFoundation(PEOPLE_ARTWORK_REPO_ROOT),
    readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "people", "manifest.json")),
    readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "runtime-lookup.json")),
  ]);
  assert(workspace.version === PEOPLE_V3_FULL_GENERATION_VERSION && selection.recordCount === 1480 && audit.recordCount === 663, "Full-generation workspace identity or exact scope is invalid.");
  return { root, runtime, workspace, audit, people: selection.records, decisions, foundation, publicManifest, currentRuntime };
}

function tmdbCredential() {
  const readToken = process.env.TMDB_API_READ_TOKEN?.trim() || process.env.TMDB_READ_ACCESS_TOKEN?.trim() || "";
  const apiKey = process.env.TMDB_API_KEY?.trim() || "";
  if (readToken) return { kind: "bearer", value: readToken };
  if (apiKey) return { kind: "api-key", value: apiKey };
  return null;
}

async function fetchTmdbDetails({ person, credential, attempts, fetchImpl = fetch, retryDelay = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
  const base = `https://api.themoviedb.org/3/person/${person.tmdbPersonId}?language=en-US`;
  const url = credential.kind === "api-key" ? `${base}&api_key=${encodeURIComponent(credential.value)}` : base;
  const publicUrl = base;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: credential.kind === "bearer" ? { Authorization: `Bearer ${credential.value}`, Accept: "application/json" } : { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      attempts.push({ attempt, endpoint: publicUrl, status: response.status, outcome: response.ok ? "response-received" : "http-invalid" });
      if (!response.ok) {
        if (TRANSIENT_HTTP.has(response.status) && attempt < 2) { await retryDelay(attempt * 350); continue; }
        return { valid: false, reason: "tmdb-details-http-invalid", status: response.status };
      }
      const details = await response.json();
      if (details?.id !== person.tmdbPersonId || typeof details?.name !== "string" || !details.name.trim()) return { valid: false, reason: "tmdb-details-identity-invalid", details: { id: details?.id ?? null, name: details?.name ?? null, profile_path: details?.profile_path ?? null } };
      if (details.profile_path !== null && !PROFILE_PATH.test(details.profile_path)) return { valid: false, reason: "tmdb-details-profile-path-invalid", details: { id: details.id, name: details.name, profile_path: details.profile_path } };
      return { valid: true, details: { id: details.id, name: details.name, profile_path: details.profile_path } };
    } catch (error) {
      attempts.push({ attempt, endpoint: publicUrl, status: null, outcome: "request-failed", error: error.message });
      if (attempt < 2) { await retryDelay(attempt * 350); continue; }
      return { valid: false, reason: "tmdb-details-request-failed", error: error.message };
    }
  }
  return { valid: false, reason: "tmdb-details-request-failed" };
}

export async function refreshMissingProfileMetadata({ runRoot, fetchImpl = fetch } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const credential = tmdbCredential();
  assert(credential, "TMDB_API_READ_TOKEN, TMDB_READ_ACCESS_TOKEN, or TMDB_API_KEY is required for exact-ID missing-profile refresh; no credential value is written to evidence.");
  const directory = workspacePath(context.root, "profile-refresh", "checkpoints");
  const missing = context.audit.records.filter((record) => record.missingTrackedProfilePath).map((record) => context.people.find((person) => person.tmdbPersonId === record.tmdbPersonId));
  for (const person of missing) {
    const checkpoint = path.join(directory, `${person.tmdbPersonId}.json`);
    if (await exists(checkpoint)) continue;
    const attempts = [];
    const result = await fetchTmdbDetails({ person, credential, attempts, fetchImpl });
    const record = {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      retrievedAt: currentIso(),
      endpoint: `https://api.themoviedb.org/3/person/${person.tmdbPersonId}?language=en-US`,
      exactNumericIdVerified: result.valid,
      returnedName: result.details?.name || null,
      recoveredProfilePath: result.valid && result.details.profile_path ? result.details.profile_path : null,
      status: result.valid ? result.details.profile_path ? "recovered" : "still-missing" : "failed",
      failureReason: result.valid ? null : result.reason,
      attempts,
    };
    await writeCheckpoint(directory, person.tmdbPersonId, record);
  }
  const records = await checkpointRecords(directory);
  const report = {
    version: "people-v3-profile-refresh-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    credentialKind: credential.kind,
    credentialPersisted: false,
    selectedCount: missing.length,
    recoveredCount: records.filter((record) => record.status === "recovered").length,
    stillMissingCount: records.filter((record) => record.status === "still-missing").length,
    failedCount: records.filter((record) => record.status === "failed").length,
    invalidResponseCount: records.filter((record) => record.failureReason?.includes("invalid")).length,
    records,
  };
  assert(records.length === missing.length, "Missing-profile refresh checkpoints are incomplete.");
  await writeJson(path.join(context.root, "profile-refresh", "report.json"), report);
  return { context, report };
}

async function effectivePeopleForDelta(context) {
  const refreshPath = path.join(context.root, "profile-refresh", "report.json");
  const refresh = await exists(refreshPath) ? await readJson(refreshPath) : null;
  const refreshById = new Map((refresh?.records || []).map((record) => [record.tmdbPersonId, record]));
  return context.audit.records.map((auditRecord) => {
    const person = context.people.find((record) => record.tmdbPersonId === auditRecord.tmdbPersonId);
    const recovered = refreshById.get(person.tmdbPersonId)?.recoveredProfilePath || null;
    return { ...person, profilePath: person.profilePath || recovered, trackedProfilePath: person.profilePath, recoveredProfilePath: recovered };
  });
}

function decisionsForEffectivePerson(person, decisions) {
  if (person.profilePath === person.trackedProfilePath) return decisions;
  return { ...decisions, recordCount: decisions.records.filter((record) => record.stableKey !== person.stableKey).length, records: decisions.records.filter((record) => record.stableKey !== person.stableKey) };
}

export async function acquireFullGenerationSources({ runRoot, fetchImpl = fetch } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const people = await effectivePeopleForDelta(context);
  const sourceCache = path.join(context.root, "source-cache");
  const directory = path.join(context.root, "source-acquisition", "checkpoints");
  for (const person of people) {
    const checkpoint = path.join(directory, `${person.tmdbPersonId}.json`);
    if (await exists(checkpoint)) continue;
    const retrievedAt = currentIso();
    const source = await resolvePortraitSource({
      person,
      decisions: decisionsForEffectivePerson(person, context.decisions),
      sourceCache,
      offline: false,
      sharp: context.runtime.sharp,
      fetchImpl,
    });
    await writeCheckpoint(directory, person.tmdbPersonId, {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      trackedProfilePath: person.trackedProfilePath,
      recoveredProfilePath: person.recoveredProfilePath,
      relativeProfilePath: source.profilePathAttempted,
      retrievedAt,
      sourceStatus: source.sourceStatus,
      validationStatus: source.available ? "valid" : "unavailable",
      fallbackReason: source.fallbackReason,
      sourceDimensions: source.available ? { width: source.width, height: source.height } : null,
      sourceFormat: source.available ? source.format : null,
      byteCount: source.available ? source.byteCount : null,
      sha256: source.available ? source.sourceHash : null,
      cacheFile: source.cacheEntry?.sourceFile || null,
      rawCacheFile: source.cacheEntry?.rawFile || null,
      sourceUrl: source.cacheEntry?.sourceUrl || null,
      retryHistory: source.attempts,
    });
  }
  const records = await checkpointRecords(directory);
  const report = {
    version: "people-v3-full-source-acquisition-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    selectedCount: people.length,
    validSourceCount: records.filter((record) => record.validationStatus === "valid").length,
    unavailableCount: records.filter((record) => record.validationStatus !== "valid").length,
    trackedPathCount: records.filter((record) => record.trackedProfilePath).length,
    recoveredPathCount: records.filter((record) => record.recoveredProfilePath).length,
    imageCdnAttemptCount: records.flatMap((record) => record.retryHistory).length,
    records,
  };
  assert(records.length === people.length, "Source acquisition checkpoints are incomplete.");
  await writeJson(path.join(context.root, "source-acquisition", "report.json"), report);
  return { context, people, sourceCache, report };
}

async function validPortraitCheckpoint(checkpointPath, outputRoot, runtime) {
  if (!(await exists(checkpointPath))) return false;
  const checkpoint = await readJson(checkpointPath);
  if (checkpoint.status !== "rendered" || checkpoint.records?.length !== 2) return checkpoint.status === "unresolved";
  for (const record of checkpoint.records) {
    const filePath = path.join(outputRoot, record.outputPath);
    if (!(await exists(filePath))) return false;
    const evidence = await fileEvidence(filePath, runtime.sharp);
    const expected = record.formatId === "landscape" ? ["webp", 1200, 675] : ["webp", 1000, 1500];
    if (evidence.sha256 !== record.outputHash || evidence.byteCount !== record.byteCount || evidence.format !== expected[0] || evidence.width !== expected[1] || evidence.height !== expected[2]) return false;
  }
  return true;
}

export async function renderFullGenerationPortraits({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const people = await effectivePeopleForDelta(context);
  const acquisition = await readJson(path.join(context.root, "source-acquisition", "report.json"));
  const acquisitionById = new Map(acquisition.records.map((record) => [record.tmdbPersonId, record]));
  const outputRoot = path.join(context.root, "candidates", "people");
  const checkpointRoot = path.join(context.root, "portrait-render", "checkpoints");
  const sourceCache = path.join(context.root, "source-cache");
  for (const person of people) {
    const checkpointPath = path.join(checkpointRoot, `${person.tmdbPersonId}.json`);
    if (await validPortraitCheckpoint(checkpointPath, outputRoot, context.runtime)) continue;
    const sourceEvidence = acquisitionById.get(person.tmdbPersonId);
    try {
      const result = await renderPeopleArtwork({
        people: [person],
        decisions: decisionsForEffectivePerson(person, context.decisions),
        sourceCache,
        outputDir: outputRoot,
        format: "both",
        offline: true,
        runtime: context.runtime,
      });
      for (const record of result.metadata.records) {
        if (record.fallbackUsed && sourceEvidence?.fallbackReason) {
          record.fallbackReason = sourceEvidence.fallbackReason;
          record.sourceStatus = sourceEvidence.sourceStatus;
          record.profilePathAttempted = sourceEvidence.relativeProfilePath;
        }
      }
      await writeJson(checkpointPath, {
        version: "people-v3-portrait-render-checkpoint-v1",
        status: "rendered",
        renderedAt: currentIso(),
        stableKey: person.stableKey,
        tmdbPersonId: person.tmdbPersonId,
        records: result.metadata.records,
      });
    } catch (error) {
      await writeJson(checkpointPath, {
        version: "people-v3-portrait-render-checkpoint-v1",
        status: "unresolved",
        renderedAt: currentIso(),
        stableKey: person.stableKey,
        tmdbPersonId: person.tmdbPersonId,
        canonicalName: person.canonicalName,
        reason: "fallback-or-render-failed",
        error: error.message,
        records: [],
      });
    }
  }
  const checkpoints = await checkpointRecords(checkpointRoot);
  const records = checkpoints.flatMap((checkpoint) => checkpoint.records || []);
  const unresolved = checkpoints.filter((checkpoint) => checkpoint.status === "unresolved");
  const report = {
    version: "people-v3-full-portrait-render-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    selectedPersonCount: people.length,
    renderedPersonCount: checkpoints.filter((checkpoint) => checkpoint.status === "rendered").length,
    outputCount: records.length,
    landscapeCount: records.filter((record) => record.formatId === "landscape").length,
    posterCount: records.filter((record) => record.formatId === "poster").length,
    fallbackPersonCount: new Set(records.filter((record) => record.fallbackUsed).map((record) => record.tmdbPersonId)).size,
    unresolvedCount: unresolved.length,
    records,
    unresolved,
  };
  await writeJson(path.join(context.root, "portrait-render", "report.json"), report);
  return { context, people, outputRoot, report };
}

async function nextReplayRoot(root) {
  const titleRoot = path.join(root, "title-logos");
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(titleRoot, `replay-${String(index).padStart(2, "0")}`);
    if (!(await exists(candidate))) return candidate;
    if (await exists(path.join(candidate, "replay.json"))) return candidate;
  }
  throw new Error("No title-logo replay workspace remains.");
}

async function validateTitleRun(run, people) {
  const metadataPath = path.join(run, "renderer-metadata.json");
  if (!(await exists(metadataPath))) return null;
  const metadata = await readJson(metadataPath);
  const errors = validateTitleLogoMetadata(metadata, people);
  if (errors.length) return null;
  for (const record of metadata.records) {
    const filePath = path.join(run, "individual", `${record.tmdbPersonId}.png`);
    if (!(await exists(filePath))) return null;
    const bytes = await fs.readFile(filePath);
    if (bytes.length !== record.byteCount || sha256(bytes) !== record.outputHash) return null;
  }
  return { outputDir: run, metadataPath, metadata };
}

async function renderTitleRunInFreshProcess({ context, outputDir }) {
  const workerPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "tools", "people-seed", "scripts", "people-title-logo-proof-worker.mjs");
  const selectionPath = path.join(context.root, "inputs", "people.json");
  const { stdout } = await execFileAsync(process.execPath, [
    workerPath,
    "--output-dir", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, outputDir),
    "--generated-at", context.workspace.generatedAt,
    "--people-json", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, selectionPath),
  ], { cwd: PEOPLE_ARTWORK_REPO_ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const processEvidence = JSON.parse(stdout);
  assert(processEvidence.freshProcess === true && Number.isInteger(processEvidence.workerPid), "Title-logo worker did not return fresh-process evidence.");
  await writeJson(path.join(outputDir, "fresh-process.json"), processEvidence);
  const run = await validateTitleRun(outputDir, context.people);
  assert(run, `Fresh-process title-logo run failed validation: ${outputDir}`);
  return { ...run, processEvidence };
}

export async function renderFullGenerationTitleLogos({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const configuration = await loadTitleLogoConfiguration({ registry: context.foundation.registry });
  assert(configuration.preset.design.id === TITLE_LOGO_DESIGN_ID && configuration.preset.design.clearGap === 60, "Full generation requires the production-locked exact 60 px title-logo design.");
  const replayRoot = await nextReplayRoot(context.root);
  await fs.mkdir(replayRoot, { recursive: true });
  const run1Path = path.join(replayRoot, "run-1");
  const run2Path = path.join(replayRoot, "run-2");
  const existingRun1 = await validateTitleRun(run1Path, context.people);
  const existingRun2 = await validateTitleRun(run2Path, context.people);
  const run1 = existingRun1 || await renderTitleRunInFreshProcess({ context, outputDir: run1Path });
  const run2 = existingRun2 || await renderTitleRunInFreshProcess({ context, outputDir: run2Path });
  const processEvidence = {
    run1: run1.processEvidence || await readJson(path.join(run1Path, "fresh-process.json")),
    run2: run2.processEvidence || await readJson(path.join(run2Path, "fresh-process.json")),
  };
  const replay = compareTitleLogoReplay(run1, run2);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.length === 1480 && replay.comparisons.every((record) => record.byteIdentical), "Complete title-logo replay is not byte-identical.");
  const report = {
    version: "people-v3-full-title-logo-replay-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    presetId: configuration.preset.id,
    presetHash: configuration.presetHash,
    designId: TITLE_LOGO_DESIGN_ID,
    clearGap: 60,
    personCount: run1.metadata.personCount,
    outputCountPerRun: run1.metadata.recordCount,
    byteIdentical: replay.byteIdentical,
    metadataIdentical: replay.metadataIdentical,
    freshProcessReplay: processEvidence.run1.freshProcess === true && processEvidence.run2.freshProcess === true,
    workerPids: [processEvidence.run1.workerPid, processEvidence.run2.workerPid],
    comparisons: replay.comparisons,
  };
  await writeJson(path.join(replayRoot, "replay.json"), report);
  await writeJson(path.join(context.root, "title-logos", "latest.json"), { replayRoot: posixRelative(context.root, replayRoot), report: posixRelative(context.root, path.join(replayRoot, "replay.json")) });
  return { context, replayRoot, run1, run2, report };
}

function existingManifestMetadata(publicManifest) {
  return publicManifest.records.flatMap((record) => ["landscape", "poster"].map((formatId) => ({
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

async function latestTitleLogoRun(context) {
  const latest = await readJson(path.join(context.root, "title-logos", "latest.json"));
  const replayRoot = path.join(context.root, latest.replayRoot);
  const run1 = await validateTitleRun(path.join(replayRoot, "run-1"), context.people);
  const run2 = await validateTitleRun(path.join(replayRoot, "run-2"), context.people);
  assert(run1 && run2, "Validated complete title-logo replay runs are required.");
  const replay = compareTitleLogoReplay(run1, run2);
  assert(replay.byteIdentical && replay.metadataIdentical, "Latest title-logo replay is not deterministic.");
  return { replayRoot, run1, run2, replay };
}

function candidatePersonRuntimeRecord(record) {
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

async function writeCandidateFile(filePath, value) {
  const serialised = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWrite(filePath, serialised);
  return { path: filePath, byteCount: Buffer.byteLength(serialised), sha256: sha256(Buffer.from(serialised)) };
}

export async function buildFullGenerationCandidates({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const portraitReport = await readJson(path.join(context.root, "portrait-render", "report.json"));
  assert(portraitReport.renderedPersonCount === 663 && portraitReport.outputCount === 1326 && portraitReport.unresolvedCount === 0, "Complete 663-person portrait-pair staging is required before candidate manifests.");
  const title = await latestTitleLogoRun(context);
  const metadata = { version: "people-artwork-render-metadata-v1", ordering: "tmdb-person-id-ascending-then-format", recordCount: 0, records: [...existingManifestMetadata(context.publicManifest), ...portraitReport.records] };
  metadata.records.sort((left, right) => left.tmdbPersonId - right.tmdbPersonId || ["landscape", "poster"].indexOf(left.formatId) - ["landscape", "poster"].indexOf(right.formatId));
  metadata.recordCount = metadata.records.length;
  assert(metadata.recordCount === 2960, "Combined candidate portrait metadata must contain exactly 2,960 format records.");
  const candidateAt = context.workspace.generatedAt;
  const manifest = await buildPeopleArtworkManifest({ people: context.people, foundation: context.foundation, metadata, publicationCandidateAt: candidateAt, distributionStatus: "publication-candidate", repoRoot: PEOPLE_ARTWORK_REPO_ROOT });
  manifest.ordering = "tmdb-person-id-ascending";
  const newIds = new Set(context.audit.records.map((record) => record.tmdbPersonId));
  for (const record of manifest.records) if (newIds.has(record.tmdbPersonId)) record.ownerReviewStatus = "revision-required";
  manifest.manifestFingerprint = calculateManifestFingerprint(manifest);
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: PEOPLE_ARTWORK_REPO_ROOT, expectedStableKeys: context.people.map((person) => person.stableKey) });
  assert(manifestValidation.valid, `Candidate People manifest failed validation:\n${manifestValidation.errors.join("\n")}`);
  assert(manifest.recordCount === 1480 && manifest.landscapeCount === 1480 && manifest.posterCount === 1480, "Candidate People manifest counts are incomplete.");
  const candidateRoot = path.join(context.root, "candidate-manifests");
  const peopleManifestPath = path.join(candidateRoot, "people-manifest.json");
  const peopleFile = await writeCandidateFile(peopleManifestPath, manifest);

  const people = Object.fromEntries(manifest.records.map((record) => [String(record.tmdbPersonId), candidatePersonRuntimeRecord(record)]));
  const runtime = {
    schemaVersion: 2,
    status: "published",
    fingerprint: null,
    generatedFrom: {
      studioNetworkManifest: structuredClone(context.currentRuntime.generatedFrom.studioNetworkManifest),
      peopleManifest: { path: "assets/collection_covers/people/manifest.json", sha256: peopleFile.sha256, fingerprint: manifest.manifestFingerprint },
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
  assert(stableStringify(runtime.counts) === stableStringify({ companies: 1820, networks: 572, people: 1480, totalEntities: 3872, landscapeAssets: 3872, posterAssets: 2052, totalAssets: 5924 }), "Candidate runtime counts differ from the approved boundary.");
  const runtimeFile = await writeCandidateFile(path.join(candidateRoot, "runtime-lookup.json"), runtime);

  const [sharedHero, presentationSchema] = await Promise.all([
    inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp }),
    loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT }),
  ]);
  const presentation = buildPeoplePresentationManifest({ titleLogoMetadata: title.run1.metadata, titleLogoDesignId: TITLE_LOGO_DESIGN_ID, permanentSelection: true, sharedHero, generatedAt: candidateAt, status: "publication-candidate" });
  const presentationErrors = validatePeoplePresentationManifest(presentation, presentationSchema, { expectedPeople: context.people, expectedHero: sharedHero });
  assert(presentationErrors.length === 0, `Candidate presentation manifest failed validation:\n${presentationErrors.join("\n")}`);
  assert(presentation.recordCount === 1480 && presentation.titleLogoCount === 1480, "Candidate presentation manifest counts are incomplete.");
  const presentationFile = await writeCandidateFile(path.join(candidateRoot, "presentation-manifest.json"), presentation);

  const publicJson = [manifest, runtime, presentation];
  const unsafePatterns = [/[A-Za-z]:[\\/]/u, /(?:TMDB_API_KEY|TMDB_API_READ_TOKEN|Authorization|Bearer\s+)/iu];
  const unsafe = publicJson.flatMap((value, index) => unsafePatterns.filter((pattern) => pattern.test(JSON.stringify(value))).map((pattern) => ({ documentIndex: index, pattern: String(pattern) })));
  assert(unsafe.length === 0, "Candidate public JSON contains an absolute local path or secret marker.");
  const report = {
    version: "people-v3-candidate-manifest-bundle-v1",
    generatedAt: candidateAt,
    peopleManifest: { ...peopleFile, path: posixRelative(context.root, peopleFile.path), fingerprint: manifest.manifestFingerprint, recordCount: manifest.recordCount, fallbackCount: manifest.fallbackCount },
    runtime: { ...runtimeFile, path: posixRelative(context.root, runtimeFile.path), fingerprint: runtime.fingerprint, counts: runtime.counts },
    presentationManifest: { ...presentationFile, path: posixRelative(context.root, presentationFile.path), fingerprint: presentation.manifestFingerprint, recordCount: presentation.recordCount },
    sharedHero,
    noSecretsOrAbsolutePaths: true,
  };
  await writeJson(path.join(candidateRoot, "bundle-report.json"), report);
  return { context, title, manifest, runtime, presentation, report };
}

async function validateCandidateFile({ filePath, expectedHash, expectedBytes, format, width, height, runtime }) {
  const evidence = await fileEvidence(filePath, runtime.sharp);
  return {
    valid: evidence.sha256 === expectedHash && evidence.byteCount === expectedBytes && evidence.format === format && evidence.width === width && evidence.height === height,
    filePath,
    evidence,
  };
}

export async function validateFullGenerationPhysicalFiles({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const bundle = await readJson(path.join(context.root, "candidate-manifests", "bundle-report.json"));
  const manifest = await readJson(path.join(context.root, bundle.peopleManifest.path));
  const presentation = await readJson(path.join(context.root, bundle.presentationManifest.path));
  const publicIds = new Set(context.publicManifest.records.map((record) => record.tmdbPersonId));
  const portraitRoot = path.join(context.root, "candidates", "people");
  const title = await latestTitleLogoRun(context);
  const records = [];
  for (const record of manifest.records) {
    for (const formatId of ["landscape", "poster"]) {
      const permanent = publicIds.has(record.tmdbPersonId);
      const filePath = permanent
        ? path.join(PEOPLE_ARTWORK_REPO_ROOT, record[`${formatId}Path`])
        : path.join(portraitRoot, formatId, `${record.tmdbPersonId}.webp`);
      const dimensions = formatId === "landscape" ? [1200, 675] : [1000, 1500];
      records.push({ stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, formatId, source: permanent ? "protected-public" : "ignored-candidate", ...(await validateCandidateFile({ filePath, expectedHash: record[`${formatId}Hash`], expectedBytes: record[`${formatId}ByteCount`], format: "webp", width: dimensions[0], height: dimensions[1], runtime: context.runtime })) });
    }
  }
  const titleRecords = [];
  for (const record of presentation.records) {
    const filePath = path.join(title.run1.outputDir, "individual", `${record.tmdbPersonId}.png`);
    titleRecords.push({ stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, ...(await validateCandidateFile({ filePath, expectedHash: record.titleLogoSha256, expectedBytes: record.byteCount, format: "png", width: 1863, height: 673, runtime: context.runtime })) });
  }
  const report = {
    version: "people-v3-candidate-physical-validation-v1",
    generatedAt: context.workspace.generatedAt,
    valid: records.every((record) => record.valid) && titleRecords.every((record) => record.valid),
    portraitRecordCount: records.length,
    protectedPortraitRecordCount: records.filter((record) => record.source === "protected-public").length,
    candidatePortraitRecordCount: records.filter((record) => record.source === "ignored-candidate").length,
    titleLogoRecordCount: titleRecords.length,
    records,
    titleRecords,
  };
  assert(report.valid && report.portraitRecordCount === 2960 && report.protectedPortraitRecordCount === 1634 && report.candidatePortraitRecordCount === 1326 && report.titleLogoRecordCount === 1480, "Candidate physical-file validation failed or counts differ.");
  await writeJson(path.join(context.root, "validation", "candidate-physical-files.json"), report);
  return { context, report };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function checkerboardSvg(width, height) {
  const size = 18;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="${size * 2}" height="${size * 2}" patternUnits="userSpaceOnUse"><rect width="${size * 2}" height="${size * 2}" fill="#d7d7d7"/><rect width="${size}" height="${size}" fill="#f3f3f3"/><rect x="${size}" y="${size}" width="${size}" height="${size}" fill="#f3f3f3"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`);
}

function labelSvg(width, height, primary, secondary, { warning = false } = {}) {
  const secondaryMarkup = secondary ? `<text x="12" y="${height - 10}" font-family="Arial, sans-serif" font-size="13" fill="${warning ? "#ffb1a8" : "#aaaeb4"}">${escapeXml(secondary)}</text>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111419"/><text x="12" y="22" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#f5f4ef">${escapeXml(primary)}</text>${secondaryMarkup}</svg>`);
}

async function reviewCell({ item, width, mediaHeight, labelHeight, fit, background, runtime }) {
  const source = await runtime.sharp(item.filePath, { failOn: "error" }).resize({ width: width - 12, height: mediaHeight - 12, fit, position: "centre", kernel: "cubic", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const metadata = await runtime.sharp(source).metadata();
  const base = background === "checkerboard"
    ? checkerboardSvg(width, mediaHeight)
    : { create: { width, height: mediaHeight, channels: 4, background: background || "#181b20" } };
  const media = await runtime.sharp(base).composite([{ input: source, left: Math.round((width - metadata.width) / 2), top: Math.round((mediaHeight - metadata.height) / 2) }]).png().toBuffer();
  const label = labelSvg(width, labelHeight, item.primary, item.secondary, { warning: item.warning });
  return runtime.sharp({ create: { width, height: mediaHeight + labelHeight, channels: 4, background: "#111419" } }).composite([{ input: media, left: 0, top: 0 }, { input: label, left: 0, top: mediaHeight }]).png().toBuffer();
}

async function validSheetIndex(indexPath, root) {
  if (!(await exists(indexPath))) return null;
  const index = await readJson(indexPath);
  for (const page of index.pages || []) {
    const filePath = path.join(root, page.path);
    if (!(await exists(filePath))) return null;
    const bytes = await fs.readFile(filePath);
    if (bytes.length !== page.byteCount || sha256(bytes) !== page.sha256) return null;
  }
  return index;
}

async function renderReviewGroup({ root, groupRelativePath, title, items, columns, rows, cellWidth, mediaHeight, labelHeight, fit = "cover", background = "#181b20", runtime }) {
  const groupRoot = path.join(root, groupRelativePath);
  const indexPath = path.join(groupRoot, "index.json");
  const existing = await validSheetIndex(indexPath, root);
  if (existing && existing.itemCount === items.length) return existing;
  await fs.mkdir(groupRoot, { recursive: true });
  const pageSize = columns * rows;
  const pages = [];
  for (let offset = 0; offset < items.length; offset += pageSize) {
    const pageItems = items.slice(offset, offset + pageSize);
    const cells = [];
    for (const item of pageItems) cells.push(await reviewCell({ item, width: cellWidth, mediaHeight, labelHeight, fit, background, runtime }));
    const headerHeight = 64;
    const cellHeight = mediaHeight + labelHeight;
    const width = columns * cellWidth;
    const height = headerHeight + rows * cellHeight;
    const composites = [{ input: labelSvg(width, headerHeight, `${title} · page ${pages.length + 1}`, `${items.length} identities · labels are outside assets`), left: 0, top: 0 }];
    for (const [index, cell] of cells.entries()) composites.push({ input: cell, left: (index % columns) * cellWidth, top: headerHeight + Math.floor(index / columns) * cellHeight });
    const output = await runtime.sharp({ create: { width, height, channels: 4, background: "#0c0f13" } }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const pagePath = path.join(groupRoot, `page-${String(pages.length + 1).padStart(3, "0")}.png`);
    await atomicWrite(pagePath, output);
    pages.push({ path: posixRelative(root, pagePath), sha256: sha256(output), byteCount: output.length, width, height, itemCount: pageItems.length });
  }
  const index = { version: "people-v3-review-sheet-index-v1", generatedAt: (await readJson(path.join(root, "workspace.json"))).generatedAt, title, itemCount: items.length, pageSize, pageCount: pages.length, pages };
  await writeJson(indexPath, index);
  return index;
}

function portraitRiskGroups(portraitReport) {
  const landscapes = portraitReport.records.filter((record) => record.formatId === "landscape");
  const people = new Map(portraitReport.records.map((record) => [record.tmdbPersonId, record]));
  const fallbackIds = [...new Set(portraitReport.records.filter((record) => record.fallbackUsed).map((record) => record.tmdbPersonId))];
  const majorUpscales = landscapes.filter((record) => Number(record.upscaleFactor || 0) > 2);
  const lowResolution = landscapes.filter((record) => !record.fallbackUsed && (record.sourceWidth < 800 || record.sourceHeight < 800));
  const unusualAspect = landscapes.filter((record) => !record.fallbackUsed && (record.sourceWidth / record.sourceHeight < 0.45 || record.sourceWidth / record.sourceHeight > 1));
  const tightCrop = landscapes.filter((record) => !record.fallbackUsed && Number(record.cropRetainedAreaFraction || 1) < 0.7);
  const highRisk = [...new Map([...majorUpscales, ...lowResolution, ...unusualAspect, ...tightCrop].map((record) => [record.tmdbPersonId, record])).values()].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  return { people, fallbackIds, majorUpscales, lowResolution, unusualAspect, tightCrop, highRisk };
}

function titleItem(person, filePath, record) {
  return { filePath, primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: `${record.presentationLines.length} line${record.presentationLines.length === 1 ? "" : "s"} · ${record.finalFontSize}px · gap ${record.verticalGap}px`, warning: false };
}

function portraitItem(person, filePath, record, flags = []) {
  const fallback = record?.fallbackUsed ? `fallback: ${record.fallbackReason}` : null;
  const risk = [...flags, fallback].filter(Boolean).join(" · ");
  return { filePath, primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: risk || `${record?.sourceWidth || "?"}×${record?.sourceHeight || "?"} source`, warning: Boolean(risk) };
}

export async function generateFullGenerationTitleLogoReview({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const title = await latestTitleLogoRun(context);
  const titleById = new Map(title.run1.metadata.records.map((record) => [record.tmdbPersonId, record]));
  const itemFor = (person) => titleItem(person, path.join(title.run1.outputDir, "individual", `${person.tmdbPersonId}.png`), titleById.get(person.tmdbPersonId));
  const titleItems = context.people.map(itemFor);
  const longest = [...context.people].sort((left, right) => [...right.canonicalName].length - [...left.canonicalName].length || left.tmdbPersonId - right.tmdbPersonId).slice(0, 64);
  const punctuation = context.people.filter((person) => /[^\x20-\x7e]|['’.-]/u.test(person.canonicalName));
  const groups = {};
  groups.titleCheckerboard = await renderReviewGroup({ root: context.root, groupRelativePath: "review/title-logos/checkerboard", title: "All production title logos · checkerboard", items: titleItems, columns: 4, rows: 8, cellWidth: 360, mediaHeight: 150, labelHeight: 54, fit: "inside", background: "checkerboard", runtime: context.runtime });
  groups.titleDark = await renderReviewGroup({ root: context.root, groupRelativePath: "review/title-logos/neutral-dark", title: "All production title logos · neutral dark", items: titleItems, columns: 4, rows: 8, cellWidth: 360, mediaHeight: 150, labelHeight: 54, fit: "inside", background: "#181b20", runtime: context.runtime });
  groups.titleLongest = await renderReviewGroup({ root: context.root, groupRelativePath: "review/title-logos/longest-names", title: "Title-logo longest-name subset", items: longest.map(itemFor), columns: 4, rows: 8, cellWidth: 360, mediaHeight: 150, labelHeight: 54, fit: "inside", background: "#181b20", runtime: context.runtime });
  groups.titlePunctuation = await renderReviewGroup({ root: context.root, groupRelativePath: "review/title-logos/punctuation-accents", title: "Title-logo punctuation and accent subset", items: punctuation.map(itemFor), columns: 4, rows: 8, cellWidth: 360, mediaHeight: 150, labelHeight: 54, fit: "inside", background: "#181b20", runtime: context.runtime });
  const report = { version: "people-v3-title-logo-owner-review-v1", generatedAt: context.workspace.generatedAt, groups };
  await writeJson(path.join(context.root, "review", "title-logos", "index.json"), report);
  return { context, title, groups, report };
}

export async function generateFullGenerationReviewPackage({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const portraitReport = await readJson(path.join(context.root, "portrait-render", "report.json"));
  const sourceReport = await readJson(path.join(context.root, "source-acquisition", "report.json"));
  const refreshReport = await readJson(path.join(context.root, "profile-refresh", "report.json"));
  const risks = portraitRiskGroups(portraitReport);
  const peopleById = new Map(context.people.map((person) => [person.tmdbPersonId, person]));
  const metadataByIdFormat = new Map(portraitReport.records.map((record) => [`${record.tmdbPersonId}:${record.formatId}`, record]));
  const deltaPeople = context.audit.records.map((record) => peopleById.get(record.tmdbPersonId));
  const portraitItems = (formatId, selectedPeople = deltaPeople, flagFor = () => []) => selectedPeople.map((person) => portraitItem(person, path.join(context.root, "candidates", "people", formatId, `${person.tmdbPersonId}.webp`), metadataByIdFormat.get(`${person.tmdbPersonId}:${formatId}`), flagFor(person)));
  const titleReview = await generateFullGenerationTitleLogoReview({ runRoot: context.root });
  const groups = { ...titleReview.groups };
  const flagsFor = (person) => {
    const flags = [];
    if (risks.majorUpscales.some((record) => record.tmdbPersonId === person.tmdbPersonId)) flags.push("upscale >2×");
    if (risks.lowResolution.some((record) => record.tmdbPersonId === person.tmdbPersonId)) flags.push("low resolution");
    if (risks.tightCrop.some((record) => record.tmdbPersonId === person.tmdbPersonId)) flags.push("tight crop");
    if (risks.unusualAspect.some((record) => record.tmdbPersonId === person.tmdbPersonId)) flags.push("unusual aspect");
    return flags;
  };
  groups.posters = await renderReviewGroup({ root: context.root, groupRelativePath: "review/posters/all", title: "All 663 new Poster candidates", items: portraitItems("poster", deltaPeople, flagsFor), columns: 8, rows: 8, cellWidth: 180, mediaHeight: 270, labelHeight: 54, runtime: context.runtime });
  groups.landscapes = await renderReviewGroup({ root: context.root, groupRelativePath: "review/landscapes/all", title: "All 663 new Landscape candidates", items: portraitItems("landscape", deltaPeople, flagsFor), columns: 8, rows: 8, cellWidth: 240, mediaHeight: 135, labelHeight: 54, runtime: context.runtime });
  const selectedByIds = (ids) => ids.map((id) => peopleById.get(id)).filter(Boolean);
  const recoveredPeople = selectedByIds(refreshReport.records.filter((record) => record.status === "recovered").map((record) => record.tmdbPersonId));
  const missingPeople = selectedByIds(refreshReport.records.filter((record) => record.status === "still-missing").map((record) => record.tmdbPersonId));
  const fallbackPeople = selectedByIds(risks.fallbackIds);
  const unresolvedPeople = selectedByIds(portraitReport.unresolved.map((record) => record.tmdbPersonId));
  const highRiskPeople = selectedByIds(risks.highRisk.map((record) => record.tmdbPersonId));
  const majorPeople = selectedByIds(risks.majorUpscales.map((record) => record.tmdbPersonId));
  const lowPeople = selectedByIds(risks.lowResolution.map((record) => record.tmdbPersonId));
  groups.recovered = await renderReviewGroup({ root: context.root, groupRelativePath: "review/sources/recovered", title: "Newly recovered exact-ID profile paths", items: portraitItems("poster", recoveredPeople, () => ["recovered via exact TMDB details ID"]), columns: 8, rows: 8, cellWidth: 180, mediaHeight: 270, labelHeight: 54, runtime: context.runtime });
  groups.stillMissing = await renderReviewGroup({ root: context.root, groupRelativePath: "review/sources/still-missing", title: "Still-missing exact-ID sources", items: portraitItems("poster", missingPeople, () => ["still missing after TMDB details refresh"]), columns: 8, rows: 8, cellWidth: 180, mediaHeight: 270, labelHeight: 54, runtime: context.runtime });
  groups.fallbacks = await renderReviewGroup({ root: context.root, groupRelativePath: "review/exceptions/fallbacks", title: "Fallback candidates · owner review required", items: portraitItems("poster", fallbackPeople, () => ["fallback candidate"]), columns: 8, rows: 8, cellWidth: 180, mediaHeight: 270, labelHeight: 54, runtime: context.runtime });
  groups.unresolved = await renderReviewGroup({ root: context.root, groupRelativePath: "review/exceptions/unresolved", title: "Unresolved identities", items: portraitItems("poster", unresolvedPeople, () => ["unresolved"]), columns: 8, rows: 8, cellWidth: 180, mediaHeight: 270, labelHeight: 54, runtime: context.runtime });
  groups.highRiskCrops = await renderReviewGroup({ root: context.root, groupRelativePath: "review/landscapes/high-risk", title: "High-risk Landscape crop candidates", items: portraitItems("landscape", highRiskPeople, flagsFor), columns: 8, rows: 8, cellWidth: 240, mediaHeight: 135, labelHeight: 54, runtime: context.runtime });
  groups.majorUpscales = await renderReviewGroup({ root: context.root, groupRelativePath: "review/quality/major-upscales", title: "Major upscale candidates", items: portraitItems("landscape", majorPeople, flagsFor), columns: 8, rows: 8, cellWidth: 240, mediaHeight: 135, labelHeight: 54, runtime: context.runtime });
  groups.lowResolution = await renderReviewGroup({ root: context.root, groupRelativePath: "review/quality/low-resolution", title: "Low-resolution source candidates", items: portraitItems("landscape", lowPeople, flagsFor), columns: 8, rows: 8, cellWidth: 240, mediaHeight: 135, labelHeight: 54, runtime: context.runtime });
  const overlapPeople = context.people.filter((person) => person.categoryMembership.length === 2);
  const publicIds = new Set(context.publicManifest.records.map((record) => record.tmdbPersonId));
  const overlapItems = overlapPeople.map((person) => ({ filePath: publicIds.has(person.tmdbPersonId) ? path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "people", "poster", `${person.tmdbPersonId}.webp`) : path.join(context.root, "candidates", "people", "poster", `${person.tmdbPersonId}.webp`), primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: "actor + director", warning: false }));
  groups.overlaps = await renderReviewGroup({ root: context.root, groupRelativePath: "review/overlaps", title: "All nine Actor/Director overlaps", items: overlapItems, columns: 3, rows: 3, cellWidth: 240, mediaHeight: 360, labelHeight: 54, runtime: context.runtime });
  const reports = {
    recoveredProfilePaths: refreshReport.records.filter((record) => record.status === "recovered"),
    stillMissingSources: refreshReport.records.filter((record) => record.status !== "recovered"),
    fallbackIdentities: sourceReport.records.filter((record) => risks.fallbackIds.includes(record.tmdbPersonId)),
    unresolvedIdentities: portraitReport.unresolved,
    majorUpscales: risks.majorUpscales,
    lowResolution: risks.lowResolution,
    highRiskCrops: risks.highRisk,
    proposedCropOverrides: [],
    overlaps: overlapPeople.map((person) => ({ tmdbPersonId: person.tmdbPersonId, canonicalName: person.canonicalName, categories: person.categoryMembership })),
  };
  for (const [name, records] of Object.entries(reports)) await writeJson(path.join(context.root, "reports", `${name}.json`), { version: `people-v3-${name}-report-v1`, generatedAt: context.workspace.generatedAt, recordCount: records.length, records });
  const report = { version: "people-v3-owner-review-package-v1", generatedAt: context.workspace.generatedAt, groups, reportCounts: Object.fromEntries(Object.entries(reports).map(([name, records]) => [name, records.length])) };
  await writeJson(path.join(context.root, "review", "index.json"), report);
  return { context, groups, reports, report };
}

function compareProtectedState(before, after) {
  const groups = {};
  for (const key of ["people", "companies", "networks", "runtimeLookup", "collectionManifest", "hero"]) groups[key] = stableStringify(before[key]) === stableStringify(after[key]);
  return { unchanged: Object.values(groups).every(Boolean), groups };
}

async function recursiveFiles(root) {
  if (!(await exists(root))) return [];
  const output = [];
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  };
  await visit(root);
  return output.sort((left, right) => left.localeCompare(right));
}

async function byteSummary(paths) {
  const files = (await Promise.all(paths.map((root) => recursiveFiles(root)))).flat();
  const records = [];
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    records.push({ filePath, byteCount: stat.size });
  }
  return { fileCount: records.length, byteCount: records.reduce((sum, record) => sum + record.byteCount, 0) };
}

export async function validateFullGeneration({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const [bundle, portrait, source, refresh, review, physical, protectedBefore, protectedAfter, title, cropOverrides] = await Promise.all([
    readJson(path.join(context.root, "candidate-manifests", "bundle-report.json")),
    readJson(path.join(context.root, "portrait-render", "report.json")),
    readJson(path.join(context.root, "source-acquisition", "report.json")),
    readJson(path.join(context.root, "profile-refresh", "report.json")),
    readJson(path.join(context.root, "review", "index.json")),
    readJson(path.join(context.root, "validation", "candidate-physical-files.json")),
    readJson(path.join(context.root, "validation", "protected-before.json")),
    capturePeopleV3ProtectedState({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp }),
    latestTitleLogoRun(context),
    loadLandscapeCropOverrides(),
  ]);
  const manifest = await readJson(path.join(context.root, bundle.peopleManifest.path));
  const runtime = await readJson(path.join(context.root, bundle.runtime.path));
  const presentation = await readJson(path.join(context.root, bundle.presentationManifest.path));
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: PEOPLE_ARTWORK_REPO_ROOT, expectedStableKeys: context.people.map((person) => person.stableKey) });
  const runtimeSchema = await readJson(path.join(PEOPLE_ARTWORK_REPO_ROOT, "schemas", "artwork-runtime-lookup-v2.schema.json"));
  validateRuntimeLookup(runtime, runtimeSchema);
  const presentationSchema = await loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT });
  const hero = await inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: context.runtime.sharp });
  const presentationErrors = validatePeoplePresentationManifest(presentation, presentationSchema, { expectedPeople: context.people, expectedHero: hero });
  const protectedParity = compareProtectedState(protectedBefore, protectedAfter);
  const overlapIds = context.people.filter((person) => person.categoryMembership.length === 2).map((person) => person.tmdbPersonId);
  const titleReplay = compareTitleLogoReplay(title.run1, title.run2);
  const checks = {
    readiness: validatePeopleV3ArtworkReadinessAudit(context.audit).length === 0,
    profileRefreshComplete: refresh.selectedCount === 167 && refresh.records.length === 167,
    sourceAcquisitionComplete: source.selectedCount === 663 && source.records.length === 663,
    portraitPairsComplete: portrait.renderedPersonCount === 663 && portrait.landscapeCount === 663 && portrait.posterCount === 663 && portrait.unresolvedCount === 0,
    titleLogosComplete: title.run1.metadata.recordCount === 1480 && title.run2.metadata.recordCount === 1480,
    titleReplay: titleReplay.byteIdentical && titleReplay.metadataIdentical && titleReplay.comparisons.length === 1480,
    peopleManifest: manifestValidation.valid && manifest.recordCount === 1480,
    runtime: runtime.counts.people === 1480 && runtime.counts.totalEntities === 3872 && runtime.counts.totalAssets === 5924,
    presentation: presentationErrors.length === 0 && presentation.recordCount === 1480,
    physicalFiles: physical.valid && physical.portraitRecordCount === 2960 && physical.titleLogoRecordCount === 1480,
    exactCategories: manifest.records.every((record) => stableStringify(record.categoryMembership) === stableStringify(context.people.find((person) => person.tmdbPersonId === record.tmdbPersonId).categoryMembership)),
    overlaps: overlapIds.length === 9 && overlapIds.every((id) => manifest.records.find((record) => record.tmdbPersonId === id)?.categoryMembership.length === 2),
    cropOverrideHash: cropOverrides.configHash === "cb0453de2ea1213577b2b3d4bcc177696d65264bbafd31a9bf96620a13e2177a" && cropOverrides.records.length === 167,
    reviewPackage: review.groups.titleCheckerboard.itemCount === 1480 && review.groups.titleDark.itemCount === 1480 && review.groups.posters.itemCount === 663 && review.groups.landscapes.itemCount === 663,
    protectedParity: protectedParity.unchanged,
    sharedHero: stableStringify(hero) === stableStringify(protectedAfter.hero),
  };
  const report = {
    version: "people-v3-full-generation-validation-v1",
    generatedAt: context.workspace.generatedAt,
    completedAt: currentIso(),
    valid: Object.values(checks).every(Boolean),
    checks,
    protectedParity,
    manifestErrors: manifestValidation.errors,
    presentationErrors,
    counts: { recovered: refresh.recoveredCount, stillMissing: refresh.stillMissingCount, refreshFailed: refresh.failedCount, validSources: source.validSourceCount, unavailableSources: source.unavailableCount, fallbacks: portrait.fallbackPersonCount, unresolved: portrait.unresolvedCount, posters: portrait.posterCount, landscapes: portrait.landscapeCount, titleLogos: title.run1.metadata.recordCount },
  };
  assert(report.valid, `Full-generation validation failed:\n${Object.entries(checks).filter(([, value]) => !value).map(([key]) => `- ${key}`).join("\n")}`);
  await Promise.all([
    writeJson(path.join(context.root, "validation", "protected-after.json"), protectedAfter),
    writeJson(path.join(context.root, "validation", "final-validation.json"), report),
  ]);
  return { context, report, manifest, runtime, presentation, bundle, review };
}

export async function updateActualAtomicPublicationPlan({ runRoot } = {}) {
  const context = await loadFullGenerationContext({ runRoot });
  const validation = await readJson(path.join(context.root, "validation", "final-validation.json"));
  assert(validation.valid, "The actual publication plan requires a valid complete staged candidate set.");
  const [bundle, portrait, titleLatest, review] = await Promise.all([
    readJson(path.join(context.root, "candidate-manifests", "bundle-report.json")),
    readJson(path.join(context.root, "portrait-render", "report.json")),
    readJson(path.join(context.root, "title-logos", "latest.json")),
    readJson(path.join(context.root, "review", "index.json")),
  ]);
  const titleRoot = path.join(context.root, titleLatest.replayRoot, "run-1", "individual");
  const [portraitBytes, titleBytes, manifestBytes] = await Promise.all([
    byteSummary([path.join(context.root, "candidates", "people")]),
    byteSummary([titleRoot]),
    byteSummary([path.join(context.root, "candidate-manifests")]),
  ]);
  const growth = {
    newPortraitFiles: portraitBytes.fileCount,
    newPortraitBytes: portraitBytes.byteCount,
    titleLogoFiles: titleBytes.fileCount,
    titleLogoBytes: titleBytes.byteCount,
    candidateManifestFiles: manifestBytes.fileCount,
    candidateManifestBytes: manifestBytes.byteCount,
    projectedRepositoryGrowthBytes: portraitBytes.byteCount + titleBytes.byteCount + bundle.presentationManifest.byteCount,
  };
  const plan = {
    version: "people-v3-atomic-publication-plan-v2-actual-candidates",
    generatedAt: context.workspace.generatedAt,
    updatedAt: currentIso(),
    status: "awaiting-owner-review-and-explicit-publication-authorisation",
    publicationAuthorised: false,
    workspace: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, context.root),
    exactGeneratedCounts: validation.counts,
    candidateFiles: bundle,
    actualGrowth: growth,
    reviewPackage: { titleCheckerboard: review.groups.titleCheckerboard, titleDark: review.groups.titleDark, posters: review.groups.posters, landscapes: review.groups.landscapes, exceptionCounts: review.reportCounts },
    protectedParity: validation.protectedParity,
    preconditions: [
      "Dave reviews every paginated title-logo, Poster and Landscape contact sheet",
      "Dave resolves every fallback, unresolved and proposed crop-override review record",
      "all exact staged hashes and candidate fingerprints are revalidated",
      "Dave separately and explicitly authorises permanent publication",
    ],
    publicationOrder: [
      { step: 1, action: "freeze the reviewed ignored candidate hashes and owner decisions", permanentWrites: 0 },
      { step: 2, action: "revalidate protected public bytes and every staged source/output binding", permanentWrites: 0 },
      { step: 3, action: "prepare a same-filesystem transaction containing only 663 Poster, 663 Landscape and 1,480 title-logo additions", permanentWrites: 0 },
      { step: 4, action: "validate the exact 1,480-record People, runtime and presentation manifest candidates against the transaction", permanentWrites: 0 },
      { step: 5, action: "install only the reviewed 2,806 new physical assets without rewriting the existing 817 pairs or shared hero", permanentWrites: 2806 },
      { step: 6, action: "atomically replace the People manifest and runtime lookup and add the presentation manifest", permanentMetadataWrites: 3 },
      { step: 7, action: "run permanent physical, runtime, presentation and protected-hash validation", permanentWrites: 0 },
      { step: 8, action: "create release evidence only under the separately approved publication task", permanentWrites: 0 },
    ],
    rollback: {
      beforeMetadata: "remove only transaction files; permanent state is untouched",
      afterAssetInstall: "remove only the 2,806 new ID-bound files from the validated install inventory",
      afterMetadata: "restore the three metadata snapshots, remove only the new files, and revalidate every protected hash",
      existing817Pairs: "never overwritten or recompressed",
      sharedHero: "never rewritten",
    },
    planFingerprint: null,
  };
  plan.planFingerprint = sha256(Buffer.from(stableStringify({ ...plan, planFingerprint: null })));
  const markdown = `# Nuvio People v3 actual atomic-publication plan\n\nStatus: **awaiting owner review and separate publication authorisation**.\n\n## Actual staged output\n\n- ${growth.newPortraitFiles} new portrait WebPs (${growth.newPortraitBytes.toLocaleString("en-US")} bytes)\n- ${growth.titleLogoFiles} title-logo PNGs (${growth.titleLogoBytes.toLocaleString("en-US")} bytes)\n- Projected repository growth: ${growth.projectedRepositoryGrowthBytes.toLocaleString("en-US")} bytes\n\n## Order\n\n${plan.publicationOrder.map((record) => `${record.step}. ${record.action}`).join("\n")}\n\nNo publication is authorised by this plan.\n`;
  const planRoot = path.join(context.root, "plans");
  await Promise.all([
    writeJson(path.join(planRoot, "atomic-publication-plan.actual.json"), plan),
    atomicWrite(path.join(planRoot, "atomic-publication-plan.actual.md"), markdown),
  ]);
  const workspace = await readJson(path.join(context.root, "workspace.json"));
  workspace.status = "complete-staged-candidate-awaiting-owner-review";
  workspace.completedAt = currentIso();
  await writeJson(path.join(context.root, "workspace.json"), workspace);
  return { context, plan, growth };
}

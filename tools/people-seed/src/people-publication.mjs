import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { validateAgainstSchema } from "./schema-validator.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";

export const PEOPLE_MANIFEST_VERSION = "people-artwork-manifest-v1";
export const PEOPLE_RENDERER_VERSION = "people-artwork-renderer-v1";
export const PEOPLE_METADATA_VERSION = "people-artwork-render-metadata-v1";
export const RAW_URL_ROOT = "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/";
export const LOCKED_PILOT_RELATIVE_PATH = "tools/people-seed/.work/people-proof-selection/drafts/people-proof-set.lock.draft.json";
export const PROMOTION_PROOF_RELATIVE_ROOT = "tools/people-seed/.work/people-production-promotion-proof";
export const PEOPLE_ASSET_RELATIVE_ROOT = "assets/collection_covers/people";
export const PEOPLE_MANIFEST_RELATIVE_PATH = `${PEOPLE_ASSET_RELATIVE_ROOT}/manifest.json`;
export const PUBLIC_MANIFEST_ATTRIBUTION = Object.freeze({
  provider: "The Movie Database (TMDB)",
  url: "https://www.themoviedb.org/",
  notice: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
  source: "The Movie Database is the metadata and image source for this collection.",
});

const FORMAT_ORDER = ["landscape", "poster"];
const REQUIRED_RIGHTS_STATUS = "third-party-portrait-review-required";

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function manifestFingerprintPayload(manifest) {
  const {
    publicationCandidateAt: _publicationCandidateAt,
    publishedAt: _publishedAt,
    manifestFingerprint: _manifestFingerprint,
    ...payload
  } = manifest;
  return payload;
}

export function calculateManifestFingerprint(manifest) {
  return sha256(stableStringify(manifestFingerprintPayload(manifest)));
}

export function normaliseRepositoryPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

export async function writeJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvDocument(fields, rows) {
  return `${[fields.join(","), ...rows.map((row) => fields.map((field) => csvValue(row[field])).join(","))].join("\n")}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileRecord(filePath) {
  if (!(await exists(filePath))) return { exists: false, hash: null, byteCount: null };
  const buffer = await fs.readFile(filePath);
  return { exists: true, hash: sha256(buffer), byteCount: buffer.length };
}

async function walkFiles(directory) {
  if (!(await exists(directory))) return [];
  const output = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(resolved);
      else if (entry.isFile()) output.push(resolved);
    }
  }
  await visit(directory);
  return output;
}

export async function treeRecord(directory, { filter = () => true } = {}) {
  const resolved = path.resolve(directory);
  const files = (await walkFiles(resolved)).filter(filter);
  const records = [];
  for (const filePath of files) {
    const buffer = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    records.push({
      path: normaliseRepositoryPath(path.relative(resolved, filePath)),
      hash: sha256(buffer),
      byteCount: buffer.length,
      mtimeMs: Math.trunc(stat.mtimeMs),
    });
  }
  return {
    exists: await exists(resolved),
    fileCount: records.length,
    byteCount: records.reduce((sum, item) => sum + item.byteCount, 0),
    contentFingerprint: sha256(stableStringify(records.map(({ path: itemPath, hash, byteCount }) => ({ path: itemPath, hash, byteCount })))),
    mtimeFingerprint: sha256(stableStringify(records.map(({ path: itemPath, mtimeMs }) => ({ path: itemPath, mtimeMs })))),
  };
}

function gitValue(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

export async function capturePublicationPreservationState({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, lookupRoot = path.resolve(PEOPLE_ARTWORK_REPO_ROOT, "../tmdb-id-lookup") } = {}) {
  const trackedPaths = [
    "data/people/people-registry.json",
    "data/people/actors-seed.json",
    "data/people/directors-seed.json",
    "data/people/sources.json",
    "data/people/actor-owner-supplement.json",
    "data/people/portrait-source-decisions.json",
    "tools/people-seed/src/people-artwork/renderer.mjs",
    "tools/people-seed/src/people-artwork/source-resolution.mjs",
    "tools/people-seed/config/cormorant-garamond-700.json",
    "tools/people-seed/presets/people-landscape-cormorant-v1.json",
    "tools/people-seed/presets/people-poster-cormorant-v1.json",
    "tools/people-seed/presets/people-text-fallback-landscape-v2.json",
    "tools/people-seed/presets/people-text-fallback-poster-v1.json",
    LOCKED_PILOT_RELATIVE_PATH,
    "assets/collection_covers/manifest.json",
    "tools/studio-network-batch/config/review-state.json",
  ];
  const trackedFiles = {};
  for (const relativePath of trackedPaths) trackedFiles[relativePath] = await fileRecord(path.join(repoRoot, relativePath));
  const trees = {
    peopleProofSelection: await treeRecord(path.join(repoRoot, "tools/people-seed/.work/people-proof-selection")),
    peopleProductionPromotionProof: await treeRecord(path.join(repoRoot, PROMOTION_PROOF_RELATIVE_ROOT)),
    peopleVisualProof: await treeRecord(path.join(repoRoot, "tools/people-seed/.work/people-visual-proof")),
    peopleOwnerSourceReview: await treeRecord(path.join(repoRoot, "tools/people-seed/.work/people-owner-source-review")),
    studioCompanies: await treeRecord(path.join(repoRoot, "assets/collection_covers/companies")),
    studioNetworks: await treeRecord(path.join(repoRoot, "assets/collection_covers/networks")),
    studioStaging: await treeRecord(path.join(repoRoot, "tools/studio-network-batch/.work/staging/production-v1")),
    legacyPeopleArtwork: await treeRecord(path.join(repoRoot, PEOPLE_ASSET_RELATIVE_ROOT), {
      filter: (filePath) => !/[\\/](?:landscape|poster)[\\/]/u.test(filePath) && path.basename(filePath) !== "manifest.json",
    }),
  };
  return {
    primary: {
      head: gitValue(repoRoot, ["rev-parse", "HEAD"]),
      originMain: gitValue(repoRoot, ["rev-parse", "origin/main"]),
      branch: gitValue(repoRoot, ["branch", "--show-current"]),
    },
    lookup: {
      exists: await exists(lookupRoot),
      head: await exists(lookupRoot) ? gitValue(lookupRoot, ["rev-parse", "HEAD"]) : null,
      status: await exists(lookupRoot) ? gitValue(lookupRoot, ["status", "--short"]) : null,
    },
    trackedFiles,
    trees,
  };
}

export function comparePublicationPreservation(before, after) {
  const checks = {
    primaryHeadUnchanged: before.primary.head === after.primary.head,
    originMainUnchanged: before.primary.originMain === after.primary.originMain,
    primaryBranchUnchanged: before.primary.branch === after.primary.branch,
    tmdbIdLookupUnchanged: stableStringify(before.lookup) === stableStringify(after.lookup),
  };
  for (const key of Object.keys(before.trackedFiles)) {
    checks[`file:${key}`] = stableStringify(before.trackedFiles[key]) === stableStringify(after.trackedFiles[key]);
  }
  for (const key of Object.keys(before.trees)) {
    checks[`tree:${key}:content`] = before.trees[key].contentFingerprint === after.trees[key].contentFingerprint
      && before.trees[key].fileCount === after.trees[key].fileCount;
    checks[`tree:${key}:mtime`] = before.trees[key].mtimeFingerprint === after.trees[key].mtimeFingerprint;
  }
  return { version: "people-publication-preservation-v1", valid: Object.values(checks).every(Boolean), checks, before, after };
}

export async function loadLockedPilot({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const lockPath = path.join(repoRoot, LOCKED_PILOT_RELATIVE_PATH);
  const lock = await readJson(lockPath);
  assert(lock.version === "people-proof-set-lock-draft-v1", `Unexpected locked pilot version: ${lock.version}`);
  assert(lock.selectedStableKeys.length === 40, "The locked pilot must contain exactly 40 people.");
  assert(lock.actorSelections.length === 24, "The locked pilot must contain exactly 24 actor selections.");
  assert(lock.directorSelections.length === 16, "The locked pilot must contain exactly 16 director selections.");
  assert(new Set(lock.selectedStableKeys).size === 40, "The locked pilot contains duplicate stable keys.");
  assert(!lock.selectedStableKeys.includes("person:1100"), "Arnold Schwarzenegger must remain outside the locked pilot.");
  assert(lock.selectedStableKeys.includes("person:3894"), "Christian Bale must remain inside the locked pilot.");
  assert(stableStringify([...lock.actorSelections, ...lock.directorSelections].map((item) => item.stableKey)) === stableStringify(lock.selectedStableKeys), "Locked actor/director selection ordering differs from selectedStableKeys.");
  return { lockPath, lock, lockHash: (await fileRecord(lockPath)).hash };
}

export function rolloutTierByCategory(person, foundation) {
  const output = {};
  const actor = foundation.actors.records.find((record) => record.stableKey === person.stableKey);
  const director = foundation.directors.records.find((record) => record.stableKey === person.stableKey);
  if (actor) output.actor = actor.rolloutTier;
  if (director) output.director = director.rolloutTier;
  return output;
}

export function expectedAssetPath(formatId, tmdbPersonId) {
  assert(FORMAT_ORDER.includes(formatId), `Unsupported people artwork format: ${formatId}`);
  assert(Number.isInteger(tmdbPersonId) && tmdbPersonId > 0, `Invalid TMDB person ID: ${tmdbPersonId}`);
  return `${PEOPLE_ASSET_RELATIVE_ROOT}/${formatId}/${tmdbPersonId}.webp`;
}

export function proposedRawUrl(repositoryPath) {
  return `${RAW_URL_ROOT}${normaliseRepositoryPath(repositoryPath)}`;
}

export async function loadPromotionEvidence({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, proofRoot = path.join(repoRoot, PROMOTION_PROOF_RELATIVE_ROOT) } = {}) {
  const reportRoot = path.join(proofRoot, "reports");
  const [portraitParity, portraitMetadata, finalValidation, networkAccounting, presetVerification, fontVerification] = await Promise.all([
    readJson(path.join(reportRoot, "portrait-parity.json")),
    readJson(path.join(reportRoot, "portrait-render-metadata.json")),
    readJson(path.join(reportRoot, "final-validation.json")),
    readJson(path.join(reportRoot, "network-accounting.json")),
    readJson(path.join(reportRoot, "preset-verification.json")),
    readJson(path.join(reportRoot, "font-verification.json")),
  ]);
  assert(finalValidation.valid && finalValidation.checks.exactPortraitParity, "Approved promotion evidence is not valid exact portrait parity.");
  assert(Array.isArray(portraitParity) && portraitParity.length > 0, "Approved promotion evidence must contain portrait parity rows.");
  assert(portraitMetadata.recordCount === portraitParity.length && portraitMetadata.records.length === portraitParity.length, "Approved promotion metadata and parity row counts differ.");
  const parityKeys = portraitParity.map((record) => `${record.stableKey}|${record.formatId}`);
  const metadataKeys = portraitMetadata.records.map((record) => `${record.stableKey}|${record.formatId}`);
  assert(new Set(parityKeys).size === parityKeys.length && new Set(metadataKeys).size === metadataKeys.length, "Approved promotion evidence contains duplicate identity-format rows.");
  assert(same(parityKeys, metadataKeys), "Approved promotion parity and metadata identity-format ordering differs.");
  return { proofRoot, portraitParity, portraitMetadata, finalValidation, networkAccounting, presetVerification, fontVerification };
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export async function compareRenderWithPromotionEvidence({ renderResult, renderRoot, evidence }) {
  const allExpectedParity = new Map(evidence.portraitParity.map((row) => [`${row.stableKey}|${row.formatId}`, row]));
  const allExpectedMetadata = new Map(evidence.portraitMetadata.records.map((row) => [`${row.stableKey}|${row.formatId}`, row]));
  const rows = [];
  for (const actual of renderResult.metadata.records) {
    const key = `${actual.stableKey}|${actual.formatId}`;
    const parity = allExpectedParity.get(key);
    const metadata = allExpectedMetadata.get(key);
    const filePath = path.join(renderRoot, actual.outputPath);
    const buffer = await fs.readFile(filePath);
    const actualFileHash = sha256(buffer);
    const checks = {
      approvedEvidencePresent: Boolean(parity && metadata && parity.parity),
      resolvedProfilePath: actual.profilePathAttempted === parity?.profilePath,
      sourceHash: actual.sourceHash === parity?.sourceHash,
      sourceDimensions: actual.sourceWidth === metadata?.sourceWidth && actual.sourceHeight === metadata?.sourceHeight,
      cropRectangle: same(actual.cropRectangle, metadata?.cropRectangle),
      requestedFontSize: actual.requestedFontSize === metadata?.requestedFontSize,
      finalFontSize: actual.finalFontSize === metadata?.finalFontSize,
      wrapping: same(actual.nameLines, metadata?.nameLines) && actual.lineCount === metadata?.lineCount,
      typographyBounds: same(actual.textBounds, metadata?.textBounds) && same(actual.safeMargins, metadata?.safeMargins),
      tone: actual.presetHash === metadata?.presetHash,
      grain: actual.grainSeed === metadata?.grainSeed && actual.grainAmount === metadata?.grainAmount,
      gradient: same(actual.gradientBounds, metadata?.gradientBounds),
      dimensions: actual.canvasWidth === metadata?.canvasWidth && actual.canvasHeight === metadata?.canvasHeight,
      webpSettings: actual.presetId === metadata?.presetId && actual.presetHash === metadata?.presetHash,
      byteCount: actual.byteCount === parity?.expectedByteCount && buffer.length === parity?.expectedByteCount,
      outputHash: actual.outputHash === parity?.expectedOutputHash && actualFileHash === parity?.expectedOutputHash,
      exactRenderMetadata: same(actual, metadata),
      portraitNotFallback: actual.fallbackUsed === false,
      independentlyGenerated: actual.independentlyGeneratedFromOriginalSource === true && actual.derivedFromOtherFormat === false,
    };
    rows.push({
      stableKey: actual.stableKey,
      tmdbPersonId: actual.tmdbPersonId,
      canonicalName: actual.canonicalName,
      formatId: actual.formatId,
      expectedSourceHash: parity?.sourceHash ?? null,
      actualSourceHash: actual.sourceHash,
      expectedOutputHash: parity?.expectedOutputHash ?? null,
      actualOutputHash: actualFileHash,
      expectedByteCount: parity?.expectedByteCount ?? null,
      actualByteCount: buffer.length,
      checks,
      parity: Object.values(checks).every(Boolean),
    });
  }
  const actualKeys = rows.map((row) => `${row.stableKey}|${row.formatId}`);
  const missingEvidenceKeys = actualKeys.filter((key) => !allExpectedParity.has(key) || !allExpectedMetadata.has(key));
  const unexpectedEvidenceKeys = [...allExpectedParity.keys()].filter((key) => !actualKeys.includes(key));
  return {
    version: "people-publication-asset-parity-v1",
    ordering: "explicit-selection-order-then-landscape-poster",
    recordCount: rows.length,
    missingEvidenceKeys,
    unexpectedEvidenceKeys,
    unexpectedRenderKeys: missingEvidenceKeys,
    exactParityCount: rows.filter((row) => row.parity).length,
    valid: rows.length > 0
      && rows.length === allExpectedParity.size
      && rows.length === allExpectedMetadata.size
      && rows.every((row) => row.parity)
      && missingEvidenceKeys.length === 0
      && unexpectedEvidenceKeys.length === 0,
    records: rows,
  };
}

export async function promoteRenderedAssets({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, renderRoot, metadata }) {
  const records = [];
  const targets = metadata.records.map((record) => expectedAssetPath(record.formatId, record.tmdbPersonId));
  assert(new Set(targets).size === targets.length, "People publication target paths collide.");
  for (const record of metadata.records) {
    const repositoryPath = expectedAssetPath(record.formatId, record.tmdbPersonId);
    const sourcePath = path.join(renderRoot, record.outputPath);
    const targetPath = path.join(repoRoot, repositoryPath);
    const source = await fs.readFile(sourcePath);
    const before = await fileRecord(targetPath);
    assert(sha256(source) === record.outputHash && source.length === record.byteCount, `${record.stableKey}/${record.formatId}: render changed before promotion.`);
    await atomicWrite(targetPath, source);
    const after = await fileRecord(targetPath);
    assert(after.hash === record.outputHash && after.byteCount === record.byteCount, `${record.stableKey}/${record.formatId}: permanent candidate write failed validation.`);
    const action = !before.exists ? "generated" : before.hash === after.hash ? "refreshed-identical" : "regenerated";
    records.push({ stableKey: record.stableKey, formatId: record.formatId, repositoryPath, action, before, after });
  }
  return {
    generated: records.filter((item) => item.action === "generated").length,
    regenerated: records.filter((item) => item.action === "regenerated").length,
    refreshedIdentical: records.filter((item) => item.action === "refreshed-identical").length,
    skipped: 0,
    failed: 0,
    records,
  };
}

export async function buildPeopleArtworkManifest({ people, foundation, metadata, publicationCandidateAt, distributionStatus = "publication-candidate", repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  assert(Number.isFinite(Date.parse(publicationCandidateAt)), "publicationCandidateAt must be an ISO date-time.");
  const fontLockPath = path.join(repoRoot, "tools/people-seed/config/cormorant-garamond-700.json");
  const fontLock = await fileRecord(fontLockPath);
  const byKeyFormat = new Map(metadata.records.map((record) => [`${record.stableKey}|${record.formatId}`, record]));
  const records = people.map((person) => {
    const landscape = byKeyFormat.get(`${person.stableKey}|landscape`) || null;
    const poster = byKeyFormat.get(`${person.stableKey}|poster`) || null;
    const source = landscape || poster;
    assert(source, `${person.stableKey}: no rendered format is available for the manifest.`);
    assert(!landscape || !poster || landscape.sourceHash === poster.sourceHash, `${person.stableKey}: format source hashes differ.`);
    assert(!landscape || !poster || landscape.profilePathAttempted === poster.profilePathAttempted, `${person.stableKey}: format profile paths differ.`);
    assert(!landscape || !poster || landscape.sourceDecision === poster.sourceDecision, `${person.stableKey}: format source decisions differ.`);
    assert(!landscape || !poster || landscape.fallbackUsed === poster.fallbackUsed, `${person.stableKey}: format fallback states differ.`);
    assert(!landscape || !poster || landscape.fallbackReason === poster.fallbackReason, `${person.stableKey}: format fallback reasons differ.`);
    assert(!landscape || !poster || (landscape.sourceWidth === poster.sourceWidth && landscape.sourceHeight === poster.sourceHeight), `${person.stableKey}: format source dimensions differ.`);
    const fallbackUsed = [landscape, poster].filter(Boolean).some((record) => record.fallbackUsed);
    const fallbackReason = [landscape, poster].filter(Boolean).map((record) => record.fallbackReason).find(Boolean) || null;
    const formatFields = (formatId, record) => {
      const prefix = formatId;
      const repositoryPath = record ? expectedAssetPath(formatId, person.tmdbPersonId) : null;
      return {
        [`${prefix}Path`]: repositoryPath,
        [`${prefix}UrlProposal`]: repositoryPath ? proposedRawUrl(repositoryPath) : null,
        [`${prefix}Hash`]: record?.outputHash ?? null,
        [`${prefix}ByteCount`]: record?.byteCount ?? null,
        [`${prefix}PresetId`]: record?.presetId ?? null,
        [`${prefix}PresetHash`]: record?.presetHash ?? null,
      };
    };
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categoryMembership: person.categoryMembership,
      rolloutTierByCategory: rolloutTierByCategory(person, foundation),
      sourceDecision: source.sourceDecision,
      resolvedProfilePath: source.profilePathAttempted,
      sourceHash: source.sourceHash,
      sourceDimensions: source.fallbackUsed ? null : { width: source.sourceWidth, height: source.sourceHeight },
      fallbackUsed,
      fallbackReason,
      ...formatFields("landscape", landscape),
      ...formatFields("poster", poster),
      rendererMetadataVersion: PEOPLE_METADATA_VERSION,
      ownerReviewStatus: fallbackUsed ? "revision-required" : "approved-artwork",
      distributionStatus,
      rightsStatus: REQUIRED_RIGHTS_STATUS,
    };
  });
  const fontHashes = new Set(metadata.records.map((record) => record.fontHash));
  assert(fontHashes.size === 1 && !fontHashes.has(null) && !fontHashes.has(undefined), "Rendered publication metadata must use one exact font hash.");
  const runtime = loadPeopleArtworkRuntime();
  const manifest = {
    version: PEOPLE_MANIFEST_VERSION,
    status: distributionStatus,
    schemaPath: "schemas/people-artwork-manifest.schema.json",
    publicationCandidateAt,
    ordering: "explicit-selection-order",
    recordCount: records.length,
    landscapeCount: records.filter((record) => record.landscapePath).length,
    posterCount: records.filter((record) => record.posterPath).length,
    fallbackCount: records.filter((record) => record.fallbackUsed).length,
    rendererVersion: PEOPLE_RENDERER_VERSION,
    rendererRuntime: {
      sharp: runtime.versions.sharp,
      libvips: runtime.versions.libvips,
      skiaCanvas: runtime.versions.skiaCanvas,
    },
    fontLockHash: fontLock.hash,
    fontHash: metadata.records[0]?.fontHash ?? null,
    fingerprintExcludes: ["publicationCandidateAt", "manifestFingerprint"],
    manifestFingerprint: "0".repeat(64),
    rightsNotice: {
      portraitSources: "Candidate covers are transformations of third-party portrait sources retained with exact source provenance.",
      tmdbRole: "TMDB supplies metadata and image hosting; this manifest does not assert that TMDB owns the underlying photography.",
      codeLicenceSeparation: "The repository code licence does not automatically license or transfer rights in portrait photography.",
      redistributionDecision: "Public redistribution requires a separate explicit project decision after rights review.",
      attributionPolicy: "No portrait attribution or rights holder is invented when the evidence does not establish one.",
      ownershipClaim: "No ownership of the underlying portrait photography is claimed.",
    },
    records,
  };
  manifest.manifestFingerprint = calculateManifestFingerprint(manifest);
  return manifest;
}

export function buildPublishedPeopleArtworkManifest({ candidateManifest, publishedAt } = {}) {
  assert(candidateManifest && ["publication-candidate", "commit-ready"].includes(candidateManifest.status), "Published finalization requires a candidate or commit-ready source manifest.");
  assert(Number.isFinite(Date.parse(publishedAt)), "publishedAt must be an ISO date-time.");
  const records = candidateManifest.records.map((record) => {
    const formatFields = (formatId) => ({
      [`${formatId}Path`]: record[`${formatId}Path`],
      [`${formatId}Url`]: record[`${formatId}Path`] ? proposedRawUrl(record[`${formatId}Path`]) : null,
      [`${formatId}Hash`]: record[`${formatId}Hash`],
      [`${formatId}ByteCount`]: record[`${formatId}ByteCount`],
      [`${formatId}PresetId`]: record[`${formatId}PresetId`],
      [`${formatId}PresetHash`]: record[`${formatId}PresetHash`],
    });
    return {
      stableKey: record.stableKey,
      tmdbPersonId: record.tmdbPersonId,
      canonicalName: record.canonicalName,
      categoryMembership: record.categoryMembership,
      rolloutTierByCategory: record.rolloutTierByCategory,
      sourceDecision: record.sourceDecision,
      resolvedProfilePath: record.resolvedProfilePath,
      sourceHash: record.sourceHash,
      sourceDimensions: record.sourceDimensions,
      fallbackUsed: record.fallbackUsed,
      fallbackReason: record.fallbackReason,
      ...formatFields("landscape"),
      ...formatFields("poster"),
      rendererMetadataVersion: record.rendererMetadataVersion,
    };
  });
  const manifest = {
    version: candidateManifest.version,
    status: "published",
    schemaPath: candidateManifest.schemaPath,
    publishedAt: new Date(publishedAt).toISOString(),
    ordering: candidateManifest.ordering,
    recordCount: records.length,
    landscapeCount: records.filter((record) => record.landscapePath).length,
    posterCount: records.filter((record) => record.posterPath).length,
    fallbackCount: records.filter((record) => record.fallbackUsed).length,
    rendererVersion: candidateManifest.rendererVersion,
    rendererRuntime: structuredClone(candidateManifest.rendererRuntime),
    fontLockHash: candidateManifest.fontLockHash,
    fontHash: candidateManifest.fontHash,
    fingerprintExcludes: ["publishedAt", "manifestFingerprint"],
    manifestFingerprint: "0".repeat(64),
    attribution: structuredClone(PUBLIC_MANIFEST_ATTRIBUTION),
    records,
  };
  manifest.manifestFingerprint = calculateManifestFingerprint(manifest);
  return manifest;
}

export async function validatePeopleArtworkManifest({ manifest, repoRoot = PEOPLE_ARTWORK_REPO_ROOT, expectedStableKeys = null } = {}) {
  const schema = await readJson(path.join(repoRoot, "schemas/people-artwork-manifest.schema.json"));
  const errors = validateAgainstSchema(manifest, schema, "people-artwork-manifest");
  const published = manifest.status === "published";
  const expectedFingerprintExcludes = published ? ["publishedAt", "manifestFingerprint"] : ["publicationCandidateAt", "manifestFingerprint"];
  if (manifest.recordCount !== manifest.records.length) errors.push("recordCount must equal records length");
  if (manifest.landscapeCount !== manifest.records.filter((record) => record.landscapePath).length) errors.push("landscapeCount does not match records");
  if (manifest.posterCount !== manifest.records.filter((record) => record.posterPath).length) errors.push("posterCount does not match records");
  if (manifest.fallbackCount !== manifest.records.filter((record) => record.fallbackUsed).length) errors.push("fallbackCount does not match records");
  if (!same(manifest.fingerprintExcludes, expectedFingerprintExcludes)) errors.push("fingerprintExcludes must contain the exact status-specific exclusions in canonical order");
  if (manifest.manifestFingerprint !== calculateManifestFingerprint(manifest)) errors.push("manifestFingerprint does not match deterministic content");
  if (published) {
    if (!Object.hasOwn(manifest, "publishedAt")) errors.push("published manifest requires publishedAt");
    if (!Object.hasOwn(manifest, "attribution")) errors.push("published manifest requires attribution");
    for (const field of ["publicationCandidateAt", "rightsNotice"]) if (Object.hasOwn(manifest, field)) errors.push(`published manifest must omit ${field}`);
  } else {
    if (!Object.hasOwn(manifest, "publicationCandidateAt")) errors.push("candidate manifest requires publicationCandidateAt");
    if (!Object.hasOwn(manifest, "rightsNotice")) errors.push("candidate manifest requires rightsNotice");
    for (const field of ["publishedAt", "attribution"]) if (Object.hasOwn(manifest, field)) errors.push(`candidate manifest must omit ${field}`);
  }
  const keys = manifest.records.map((record) => record.stableKey);
  const ids = manifest.records.map((record) => record.tmdbPersonId);
  const paths = manifest.records.flatMap((record) => [record.landscapePath, record.posterPath]).filter(Boolean);
  if (new Set(keys).size !== keys.length) errors.push("stable keys must be unique");
  if (new Set(ids).size !== ids.length) errors.push("TMDB person IDs must be unique");
  if (new Set(paths).size !== paths.length) errors.push("artwork paths must be unique");
  if (expectedStableKeys && !same(keys, expectedStableKeys)) errors.push("manifest ordering or scope differs from the explicit selection");
  for (const record of manifest.records) {
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: stable key and TMDB person ID differ`);
    if (!record.landscapePath && !record.posterPath) errors.push(`${record.stableKey}: at least one artwork format is required`);
    const expectedCategoryOrder = ["actor", "director"].filter((category) => record.categoryMembership.includes(category));
    if (!same(record.categoryMembership, expectedCategoryOrder)) errors.push(`${record.stableKey}: category membership order must be actor then director`);
    if (!same(Object.keys(record.rolloutTierByCategory), expectedCategoryOrder)) errors.push(`${record.stableKey}: rollout tiers must match category membership`);
    for (const formatId of FORMAT_ORDER) {
      const repositoryPath = record[`${formatId}Path`];
      const urlField = `${formatId}${published ? "Url" : "UrlProposal"}`;
      const otherUrlField = `${formatId}${published ? "UrlProposal" : "Url"}`;
      const formatValues = [record[`${formatId}Path`], record[urlField], record[`${formatId}Hash`], record[`${formatId}ByteCount`], record[`${formatId}PresetId`], record[`${formatId}PresetHash`]];
      if (!formatValues.every((value) => value === null) && !formatValues.every((value) => value !== null)) errors.push(`${record.stableKey}/${formatId}: format fields must be entirely populated or entirely null`);
      if (repositoryPath && repositoryPath !== expectedAssetPath(formatId, record.tmdbPersonId)) errors.push(`${record.stableKey}/${formatId}: path is not the numeric identity path`);
      if (repositoryPath && record[urlField] !== proposedRawUrl(repositoryPath)) errors.push(`${record.stableKey}/${formatId}: raw URL differs from repository path`);
      if (Object.hasOwn(record, otherUrlField)) errors.push(`${record.stableKey}/${formatId}: manifest status must omit ${otherUrlField}`);
    }
    if (record.fallbackUsed !== Boolean(record.fallbackReason)) errors.push(`${record.stableKey}: fallback flag and reason disagree`);
    if (!record.fallbackUsed && (!record.sourceHash || !record.sourceDimensions)) errors.push(`${record.stableKey}: portrait-backed artwork requires source hash and dimensions`);
    if (published) {
      for (const field of ["ownerReviewStatus", "distributionStatus", "rightsStatus"]) if (Object.hasOwn(record, field)) errors.push(`${record.stableKey}: published record must omit ${field}`);
    } else {
      for (const field of ["ownerReviewStatus", "distributionStatus", "rightsStatus"]) if (!Object.hasOwn(record, field)) errors.push(`${record.stableKey}: candidate record requires ${field}`);
      if (record.fallbackUsed && record.ownerReviewStatus !== "revision-required") errors.push(`${record.stableKey}: fallback artwork cannot be approved automatically`);
      if (manifest.status === "commit-ready" && (record.fallbackUsed || record.ownerReviewStatus !== "approved-artwork")) errors.push(`${record.stableKey}: commit-ready artwork must be portrait-backed and approved`);
      if (record.distributionStatus !== manifest.status) errors.push(`${record.stableKey}: distribution status differs from document status`);
    }
  }
  return { version: "people-artwork-manifest-validation-v1", valid: errors.length === 0, errorCount: errors.length, errors };
}

export async function validateManifestAssets({ manifest, repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const runtime = loadPeopleArtworkRuntime();
  const records = [];
  const errors = [];
  const expectedPaths = new Set(manifest.records.flatMap((record) => FORMAT_ORDER.map((formatId) => record[`${formatId}Path`])).filter(Boolean));
  const actualPaths = [];
  for (const formatId of FORMAT_ORDER) {
    const directory = path.join(repoRoot, PEOPLE_ASSET_RELATIVE_ROOT, formatId);
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const repositoryPath = `${PEOPLE_ASSET_RELATIVE_ROOT}/${formatId}/${entry.name}`;
      actualPaths.push(repositoryPath);
      if (!entry.isFile() || !expectedPaths.has(repositoryPath)) errors.push(`${repositoryPath}: unexpected candidate path`);
    }
  }
  for (const record of manifest.records) {
    for (const formatId of FORMAT_ORDER) {
      const repositoryPath = record[`${formatId}Path`];
      if (!repositoryPath) continue;
      const filePath = path.join(repoRoot, repositoryPath);
      const file = await fileRecord(filePath);
      let decoded = null;
      let decodedFully = false;
      if (file.exists) {
        try {
          decoded = await runtime.sharp(filePath, { failOn: "error" }).metadata();
          await runtime.sharp(filePath, { failOn: "error" }).raw().toBuffer();
          decodedFully = true;
        } catch (error) { errors.push(`${repositoryPath}: decode failed: ${error.message}`); }
      }
      const expectedDimensions = formatId === "landscape" ? { width: 1200, height: 675 } : { width: 1000, height: 1500 };
      const checks = {
        exists: file.exists,
        numericFilename: new RegExp(`/${record.tmdbPersonId}\\.webp$`, "u").test(repositoryPath),
        hash: file.hash === record[`${formatId}Hash`],
        byteCount: file.byteCount === record[`${formatId}ByteCount`],
        decodedFully,
        format: decoded?.format === "webp",
        dimensions: decoded?.width === expectedDimensions.width && decoded?.height === expectedDimensions.height,
      };
      if (!Object.values(checks).every(Boolean)) errors.push(`${repositoryPath}: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(", ")} validation failed`);
      records.push({ stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, formatId, repositoryPath, expectedHash: record[`${formatId}Hash`], actualHash: file.hash, expectedByteCount: record[`${formatId}ByteCount`], actualByteCount: file.byteCount, decoded, checks });
    }
  }
  const missingExpectedPaths = [...expectedPaths].filter((repositoryPath) => !actualPaths.includes(repositoryPath));
  return { version: "people-publication-path-validation-v1", valid: errors.length === 0, recordCount: records.length, expectedPaths: [...expectedPaths], actualPaths, missingExpectedPaths, errors, records };
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function thumbnail(runtime, input, width, height) {
  return runtime.sharp(input).resize(width, height, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
}

async function renderReviewPage({ records, outputPath, repoRoot, title, runtime }) {
  const width = 1800;
  const headerHeight = 90;
  const rowHeight = 350;
  const height = headerHeight + records.length * rowHeight + 20;
  const composites = [];
  const text = [`<text x="42" y="56" class="title">${xmlEscape(title)}</text>`];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const top = headerHeight + index * rowHeight;
    if (record.landscapePath) {
      const landscape = await thumbnail(runtime, path.join(repoRoot, record.landscapePath), 430, 242);
      composites.push({ input: landscape, left: 30, top: top + 32 });
    }
    if (record.posterPath) {
      const poster = await thumbnail(runtime, path.join(repoRoot, record.posterPath), 158, 238);
      composites.push({ input: poster, left: 490, top: top + 32 });
    }
    const lines = [
      record.canonicalName,
      `${record.stableKey} · TMDB ${record.tmdbPersonId} · ${record.categoryMembership.join(" + ")}`,
      `source: ${record.sourceDecision}`,
      ...(record.landscapePath ? [record.landscapePath, `landscape ${record.landscapeHash.slice(0, 12)}… · parity exact`] : []),
      ...(record.posterPath ? [record.posterPath, `poster ${record.posterHash.slice(0, 12)}… · parity exact`] : []),
    ];
    lines.forEach((line, lineIndex) => {
      const className = lineIndex === 0 ? "name" : "detail";
      text.push(`<text x="690" y="${top + 58 + lineIndex * 38}" class="${className}">${xmlEscape(line)}</text>`);
    });
    text.push(`<line x1="30" y1="${top + rowHeight - 1}" x2="1770" y2="${top + rowHeight - 1}" stroke="#4a443d"/>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>.title{font:700 34px sans-serif;fill:#f2eee8}.name{font:700 30px sans-serif;fill:#f2eee8}.detail{font:22px monospace;fill:#cfc7bc}</style><rect width="100%" height="100%" fill="#171512"/>${text.join("")}</svg>`);
  composites.unshift({ input: svg, left: 0, top: 0 });
  const output = await runtime.sharp({ create: { width, height, channels: 3, background: "#171512" } }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  await atomicWrite(outputPath, output);
  return { path: normaliseRepositoryPath(path.basename(outputPath)), hash: sha256(output), byteCount: output.length, width, height, recordCount: records.length, stableKeys: records.map((record) => record.stableKey) };
}

async function renderManifestOverview({ records, outputPath, repoRoot, runtime }) {
  const columns = 4;
  const cellWidth = 440;
  const cellHeight = 245;
  const headerHeight = 90;
  const rows = Math.ceil(records.length / columns);
  const width = columns * cellWidth;
  const height = headerHeight + rows * cellHeight;
  const composites = [];
  const text = [`<text x="36" y="56" class="title">People publication manifest overview</text>`];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = headerHeight + row * cellHeight;
    if (record.landscapePath) {
      const landscape = await thumbnail(runtime, path.join(repoRoot, record.landscapePath), 245, 138);
      composites.push({ input: landscape, left: left + 18, top: top + 16 });
    }
    if (record.posterPath) {
      const poster = await thumbnail(runtime, path.join(repoRoot, record.posterPath), 90, 135);
      composites.push({ input: poster, left: left + 278, top: top + 16 });
    }
    text.push(`<text x="${left + 18}" y="${top + 184}" class="name">${xmlEscape(record.canonicalName)}</text>`);
    text.push(`<text x="${left + 18}" y="${top + 216}" class="detail">${xmlEscape(`${record.stableKey} · ${record.categoryMembership.join("+")}`)}</text>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>.title{font:700 34px sans-serif;fill:#f2eee8}.name{font:700 22px sans-serif;fill:#f2eee8}.detail{font:17px monospace;fill:#cfc7bc}</style><rect width="100%" height="100%" fill="#171512"/>${text.join("")}</svg>`);
  composites.unshift({ input: svg, left: 0, top: 0 });
  const output = await runtime.sharp({ create: { width, height, channels: 3, background: "#171512" } }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  await atomicWrite(outputPath, output);
  return { path: path.basename(outputPath), hash: sha256(output), byteCount: output.length, width, height, recordCount: records.length, stableKeys: records.map((record) => record.stableKey) };
}

export async function generatePublicationContactSheets({ manifest, outputDir, repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const runtime = loadPeopleArtworkRuntime();
  await fs.mkdir(outputDir, { recursive: true });
  const entries = [];
  for (let offset = 0, page = 1; offset < manifest.records.length; offset += 5, page += 1) {
    const name = `page-${String(page).padStart(2, "0")}.png`;
    entries.push(await renderReviewPage({ records: manifest.records.slice(offset, offset + 5), outputPath: path.join(outputDir, name), repoRoot, title: `People publication candidate · page ${page}`, runtime }));
  }
  entries.push(await renderManifestOverview({ records: manifest.records, outputPath: path.join(outputDir, "manifest-overview.png"), repoRoot, runtime }));
  const overrides = manifest.records.filter((record) => record.sourceDecision !== "registry-default");
  entries.push(await renderReviewPage({ records: overrides, outputPath: path.join(outputDir, "source-overrides.png"), repoRoot, title: "Approved portrait source decisions", runtime }));
  return { version: "people-publication-contact-sheets-v1", ordering: "explicit-selection-pages-then-overview-then-source-overrides", entryCount: entries.length, entries };
}

export function buildOwnerReviewRows(manifest) {
  return manifest.records.map((record) => ({
    stable_key: record.stableKey,
    canonical_name: record.canonicalName,
    tmdb_person_id: record.tmdbPersonId,
    category_membership: record.categoryMembership.join("|"),
    landscape_path: record.landscapePath,
    landscape_hash: record.landscapeHash,
    poster_path: record.posterPath,
    poster_hash: record.posterHash,
    source_decision: record.sourceDecision,
    parity_status: "exact",
    owner_publication_decision: "",
    owner_note: "",
  }));
}

export const OWNER_REVIEW_FIELDS = [
  "stable_key", "canonical_name", "tmdb_person_id", "category_membership", "landscape_path", "landscape_hash",
  "poster_path", "poster_hash", "source_decision", "parity_status", "owner_publication_decision", "owner_note",
];

export function validateOwnerDecisionBindings(rows, manifest) {
  const expected = buildOwnerReviewRows(manifest);
  const bindingFields = OWNER_REVIEW_FIELDS.filter((field) => !["owner_publication_decision", "owner_note"].includes(field));
  const errors = [];
  if (rows.length !== expected.length) return ["owner decision count differs from manifest count"];
  for (let index = 0; index < expected.length; index += 1) {
    for (const field of bindingFields) {
      if (String(rows[index][field] ?? "") !== String(expected[index][field] ?? "")) errors.push(`${expected[index].stable_key}: owner decision ${field} differs from the current manifest`);
    }
  }
  return errors;
}

export function validateOwnerDecisions(rows, stableKeys) {
  const allowed = new Set(["publish", "hold", "revise", "remove-from-pilot"]);
  const errors = [];
  if (rows.length !== stableKeys.length) errors.push("owner decision count differs from selection count");
  if (!same(rows.map((row) => row.stable_key), stableKeys)) errors.push("owner decision ordering or stable keys differ from selection");
  for (const row of rows) if (!allowed.has(row.owner_publication_decision)) errors.push(`${row.stable_key}: invalid or blank commit-ready decision`);
  return errors;
}

export function categoryReuseReport(manifest) {
  const shared = manifest.records.filter((record) => record.categoryMembership.length > 1);
  return {
    version: "people-publication-category-reuse-v1",
    valid: manifest.records.every((record) => (
      (record.landscapePath || record.posterPath)
      && (!record.landscapePath || record.landscapePath === expectedAssetPath("landscape", record.tmdbPersonId))
      && (!record.posterPath || record.posterPath === expectedAssetPath("poster", record.tmdbPersonId))
    )),
    personIdentityCount: manifest.records.length,
    actorPathNamespaces: 0,
    directorPathNamespaces: 0,
    sharedCategoryPersonCount: shared.length,
    sharedCategoryPeople: shared.map((record) => ({ stableKey: record.stableKey, canonicalName: record.canonicalName, categoryMembership: record.categoryMembership, landscapePath: record.landscapePath, posterPath: record.posterPath })),
    policy: "Actor and director memberships reuse one category-neutral person identity and never create category-specific artwork copies.",
  };
}

export function zeroNetworkAccounting(networkAccounting, expectedSourceCacheHits = 40) {
  return {
    version: "people-publication-network-accounting-v1",
    sourceCacheHits: networkAccounting.sourceCacheHits,
    imageDownloads: networkAccounting.profileImageDownloads,
    profileImageDownloads: networkAccounting.profileImageDownloads,
    imageCdnRequests: networkAccounting.imageCdnRequests,
    tmdbMetadataRequests: networkAccounting.tmdbMetadataRequests,
    personImagesRequests: networkAccounting.personImagesRequests,
    fontDownloads: networkAccounting.fontDownloads,
    generalWebRequests: networkAccounting.generalWebRequests,
    unauthorisedRequests: networkAccounting.unauthorisedRequests,
    attemptedRequests: networkAccounting.attemptedRequests,
    valid: networkAccounting.sourceCacheHits === expectedSourceCacheHits
      && networkAccounting.profileImageDownloads === 0
      && networkAccounting.imageCdnRequests === 0
      && networkAccounting.tmdbMetadataRequests === 0
      && networkAccounting.personImagesRequests === 0
      && networkAccounting.fontDownloads === 0
      && networkAccounting.generalWebRequests === 0
      && networkAccounting.unauthorisedRequests === 0
      && networkAccounting.attemptedRequests.length === 0,
  };
}

export async function manifestFileSummary(manifestPath) {
  const record = await fileRecord(manifestPath);
  const manifest = record.exists ? await readJson(manifestPath) : null;
  return { path: manifestPath, ...record, manifestFingerprint: manifest?.manifestFingerprint ?? null };
}

export async function validateTrackedPeopleManifest({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, manifestPath = path.join(repoRoot, PEOPLE_MANIFEST_RELATIVE_PATH) } = {}) {
  const manifest = await readJson(manifestPath);
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot });
  const pathValidation = await validateManifestAssets({ manifest, repoRoot });
  return { valid: manifestValidation.valid && pathValidation.valid, manifest, manifestValidation, pathValidation, file: await manifestFileSummary(manifestPath) };
}

export async function writePublicationReports({ workRoot, summary, pathValidation, manifestValidation, parity, urlProposals, categoryReuse, networkAccounting, determinism, preservation, finalValidation }) {
  const reports = path.join(workRoot, "reports");
  await fs.mkdir(reports, { recursive: true });
  const parityFields = ["stableKey", "tmdbPersonId", "canonicalName", "formatId", "expectedSourceHash", "actualSourceHash", "expectedOutputHash", "actualOutputHash", "expectedByteCount", "actualByteCount", "parity"];
  await Promise.all([
    writeJson(path.join(reports, "publication-summary.json"), summary),
    atomicWrite(path.join(reports, "publication-summary.md"), summary.markdown),
    writeJson(path.join(reports, "path-validation.json"), pathValidation),
    writeJson(path.join(reports, "manifest-validation.json"), manifestValidation),
    writeJson(path.join(reports, "asset-parity.json"), parity),
    atomicWrite(path.join(reports, "asset-parity.csv"), csvDocument(parityFields, parity.records)),
    writeJson(path.join(reports, "url-proposals.json"), urlProposals),
    writeJson(path.join(reports, "category-reuse.json"), categoryReuse),
    writeJson(path.join(reports, "network-accounting.json"), networkAccounting),
    writeJson(path.join(reports, "determinism-verification.json"), determinism),
    writeJson(path.join(reports, "preservation-proof.json"), preservation),
    writeJson(path.join(reports, "final-validation.json"), finalValidation),
  ]);
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "./people-publication.mjs";
import { validateAgainstSchema } from "./schema-validator.mjs";
import { loadPeopleV3ProofContext } from "./people-v3-artwork-proof.mjs";
import { writeRenderMetadata, validateRenderMetadata } from "./people-artwork/metadata.mjs";
import { loadPeopleArtworkPresets, renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import { assertPeopleV3ProofPath } from "./people-artwork/title-logo.mjs";

export const LANDSCAPE_CHIN_SAFE_PROOF_CONFIG_PATH = "data/people/landscape-chin-safe-proof-overrides.json";
export const LANDSCAPE_CHIN_SAFE_PROOF_SCHEMA_PATH = "schemas/people-landscape-chin-safe-proof-overrides.schema.json";
export const LANDSCAPE_PROTOTYPE_TIERS = Object.freeze([
  Object.freeze({ id: "tier-1-slight", targetWidth: 594, targetHeight: 675, targetRight: 1098, label: "Tier 1 · 594×675 · 75.8% height retained" }),
  Object.freeze({ id: "tier-2-moderate", targetWidth: 540, targetHeight: 675, targetRight: 1098, label: "Tier 2 · 540×675 · 83.3% height retained" }),
  Object.freeze({ id: "tier-3-roomy", targetWidth: 504, targetHeight: 675, targetRight: 1098, label: "Tier 3 · 504×675 · 89.3% height retained" }),
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const round = (value, places = 6) => Number(value.toFixed(places));

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

function posixRelative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function labelSvg(width, height, primary, secondary = null) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111315"/><text x="16" y="${secondary ? 27 : 36}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#f1f1ee">${escapeXml(primary)}</text>${secondary ? `<text x="16" y="51" font-family="Arial, sans-serif" font-size="14" fill="#aaa9a4">${escapeXml(secondary)}</text>` : ""}</svg>`);
}

async function landscapeCell({ image, primary, secondary, width, imageHeight, labelHeight, runtime }) {
  const resized = await runtime.sharp(image).resize(width, imageHeight, { fit: "fill", kernel: "cubic" }).webp({ quality: 90, effort: 4 }).toBuffer();
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 4, background: "#111315" } }).composite([
    { input: resized, left: 0, top: 0 },
    { input: labelSvg(width, labelHeight, primary, secondary), left: 0, top: imageHeight },
  ]).png().toBuffer();
}

async function composeSheet({ cells, columns, rows, cellWidth, cellHeight, header, outputPath, runtime }) {
  const headerHeight = 68;
  const width = columns * cellWidth;
  const height = headerHeight + rows * cellHeight;
  const composites = [{ input: labelSvg(width, headerHeight, header), left: 0, top: 0 }];
  for (const [index, cell] of cells.entries()) composites.push({ input: cell, left: (index % columns) * cellWidth, top: headerHeight + Math.floor(index / columns) * cellHeight });
  const output = await runtime.sharp({ create: { width, height, channels: 4, background: "#0d0f11" } }).composite(composites).png().toBuffer();
  await atomicWrite(outputPath, output);
  return { path: outputPath, sha256: sha256(output), byteCount: output.length, width, height };
}

async function pagedSheets({ cells, columns, rows, cellWidth, cellHeight, header, outputRoot, baseName, runtime }) {
  const perPage = columns * rows;
  const sheets = [];
  for (let offset = 0, page = 1; offset < cells.length; offset += perPage, page += 1) {
    sheets.push(await composeSheet({
      cells: cells.slice(offset, offset + perPage),
      columns,
      rows,
      cellWidth,
      cellHeight,
      header: `${header} · page ${page}`,
      outputPath: path.join(outputRoot, `${baseName}-page-${String(page).padStart(2, "0")}.png`),
      runtime,
    }));
  }
  return sheets;
}

async function loadSourceEvidence(sourceAttemptRoot) {
  const root = assertPeopleV3ProofPath(sourceAttemptRoot);
  const [context, acquisition, sourceIndex, baselineMetadata] = await Promise.all([
    loadPeopleV3ProofContext({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT }),
    fs.readFile(path.join(root, "portrait-proof", "acquisition-report.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "portrait-proof", "source-cache", "index.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "portrait-proof", "run-1", "render-metadata.json"), "utf8").then(JSON.parse),
  ]);
  const availableIds = new Set(acquisition.records.filter((record) => record.available).map((record) => record.tmdbPersonId));
  const people = context.portraitPeople.filter((person) => availableIds.has(person.tmdbPersonId));
  assert(people.length === 17, `Expected the complete existing 17 rendered Landscape proof identities; found ${people.length}.`);
  return {
    root,
    context,
    acquisition,
    sourceIndex,
    baselineMetadata,
    people,
    sourceCache: path.join(root, "portrait-proof", "source-cache"),
  };
}

function tierOverrideRecord({ person, acquisitionRecord, tier, presetRecord, evidencePackage }) {
  const sourceWidth = acquisitionRecord.sourceWidth;
  const sourceHeight = acquisitionRecord.sourceHeight;
  const cropHeight = Math.min(sourceHeight, Math.round(sourceWidth * tier.targetHeight / tier.targetWidth));
  assert(cropHeight < sourceHeight, `${person.stableKey}/${tier.id}: source lacks the required vertical room.`);
  return {
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName,
    format: "landscape",
    status: "active",
    sourceProfilePath: acquisitionRecord.trackedProfilePath,
    sourceHash: acquisitionRecord.sourceHash,
    basePresetId: presetRecord.preset.id,
    basePresetHash: presetRecord.presetHash,
    cropStrategy: "person-specific-source-bound-landscape-v1",
    cropRectangle: { left: 0, top: 0, width: sourceWidth, height: cropHeight },
    cropScale: { x: round(tier.targetWidth / sourceWidth), y: round(tier.targetHeight / cropHeight) },
    cropOffsetX: tier.targetRight - tier.targetWidth,
    cropOffsetY: 0,
    reason: "chin-jaw-neck-breathing-room",
    evidencePackage,
    proofOutputHash: null,
    createdFromAuditVersion: "people-v3-landscape-chin-safe-audit-v1",
    prototypeTier: tier.id,
  };
}

function inMemoryConfiguration(records, id) {
  const config = { version: "people-landscape-crop-prototype-v1", id, records };
  return { config, configHash: sha256(stableStringify(config)), byStableKey: new Map(records.map((record) => [record.stableKey, record])) };
}

async function renderLandscapeSet({ evidence, outputDir, overrideConfiguration, runtime, fontDirectory }) {
  const result = await renderPeopleArtwork({
    people: evidence.people,
    decisions: evidence.context.decisions,
    sourceCache: evidence.sourceCache,
    outputDir,
    format: "landscape",
    offline: true,
    fontDirectory,
    runtime,
    landscapeCropOverrides: overrideConfiguration,
  });
  assert(result.metadata.recordCount === 17 && result.metadata.records.every((record) => record.formatId === "landscape" && record.fallbackUsed === false), "Landscape correction rendered outside the exact 17 available identities.");
  const written = await writeRenderMetadata({ metadata: result.metadata, outputDir });
  return { ...result, outputDir, written };
}

function metadataById(metadata, formatId = "landscape") {
  return new Map(metadata.records.filter((record) => record.formatId === formatId).map((record) => [record.tmdbPersonId, record]));
}

export async function generateLandscapeCropPrototypes({ attemptRoot, sourceAttemptRoot, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const evidence = await loadSourceEvidence(sourceAttemptRoot);
  const prototypeRoot = path.join(root, "landscape-correction", "prototypes");
  assert(!(await exists(prototypeRoot)), `Landscape crop prototype workspace already exists and will not be overwritten: ${prototypeRoot}`);
  const presets = await loadPeopleArtworkPresets();
  const acquisitionById = new Map(evidence.acquisition.records.map((record) => [record.tmdbPersonId, record]));
  const runs = [];
  for (const tier of LANDSCAPE_PROTOTYPE_TIERS) {
    const records = evidence.people.map((person) => tierOverrideRecord({ person, acquisitionRecord: acquisitionById.get(person.tmdbPersonId), tier, presetRecord: presets.portrait.landscape, evidencePackage: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, root) }));
    const configuration = inMemoryConfiguration(records, tier.id);
    const result = await renderLandscapeSet({ evidence, outputDir: path.join(prototypeRoot, tier.id), overrideConfiguration: configuration, runtime, fontDirectory });
    runs.push({ tier, records, configuration, result });
  }
  const baselineById = metadataById(evidence.baselineMetadata);
  const runByTier = new Map(runs.map((run) => [run.tier.id, { ...run, byId: metadataById(run.result.metadata) }]));
  const cells = [];
  for (const person of evidence.people) {
    const baseline = baselineById.get(person.tmdbPersonId);
    const baselineBuffer = await fs.readFile(path.join(evidence.root, "portrait-proof", "run-1", baseline.outputPath));
    cells.push(await landscapeCell({ image: baselineBuffer, primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: "Before · default 660×675 crop", width: 420, imageHeight: 236, labelHeight: 62, runtime }));
    for (const tier of LANDSCAPE_PROTOTYPE_TIERS) {
      const record = runByTier.get(tier.id).byId.get(person.tmdbPersonId);
      const buffer = await fs.readFile(path.join(runByTier.get(tier.id).result.outputDir, record.outputPath));
      cells.push(await landscapeCell({ image: buffer, primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: tier.label, width: 420, imageHeight: 236, labelHeight: 62, runtime }));
    }
  }
  const sheets = await pagedSheets({ cells, columns: 4, rows: 4, cellWidth: 420, cellHeight: 298, header: "Landscape chin-safe prototype tiers · before / slight / moderate / roomy", outputRoot: path.join(prototypeRoot, "contact-sheets"), baseName: "crop-tier-comparison", runtime });
  const records = evidence.people.map((person) => ({
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName,
    sourceProfilePath: acquisitionById.get(person.tmdbPersonId).trackedProfilePath,
    sourceHash: acquisitionById.get(person.tmdbPersonId).sourceHash,
    before: baselineById.get(person.tmdbPersonId),
    prototypes: LANDSCAPE_PROTOTYPE_TIERS.map((tier) => {
      const run = runByTier.get(tier.id);
      const metadata = run.byId.get(person.tmdbPersonId);
      const override = run.records.find((record) => record.tmdbPersonId === person.tmdbPersonId);
      return { tierId: tier.id, outputHash: metadata.outputHash, byteCount: metadata.byteCount, cropRectangle: override.cropRectangle, cropScale: override.cropScale, cropOffsetX: override.cropOffsetX, cropOffsetY: override.cropOffsetY };
    }),
  }));
  const report = {
    version: "people-v3-landscape-chin-safe-prototypes-v1",
    generatedAt,
    sourceAttemptRoot: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, evidence.root),
    identityCount: evidence.people.length,
    posterRenderCount: 0,
    tiers: LANDSCAPE_PROTOTYPE_TIERS,
    records,
    contactSheets: sheets.map((sheet) => ({ ...sheet, path: posixRelative(root, sheet.path) })),
  };
  const reportPath = path.join(prototypeRoot, "prototype-report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, sheets, evidence, runs };
}

export function validateLandscapeChinSafeProofOverrides(document, schema, { registry = null } = {}) {
  const errors = validateAgainstSchema(document, schema, "landscape-chin-safe-proof-overrides.json");
  if (document?.recordCount !== document?.records?.length) errors.push("chin-safe proof override recordCount must equal records length");
  const registryByKey = registry ? new Map(registry.records.map((record) => [record.stableKey, record])) : null;
  const ids = new Set();
  for (const [index, record] of (document?.records || []).entries()) {
    if (ids.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate chin-safe proof override`);
    ids.add(record.tmdbPersonId);
    if (index > 0 && document.records[index - 1].tmdbPersonId >= record.tmdbPersonId) errors.push("chin-safe proof overrides must use ascending TMDB Person ID order");
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: stable key and TMDB Person ID differ`);
    if (registryByKey) {
      const person = registryByKey.get(record.stableKey);
      if (!person || person.tmdbPersonId !== record.tmdbPersonId || person.canonicalName !== record.canonicalName) errors.push(`${record.stableKey}: proof override differs from the People registry`);
    }
    const targetWidth = Math.round(record.cropRectangle.width * record.cropScale.x);
    const targetHeight = Math.round(record.cropRectangle.height * record.cropScale.y);
    if (targetHeight !== 675 || ![504, 540, 594].includes(targetWidth)) errors.push(`${record.stableKey}: proof override is outside the reviewed zoom-out tiers`);
    if (record.cropOffsetX + targetWidth !== 1098 || record.cropOffsetY !== 0) errors.push(`${record.stableKey}: proof override changed the locked right edge or top alignment`);
  }
  return errors;
}

export async function loadLandscapeChinSafeProofOverrides({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const configPath = path.join(repoRoot, LANDSCAPE_CHIN_SAFE_PROOF_CONFIG_PATH);
  const schemaPath = path.join(repoRoot, LANDSCAPE_CHIN_SAFE_PROOF_SCHEMA_PATH);
  const [buffer, schemaBuffer] = await Promise.all([fs.readFile(configPath), fs.readFile(schemaPath)]);
  const config = JSON.parse(buffer);
  const schema = JSON.parse(schemaBuffer);
  const errors = validateLandscapeChinSafeProofOverrides(config, schema, { registry });
  if (errors.length) throw new Error(`Landscape chin-safe proof overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return {
    config,
    configHash: sha256(buffer),
    configPath,
    schemaPath,
    byStableKey: new Map(config.records.map((record) => [record.stableKey, record])),
    allowProofCandidate: true,
  };
}

function compareLandscapeReplay(first, second) {
  const comparisons = first.metadata.records.map((record, index) => ({
    stableKey: record.stableKey,
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    firstHash: record.outputHash,
    secondHash: second.metadata.records[index]?.outputHash || null,
    byteIdentical: record.outputHash === second.metadata.records[index]?.outputHash && record.byteCount === second.metadata.records[index]?.byteCount,
  }));
  return {
    byteIdentical: comparisons.every((record) => record.byteIdentical),
    metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata),
    comparisons,
  };
}

export async function generateLandscapeCorrectionProof({ attemptRoot, sourceAttemptRoot, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const evidence = await loadSourceEvidence(sourceAttemptRoot);
  const configuration = await loadLandscapeChinSafeProofOverrides({ registry: evidence.context.foundation.registry });
  const proofBase = path.join(root, "landscape-correction");
  let correctionRoot = path.join(proofBase, "proof");
  if (await exists(correctionRoot)) {
    for (let index = 2; index < 100; index += 1) {
      const candidate = path.join(proofBase, `proof-attempt-${String(index).padStart(2, "0")}`);
      if (!(await exists(candidate))) { correctionRoot = candidate; break; }
    }
  }
  assert(!(await exists(correctionRoot)), "No unused Landscape correction proof workspace remains; existing ignored evidence will not be overwritten.");
  const first = await renderLandscapeSet({ evidence, outputDir: path.join(correctionRoot, "run-1"), overrideConfiguration: configuration, runtime, fontDirectory });
  const second = await renderLandscapeSet({ evidence, outputDir: path.join(correctionRoot, "run-2"), overrideConfiguration: configuration, runtime, fontDirectory });
  const [firstErrors, secondErrors] = await Promise.all([validateRenderMetadata(first.metadata), validateRenderMetadata(second.metadata)]);
  assert(firstErrors.length === 0 && secondErrors.length === 0, `Landscape correction metadata is invalid:\n${[...firstErrors, ...secondErrors].join("\n")}`);
  const replay = compareLandscapeReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical, "Landscape correction two-run replay is not byte-identical.");
  const baselineLandscape = metadataById(evidence.baselineMetadata, "landscape");
  const baselinePoster = metadataById(evidence.baselineMetadata, "poster");
  const corrected = metadataById(first.metadata, "landscape");
  const changedIds = new Set(configuration.config.records.map((record) => record.tmdbPersonId));
  const changed = [];
  const unaffected = [];
  for (const person of evidence.people) {
    const before = baselineLandscape.get(person.tmdbPersonId);
    const after = corrected.get(person.tmdbPersonId);
    if (changedIds.has(person.tmdbPersonId)) {
      const override = configuration.byStableKey.get(person.stableKey);
      assert(after.outputHash === override.proofOutputHash, `${person.stableKey}: corrected output is not bound to the tracked reviewed proof hash.`);
      assert(after.outputHash !== before.outputHash, `${person.stableKey}: configured correction did not change Landscape bytes.`);
      changed.push({ person, before, after, override });
    } else {
      assert(after.outputHash === before.outputHash && after.byteCount === before.byteCount, `${person.stableKey}: unaffected Landscape bytes changed.`);
      unaffected.push({ person, before, after });
    }
  }
  const posterPaths = [];
  for (const person of evidence.people) {
    const record = baselinePoster.get(person.tmdbPersonId);
    const posterPath = path.join(evidence.root, "portrait-proof", "run-1", record.outputPath);
    const poster = await fs.readFile(posterPath);
    assert(poster.length === record.byteCount && sha256(poster) === record.outputHash, `${person.stableKey}: source-attempt Poster evidence changed.`);
    posterPaths.push({ tmdbPersonId: person.tmdbPersonId, outputHash: record.outputHash, byteCount: record.byteCount, sourceAttemptPath: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, posterPath) });
  }
  const beforeAfterCells = [];
  for (const record of changed) {
    const beforeBuffer = await fs.readFile(path.join(evidence.root, "portrait-proof", "run-1", record.before.outputPath));
    const afterBuffer = await fs.readFile(path.join(first.outputDir, record.after.outputPath));
    beforeAfterCells.push(await landscapeCell({ image: beforeBuffer, primary: `${record.person.tmdbPersonId} · ${record.person.canonicalName}`, secondary: `Before · ${record.before.cropRectangle.height}px crop height`, width: 600, imageHeight: 338, labelHeight: 64, runtime }));
    beforeAfterCells.push(await landscapeCell({ image: afterBuffer, primary: `${record.person.tmdbPersonId} · ${record.person.canonicalName}`, secondary: `After · ${record.override.prototypeTier} · ${record.override.cropRectangle.height}px crop height`, width: 600, imageHeight: 338, labelHeight: 64, runtime }));
  }
  const beforeAfterSheets = await pagedSheets({ cells: beforeAfterCells, columns: 2, rows: 4, cellWidth: 600, cellHeight: 402, header: "Landscape correction before / after · changed IDs only", outputRoot: path.join(correctionRoot, "contact-sheets"), baseName: "before-after", runtime });
  const correctedCells = [];
  for (const person of evidence.people) {
    const after = corrected.get(person.tmdbPersonId);
    const afterBuffer = await fs.readFile(path.join(first.outputDir, after.outputPath));
    correctedCells.push(await landscapeCell({ image: afterBuffer, primary: `${person.tmdbPersonId} · ${person.canonicalName}`, secondary: changedIds.has(person.tmdbPersonId) ? `Corrected · ${configuration.byStableKey.get(person.stableKey).prototypeTier}` : "Unchanged · byte-identical", width: 600, imageHeight: 338, labelHeight: 64, runtime }));
  }
  const correctedSheets = await pagedSheets({ cells: correctedCells, columns: 4, rows: 4, cellWidth: 600, cellHeight: 402, header: "Corrected 17-identity Landscape proof · Posters not rendered", outputRoot: path.join(correctionRoot, "contact-sheets"), baseName: "corrected-landscape", runtime });
  const replayPath = path.join(correctionRoot, "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-v3-landscape-correction-replay-v1", generatedAt, ...replay }, null, 2)}\n`);
  const report = {
    version: "people-v3-landscape-chin-safe-proof-v1",
    generatedAt,
    status: "owner-review-required",
    sourceAttemptRoot: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, evidence.root),
    reviewedIdentityCount: evidence.people.length,
    correctedIdentityCount: changed.length,
    unaffectedIdentityCount: unaffected.length,
    landscapeOutputsPerRun: first.metadata.recordCount,
    posterOutputsGenerated: 0,
    posterEvidenceVerifiedCount: posterPaths.length,
    twoRunReplay: { byteIdentical: replay.byteIdentical, metadataIdentical: replay.metadataIdentical, comparisonCount: replay.comparisons.length },
    unaffectedLandscapeByteParity: unaffected.map(({ person, before, after }) => ({ tmdbPersonId: person.tmdbPersonId, canonicalName: person.canonicalName, beforeHash: before.outputHash, afterHash: after.outputHash, byteIdentical: before.outputHash === after.outputHash && before.byteCount === after.byteCount })),
    correctedRecords: changed.map(({ person, before, after, override }) => ({
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      sourceProfilePath: override.sourceProfilePath,
      sourceHash: override.sourceHash,
      prototypeTier: override.prototypeTier,
      beforeOutputHash: before.outputHash,
      afterOutputHash: after.outputHash,
      beforeCropRectangle: before.cropRectangle,
      afterCropRectangle: after.cropRectangle,
      beforeScale: before.resizeScale,
      afterScale: after.resizeScale,
      afterOffset: after.portraitBounds,
      reviewedProofHashBound: after.outputHash === override.proofOutputHash,
    })),
    posterEvidence: posterPaths,
    run1Metadata: posixRelative(root, first.written.jsonPath),
    run2Metadata: posixRelative(root, second.written.jsonPath),
    replayReport: posixRelative(root, replayPath),
    beforeAfterSheets: beforeAfterSheets.map((sheet) => ({ ...sheet, path: posixRelative(root, sheet.path) })),
    correctedContactSheets: correctedSheets.map((sheet) => ({ ...sheet, path: posixRelative(root, sheet.path) })),
  };
  const reportPath = path.join(correctionRoot, "correction-proof-report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, first, second, replay, beforeAfterSheets, correctedSheets };
}

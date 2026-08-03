import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { stableStringify } from "./people-publication.mjs";
import {
  TITLE_LOGO_OPTION_IDS,
  assertPeopleV3ProofPath,
  compareTitleLogoReplay,
  loadTitleLogoConfiguration,
  prepareTitleLogoRenderer,
  validateTitleLogoMetadata,
} from "./people-artwork/title-logo.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import {
  buildPeoplePresentationManifest,
  inspectSharedPeopleHero,
  loadPeoplePresentationManifestSchema,
  validatePeoplePresentationManifest,
} from "./people-presentation-manifest.mjs";

const execFileAsync = promisify(execFile);
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

function posixRelative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function checkerboardSvg(width, height) {
  const size = 22;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="${size * 2}" height="${size * 2}" patternUnits="userSpaceOnUse"><rect width="${size * 2}" height="${size * 2}" fill="#d8d8d8"/><rect width="${size}" height="${size}" fill="#f3f3f3"/><rect x="${size}" y="${size}" width="${size}" height="${size}" fill="#f3f3f3"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`);
}

function labelSvg(width, height, primary, secondary = null, { align = "middle" } = {}) {
  const x = align === "start" ? 18 : width / 2;
  const anchor = align === "start" ? "start" : "middle";
  const primaryY = secondary ? Math.round(height * 0.42) : Math.round(height * 0.62);
  const secondaryY = Math.round(height * 0.78);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111315"/><text x="${x}" y="${primaryY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#f1f1ee">${escapeXml(primary)}</text>${secondary ? `<text x="${x}" y="${secondaryY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="15" fill="#aaa9a4">${escapeXml(secondary)}</text>` : ""}</svg>`);
}

async function spacingCell({ logo, person, record, background, width, imageHeight, labelHeight, runtime }) {
  const base = background === "checkerboard"
    ? checkerboardSvg(width, imageHeight)
    : { create: { width, height: imageHeight, channels: 4, background: "#17191c" } };
  const resized = await runtime.sharp(logo).resize({ width: width - 42, height: imageHeight - 26, fit: "inside", kernel: "cubic" }).png().toBuffer();
  const metadata = await runtime.sharp(resized).metadata();
  const artwork = await runtime.sharp(base).composite([{
    input: resized,
    left: Math.round((width - metadata.width) / 2),
    top: Math.round((imageHeight - metadata.height) / 2),
  }]).png().toBuffer();
  const label = labelSvg(width, labelHeight, `${person.tmdbPersonId} · ${person.canonicalName}`, `${record.verticalGap}px clear gap · Cormorant 500 · ${record.collectionFontSize}px · tracking ${record.collectionTracking}px`);
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 4, background: "#111315" } }).composite([
    { input: artwork, left: 0, top: 0 },
    { input: label, left: 0, top: imageHeight },
  ]).png().toBuffer();
}

async function composeSheet({ cells, columns, rows, cellWidth, cellHeight, header, outputPath, runtime }) {
  const headerHeight = 74;
  const width = columns * cellWidth;
  const height = headerHeight + rows * cellHeight;
  const composites = [{ input: labelSvg(width, headerHeight, header, null, { align: "start" }), left: 0, top: 0 }];
  for (const [index, cell] of cells.entries()) composites.push({ input: cell, left: (index % columns) * cellWidth, top: headerHeight + Math.floor(index / columns) * cellHeight });
  const output = await runtime.sharp({ create: { width, height, channels: 4, background: "#0d0f11" } }).composite(composites).png().toBuffer();
  await atomicWrite(outputPath, output);
  return { path: outputPath, sha256: sha256(output), byteCount: output.length, width, height };
}

async function runFreshWorker({ outputDir, generatedAt, fontDirectory }) {
  const workerPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "tools", "people-seed", "scripts", "people-title-logo-proof-worker.mjs");
  const args = [workerPath, "--output-dir", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, outputDir), "--generated-at", generatedAt];
  if (fontDirectory) args.push("--font-dir", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, fontDirectory));
  await execFileAsync(process.execPath, args, { cwd: PEOPLE_ARTWORK_REPO_ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const metadataPath = path.join(outputDir, "renderer-metadata.json");
  return { outputDir, metadataPath, metadata: JSON.parse(await fs.readFile(metadataPath, "utf8")) };
}

async function nextSpacingProofRoot(root) {
  const titleRoot = path.join(root, "title-logos");
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(titleRoot, `spacing-proof-attempt-${String(index).padStart(2, "0")}`);
    if (!(await fs.access(candidate).then(() => true).catch(() => false))) return candidate;
  }
  throw new Error("No unused title-logo spacing-proof workspace remains; existing ignored evidence will not be overwritten.");
}

async function verifyRenderedSet(result, people) {
  const errors = validateTitleLogoMetadata(result.metadata, people);
  assert(errors.length === 0, `Title-logo proof metadata failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  for (const record of result.metadata.records) {
    const outputPath = path.join(result.outputDir, record.optionId, "individual", record.proofFileName);
    const output = await fs.readFile(outputPath);
    assert(output.length === record.byteCount && sha256(output) === record.outputHash, `${record.optionId}/${record.stableKey}: title-logo artifact differs from metadata.`);
  }
}

async function comparisonSheets({ proofRoot, first, people, runtime }) {
  const sheets = [];
  for (const background of ["checkerboard", "dark"]) {
    const cells = [];
    for (const person of people) {
      for (const optionId of TITLE_LOGO_OPTION_IDS) {
        const record = first.metadata.records.find((item) => item.optionId === optionId && item.tmdbPersonId === person.tmdbPersonId);
        assert(record, `${person.stableKey}/${optionId}: spacing-proof record is unavailable.`);
        const logo = await fs.readFile(path.join(first.outputDir, optionId, "individual", `${person.tmdbPersonId}.png`));
        cells.push(await spacingCell({ logo, person, record, background, width: 620, imageHeight: 236, labelHeight: 64, runtime }));
      }
    }
    sheets.push(await composeSheet({
      cells,
      columns: 3,
      rows: 4,
      cellWidth: 620,
      cellHeight: 300,
      header: `Cormorant COLLECTION spacing · 60 / 70 / 80 px · ${background === "dark" ? "neutral dark" : "transparent checkerboard"} · no permanent spacing selected`,
      outputPath: path.join(proofRoot, "contact-sheets", `cormorant-spacing-comparison-${background}.png`),
      runtime,
    }));
  }
  return sheets;
}

async function validatePresentationProofs({ first, people, runtime, generatedAt }) {
  const [sharedHero, schema] = await Promise.all([
    inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp }),
    loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT }),
  ]);
  return TITLE_LOGO_OPTION_IDS.map((optionId) => {
    const manifest = buildPeoplePresentationManifest({ titleLogoMetadata: first.metadata, titleLogoOptionId: optionId, permanentSelection: false, sharedHero, generatedAt });
    const errors = validatePeoplePresentationManifest(manifest, schema, { expectedPeople: people, expectedHero: sharedHero });
    assert(errors.length === 0, `${optionId}: presentation-manifest proof failed validation:\n${errors.join("\n")}`);
    return { optionId, manifestFingerprint: manifest.manifestFingerprint, valid: true, permanentSelection: false };
  });
}

function buildLineWrapReport({ first, people, configuration, generatedAt }) {
  const records = people.map((person) => {
    const options = TITLE_LOGO_OPTION_IDS.map((optionId) => first.metadata.records.find((record) => record.optionId === optionId && record.tmdbPersonId === person.tmdbPersonId));
    const reference = options[0];
    return {
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationLines: reference.presentationLines,
      finalNameFontSize: reference.finalFontSize,
      lineBreakSource: reference.lineBreakSource,
      namePlanIdenticalAcrossOptions: options.every((record) => stableStringify(record.presentationLines) === stableStringify(reference.presentationLines) && record.finalFontSize === reference.finalFontSize),
      options: Object.fromEntries(options.map((record) => [record.optionId, {
        requestedClearGap: record.requestedClearGap,
        measuredClearGap: record.verticalGap,
        nameVisibleBottom: Math.max(...record.lineBounds.map((bound) => bound.y + bound.height)),
        collectionVisibleTop: record.collectionBounds.y,
        collectionFontSize: record.collectionFontSize,
        collectionTracking: record.collectionTracking,
        safeMargins: record.safeMargins,
      }])),
    };
  });
  return {
    version: "people-title-logo-cormorant-spacing-report-v1",
    generatedAt,
    presetId: first.metadata.presetId,
    presetHash: first.metadata.presetHash,
    personCount: people.length,
    typography: {
      family: configuration.preset.typography.family,
      nameWeight: configuration.preset.typography.weight,
      nameRequestedFontSize: configuration.preset.typography.requestedFontSize,
      collectionWeight: configuration.preset.collection.weight,
      collectionFontSize: configuration.preset.collection.fontSize,
      collectionTracking: configuration.preset.collection.tracking,
      verticalPositioning: configuration.preset.collection.verticalPositioning,
      fontSha256: configuration.fontLock.fontSha256,
      fontLockSha256: configuration.fontLockHash,
      licence: configuration.fontLock.licence,
      licenceSha256: configuration.fontLock.licenceSha256,
      weightAxis: configuration.fontLock.weightAxis,
    },
    testedClearGaps: configuration.preset.options.map((option) => option.clearGap),
    records,
  };
}

export async function generateTitleLogoCorrectionProof({ attemptRoot, people, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const proofRoot = await nextSpacingProofRoot(root);
  const run1 = path.join(proofRoot, "run-1");
  const run2 = path.join(proofRoot, "run-2");
  await fs.access(root);
  const first = await runFreshWorker({ outputDir: run1, generatedAt, fontDirectory });
  const second = await runFreshWorker({ outputDir: run2, generatedAt, fontDirectory });
  await Promise.all([verifyRenderedSet(first, people), verifyRenderedSet(second, people)]);
  const replay = compareTitleLogoReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Fresh-process 60/70/80 px spacing replay is not byte-identical.");
  const replayPath = path.join(proofRoot, "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-title-logo-spacing-replay-v1", generatedAt, ...replay }, null, 2)}\n`);
  const configuration = await loadTitleLogoConfiguration();
  const prepared = await prepareTitleLogoRenderer({ people, configuration, runtime, fontDirectory });
  const sheets = await comparisonSheets({ proofRoot, first, people, runtime });
  const presentationProofs = await validatePresentationProofs({ first, people, runtime, generatedAt });
  const lineWrapReport = buildLineWrapReport({ first, people, configuration, generatedAt });
  const lineWrapPath = path.join(proofRoot, "line-wrap-and-spacing-report.json");
  await atomicWrite(lineWrapPath, `${JSON.stringify(lineWrapReport, null, 2)}\n`);
  const report = {
    version: "people-title-logo-final-cormorant-spacing-proof-v1",
    generatedAt,
    status: "owner-spacing-review-required",
    publicationAuthorised: false,
    permanentSpacingSelected: false,
    personCount: people.length,
    optionIds: TITLE_LOGO_OPTION_IDS,
    clearGaps: configuration.preset.options.map((option) => option.clearGap),
    individualPngCountPerRun: first.metadata.recordCount,
    graphicElementCount: 0,
    typography: lineWrapReport.typography,
    replay: { byteIdentical: replay.byteIdentical, metadataIdentical: replay.metadataIdentical, comparisonCount: replay.comparisons.length },
    run1Metadata: posixRelative(root, first.metadataPath),
    run2Metadata: posixRelative(root, second.metadataPath),
    replayReport: posixRelative(root, replayPath),
    lineWrapReport: posixRelative(root, lineWrapPath),
    contactSheets: sheets.map((sheet) => ({ ...sheet, path: posixRelative(root, sheet.path) })),
    presentationManifestProofs: presentationProofs,
  };
  const reportPath = path.join(proofRoot, "correction-proof-report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { first, second, replay, replayPath, proofRoot, sheets, presentationProofs, lineWrapReport, lineWrapPath, report, reportPath, prepared };
}

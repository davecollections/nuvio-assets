import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  TITLE_LOGO_VARIANT_IDS,
  assertPeopleV3ProofPath,
  compareTitleLogoReplay,
  loadTitleLogoConfiguration,
  prepareTitleLogoRenderer,
  renderTitleLogo,
  validateTitleLogoMetadata,
} from "./people-artwork/title-logo.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";

const execFileAsync = promisify(execFile);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const REPRESENTATIVE_IDS = Object.freeze([47, 45400, 77234]);

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

function labelSvg(width, height, primary, secondary = null, { background = "#111315", colour = "#f1f1ee", align = "middle" } = {}) {
  const x = align === "start" ? 18 : width / 2;
  const anchor = align === "start" ? "start" : "middle";
  const primaryY = secondary ? Math.round(height * 0.42) : Math.round(height * 0.58);
  const secondaryY = Math.round(height * 0.78);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><text x="${x}" y="${primaryY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${colour}">${escapeXml(primary)}</text>${secondary ? `<text x="${x}" y="${secondaryY}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="15" fill="#aaa9a4">${escapeXml(secondary)}</text>` : ""}</svg>`);
}

async function titleCell({ logo, person, variantLabel, background, width, imageHeight, labelHeight, runtime }) {
  const base = background === "checkerboard"
    ? checkerboardSvg(width, imageHeight)
    : { create: { width, height: imageHeight, channels: 4, background: background === "dark" ? "#17191c" : background } };
  const resized = await runtime.sharp(logo).resize({ width: width - 48, height: imageHeight - 34, fit: "inside", kernel: "cubic" }).png().toBuffer();
  const resizedMetadata = await runtime.sharp(resized).metadata();
  const artwork = await runtime.sharp(base).composite([{
    input: resized,
    left: Math.round((width - resizedMetadata.width) / 2),
    top: Math.round((imageHeight - resizedMetadata.height) / 2),
  }]).png().toBuffer();
  const label = labelSvg(width, labelHeight, `${person.tmdbPersonId} · ${person.canonicalName}`, variantLabel);
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
  for (const [index, cell] of cells.entries()) {
    composites.push({ input: cell, left: (index % columns) * cellWidth, top: headerHeight + Math.floor(index / columns) * cellHeight });
  }
  const output = await runtime.sharp({ create: { width, height, channels: 4, background: "#0d0f11" } }).composite(composites).png().toBuffer();
  await atomicWrite(outputPath, output);
  return { path: outputPath, sha256: sha256(output), byteCount: output.length, width, height };
}

async function runFreshWorker({ outputDir, generatedAt, fontDirectory }) {
  const workerPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "tools", "people-seed", "scripts", "people-title-logo-proof-worker.mjs");
  const args = [workerPath, "--output-dir", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, outputDir), "--generated-at", generatedAt];
  if (fontDirectory) args.push("--font-dir", posixRelative(PEOPLE_ARTWORK_REPO_ROOT, fontDirectory));
  await execFileAsync(process.execPath, args, {
    cwd: PEOPLE_ARTWORK_REPO_ROOT,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    outputDir,
    metadataPath: path.join(outputDir, "renderer-metadata.json"),
    metadata: JSON.parse(await fs.readFile(path.join(outputDir, "renderer-metadata.json"), "utf8")),
  };
}

async function nextReplayRoot(root) {
  const titleRoot = path.join(root, "title-logos");
  if (!(await fs.access(path.join(titleRoot, "run-1")).then(() => true).catch(() => false)) && !(await fs.access(path.join(titleRoot, "run-2")).then(() => true).catch(() => false))) return titleRoot;
  for (let index = 2; index < 100; index += 1) {
    const candidate = path.join(titleRoot, `replay-attempt-${String(index).padStart(2, "0")}`);
    const used = await fs.access(candidate).then(() => true).catch(() => false);
    if (!used) return candidate;
  }
  throw new Error("No unused title-logo replay workspace remains; existing ignored evidence will not be overwritten.");
}

async function verifyRenderedSet(result, people) {
  const errors = validateTitleLogoMetadata(result.metadata, people);
  assert(errors.length === 0, `Title-logo proof metadata failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  for (const record of result.metadata.records) {
    const outputPath = path.join(result.outputDir, record.variantId, "individual", record.proofFileName);
    const output = await fs.readFile(outputPath);
    assert(output.length === record.byteCount && sha256(output) === record.outputHash, `${record.variantId}/${record.stableKey}: title-logo artifact differs from metadata.`);
  }
}

async function mainVariantSheets({ root, proofRoot, first, people, runtime, configuration }) {
  const contactRoot = path.join(proofRoot, "contact-sheets");
  const byId = new Map(people.map((person) => [person.tmdbPersonId, person]));
  const sheets = [];
  for (const variantId of TITLE_LOGO_VARIANT_IDS) {
    const variant = configuration.preset.variants.find((record) => record.id === variantId);
    for (const background of ["checkerboard", "dark"]) {
      const cells = [];
      for (const person of people) {
        const logo = await fs.readFile(path.join(first.outputDir, variantId, "individual", `${person.tmdbPersonId}.png`));
        cells.push(await titleCell({ logo, person, variantLabel: variant.label, background, width: 600, imageHeight: 216, labelHeight: 64, runtime }));
      }
      sheets.push(await composeSheet({
        cells,
        columns: 4,
        rows: 4,
        cellWidth: 600,
        cellHeight: 280,
        header: `${variant.label} · ${background === "dark" ? "neutral dark" : "transparent checkerboard"}`,
        outputPath: path.join(contactRoot, `${variantId}-${background}.png`),
        runtime,
      }));
    }
  }
  const comparisonCells = [];
  for (const tmdbPersonId of REPRESENTATIVE_IDS) {
    const person = byId.get(tmdbPersonId);
    assert(person, `Representative title-logo identity is unavailable: ${tmdbPersonId}`);
    for (const variantId of TITLE_LOGO_VARIANT_IDS) {
      const variant = configuration.preset.variants.find((record) => record.id === variantId);
      const logo = await fs.readFile(path.join(first.outputDir, variantId, "individual", `${tmdbPersonId}.png`));
      comparisonCells.push(await titleCell({ logo, person, variantLabel: variant.label, background: "dark", width: 620, imageHeight: 224, labelHeight: 66, runtime }));
    }
  }
  sheets.push(await composeSheet({
    cells: comparisonCells,
    columns: 3,
    rows: 3,
    cellWidth: 620,
    cellHeight: 290,
    header: "A / B / C comparison · short, medium and long names · no permanent variant selected",
    outputPath: path.join(contactRoot, "abc-representative-comparison.png"),
    runtime,
  }));
  return sheets;
}

async function optionComparisonSheets({ root, proofRoot, people, runtime, prepared }) {
  const prototypeRoot = path.join(proofRoot, "option-prototypes");
  const byId = new Map(people.map((person) => [person.tmdbPersonId, person]));
  const representatives = REPRESENTATIVE_IDS.map((id) => byId.get(id));
  const accentCells = [];
  const accentRecords = [];
  for (const person of representatives) {
    for (const accent of prepared.configuration.preset.accents.options) {
      const rendered = await renderTitleLogo({ person, variantId: "variant-b-nuvio-accent", accentId: accent.id, ...prepared });
      accentRecords.push(rendered.record);
      const outputPath = path.join(prototypeRoot, "accents", accent.id, `${person.tmdbPersonId}.png`);
      await atomicWrite(outputPath, rendered.output);
      accentCells.push(await titleCell({ logo: rendered.output, person, variantLabel: accent.label, background: "dark", width: 900, imageHeight: 326, labelHeight: 70, runtime }));
    }
  }
  const accentSheet = await composeSheet({
    cells: accentCells,
    columns: 2,
    rows: 3,
    cellWidth: 900,
    cellHeight: 396,
    header: "Original Nuvio accent prototypes · exactly two options tested",
    outputPath: path.join(prototypeRoot, "accent-comparison.png"),
    runtime,
  });
  const fontCells = [];
  const fontRecords = [];
  for (const person of representatives) {
    for (const font of prepared.configuration.secondaryFonts.options) {
      const rendered = await renderTitleLogo({ person, variantId: "variant-c-nuvio-accent-collection", secondaryFontId: font.id, ...prepared });
      fontRecords.push(rendered.record);
      const outputPath = path.join(prototypeRoot, "secondary-fonts", font.id, `${person.tmdbPersonId}.png`);
      await atomicWrite(outputPath, rendered.output);
      fontCells.push(await titleCell({ logo: rendered.output, person, variantLabel: `${font.family} ${font.weight}`, background: "dark", width: 900, imageHeight: 326, labelHeight: 70, runtime }));
    }
  }
  const fontSheet = await composeSheet({
    cells: fontCells,
    columns: 2,
    rows: 3,
    cellWidth: 900,
    cellHeight: 396,
    header: "Variant C secondary-font prototypes · exactly two OFL-backed options tested",
    outputPath: path.join(prototypeRoot, "secondary-font-comparison.png"),
    runtime,
  });
  const metadata = {
    version: "people-title-logo-option-prototypes-v1",
    status: "proof-only",
    permanentSelection: false,
    representativeTmdbPersonIds: REPRESENTATIVE_IDS,
    accentOptionIds: prepared.configuration.preset.accents.options.map((record) => record.id),
    secondaryFontOptions: prepared.configuration.secondaryFonts.options.map((record) => ({
      id: record.id,
      family: record.family,
      weight: record.weight,
      fontSha256: record.fontSha256,
      licence: record.licence,
      licenceSha256: record.licenceSha256,
    })),
    accentRecords,
    fontRecords,
    sheets: [accentSheet, fontSheet].map((record) => ({ ...record, path: posixRelative(root, record.path) })),
  };
  const metadataPath = path.join(prototypeRoot, "prototype-metadata.json");
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { accentSheet, fontSheet, metadataPath, metadata };
}

function lineWrapReport(metadata) {
  const records = metadata.records.filter((record) => record.variantId === "variant-a-name-only");
  return [
    "# People v3 title-logo line-wrap report",
    "",
    "The A/B/C variants share the same locked Cormorant Garamond name plan. The report uses Variant A to avoid triplicating identical name evidence.",
    "",
    "| TMDB ID | Canonical name | Presentation lines | Final size | Rule |",
    "|---:|---|---|---:|---|",
    ...records.map((record) => `| ${record.tmdbPersonId} | ${record.canonicalName.replaceAll("|", "\\|")} | ${record.presentationLines.join(" / ").replaceAll("|", "\\|")} | ${record.finalFontSize} | ${record.lineBreakSource} |`),
    "",
  ].join("\n");
}

export async function generateTitleLogoCorrectionProof({ attemptRoot, people, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const titleRoot = path.join(root, "title-logos");
  const replayRoot = await nextReplayRoot(root);
  const run1 = path.join(replayRoot, "run-1");
  const run2 = path.join(replayRoot, "run-2");
  await Promise.all([fs.access(root), fs.access(path.dirname(titleRoot))]);
  const first = await runFreshWorker({ outputDir: run1, generatedAt, fontDirectory });
  const second = await runFreshWorker({ outputDir: run2, generatedAt, fontDirectory });
  await Promise.all([verifyRenderedSet(first, people), verifyRenderedSet(second, people)]);
  const replay = compareTitleLogoReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Fresh-process A/B/C title-logo replay is not byte-identical.");
  const replayPath = path.join(replayRoot, "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-title-logo-replay-v2", generatedAt, ...replay }, null, 2)}\n`);
  const configuration = await loadTitleLogoConfiguration();
  const prepared = await prepareTitleLogoRenderer({ people, configuration, runtime, fontDirectory });
  const sheets = await mainVariantSheets({ root, proofRoot: replayRoot, first, people, runtime, configuration });
  const prototypes = await optionComparisonSheets({ root, proofRoot: replayRoot, people, runtime, prepared });
  const wrapJsonPath = path.join(replayRoot, "line-wrap-report.json");
  const wrapMarkdownPath = path.join(replayRoot, "line-wrap-report.md");
  const wrapRecords = first.metadata.records.filter((record) => record.variantId === "variant-a-name-only").map((record) => ({
    tmdbPersonId: record.tmdbPersonId,
    canonicalName: record.canonicalName,
    presentationLines: record.presentationLines,
    finalFontSize: record.finalFontSize,
    lineBreakSource: record.lineBreakSource,
    safeMargins: record.safeMargins,
  }));
  await Promise.all([
    atomicWrite(wrapJsonPath, `${JSON.stringify({ version: "people-title-logo-line-wrap-report-v2", generatedAt, presetId: first.metadata.presetId, presetHash: first.metadata.presetHash, recordCount: wrapRecords.length, records: wrapRecords }, null, 2)}\n`),
    atomicWrite(wrapMarkdownPath, lineWrapReport(first.metadata)),
  ]);
  const report = {
    version: "people-title-logo-correction-proof-v1",
    generatedAt,
    status: "owner-review-required",
    permanentVariantSelected: false,
    personCount: people.length,
    variants: TITLE_LOGO_VARIANT_IDS,
    individualPngCountPerRun: first.metadata.recordCount,
    rejectedCopyAbsent: first.metadata.records.every((record) => record.collectionText === null || record.collectionText === "COLLECTION"),
    straightCentredDividerAbsent: true,
    nameFont: {
      family: prepared.fontRecord.family,
      weight: prepared.fontRecord.weight,
      fontSha256: prepared.fontRecord.fontHash,
      licenceSha256: prepared.fontRecord.licenceHash,
    },
    accentOptionsTested: configuration.preset.accents.options.map((record) => record.id),
    secondaryFontOptionsTested: configuration.secondaryFonts.options.map((record) => record.id),
    freshProcessReplay: { byteIdentical: replay.byteIdentical, metadataIdentical: replay.metadataIdentical, comparisonCount: replay.comparisons.length },
    run1Metadata: posixRelative(root, first.metadataPath),
    run2Metadata: posixRelative(root, second.metadataPath),
    replayRoot: posixRelative(root, replayRoot),
    replayReport: posixRelative(root, replayPath),
    lineWrapReports: [posixRelative(root, wrapJsonPath), posixRelative(root, wrapMarkdownPath)],
    contactSheets: sheets.map((record) => ({ ...record, path: posixRelative(root, record.path) })),
    optionPrototypeMetadata: posixRelative(root, prototypes.metadataPath),
  };
  const reportPath = path.join(replayRoot, "correction-proof-report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { first, second, replay, replayPath, sheets, prototypes, report, reportPath, prepared };
}

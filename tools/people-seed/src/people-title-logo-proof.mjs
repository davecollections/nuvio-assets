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
  renderTitleLogo,
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

async function titleCell({ logo, person, optionLabel, background, width, imageHeight, labelHeight, runtime }) {
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
  const label = labelSvg(width, labelHeight, `${person.tmdbPersonId} · ${person.canonicalName}`, optionLabel);
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
    const outputPath = path.join(result.outputDir, record.optionId, "individual", record.proofFileName);
    const output = await fs.readFile(outputPath);
    assert(output.length === record.byteCount && sha256(output) === record.outputHash, `${record.optionId}/${record.stableKey}: title-logo artifact differs from metadata.`);
  }
}

async function mainOptionSheets({ proofRoot, first, people, runtime, configuration }) {
  const contactRoot = path.join(proofRoot, "contact-sheets");
  const byId = new Map(people.map((person) => [person.tmdbPersonId, person]));
  const sheets = [];
  for (const optionId of TITLE_LOGO_OPTION_IDS) {
    const option = configuration.preset.options.find((record) => record.id === optionId);
    for (const background of ["checkerboard", "dark"]) {
      const cells = [];
      for (const person of people) {
        const logo = await fs.readFile(path.join(first.outputDir, optionId, "individual", `${person.tmdbPersonId}.png`));
        cells.push(await titleCell({ logo, person, optionLabel: option.label, background, width: 600, imageHeight: 216, labelHeight: 64, runtime }));
      }
      sheets.push(await composeSheet({
        cells,
        columns: 4,
        rows: 4,
        cellWidth: 600,
        cellHeight: 280,
        header: `${option.label} · ${background === "dark" ? "neutral dark" : "transparent checkerboard"}`,
        outputPath: path.join(contactRoot, `${optionId}-${background}.png`),
        runtime,
      }));
    }
  }
  const comparisonCells = [];
  for (const tmdbPersonId of REPRESENTATIVE_IDS) {
    const person = byId.get(tmdbPersonId);
    assert(person, `Representative title-logo identity is unavailable: ${tmdbPersonId}`);
    for (const optionId of TITLE_LOGO_OPTION_IDS) {
      const option = configuration.preset.options.find((record) => record.id === optionId);
      const logo = await fs.readFile(path.join(first.outputDir, optionId, "individual", `${tmdbPersonId}.png`));
      comparisonCells.push(await titleCell({ logo, person, optionLabel: option.label, background: "dark", width: 900, imageHeight: 326, labelHeight: 70, runtime }));
    }
  }
  sheets.push(await composeSheet({
    cells: comparisonCells,
    columns: 2,
    rows: 3,
    cellWidth: 900,
    cellHeight: 396,
    header: "D1 / D2 comparison · Björk, Greta Gerwig, Priyanka Chopra Jonas · no permanent option selected",
    outputPath: path.join(contactRoot, "d1-d2-representative-comparison.png"),
    runtime,
  }));
  return sheets;
}

async function typographyCloseupSheet({ proofRoot, first, people, runtime, configuration }) {
  const person = people.find((record) => record.tmdbPersonId === 45400);
  assert(person, "Greta Gerwig is unavailable for the typography close-up.");
  const cells = [];
  for (const optionId of TITLE_LOGO_OPTION_IDS) {
    const option = configuration.preset.options.find((record) => record.id === optionId);
    const record = first.metadata.records.find((item) => item.optionId === optionId && item.tmdbPersonId === person.tmdbPersonId);
    const logo = await fs.readFile(path.join(first.outputDir, optionId, "individual", `${person.tmdbPersonId}.png`));
    const left = Math.max(0, Math.floor(record.contentBounds.x - 90));
    const top = Math.max(0, Math.floor(record.contentBounds.y - 54));
    const right = Math.min(record.canvasWidth, Math.ceil(record.contentBounds.x + record.contentBounds.width + 90));
    const bottom = Math.min(record.canvasHeight, Math.ceil(record.collectionBounds.y + record.collectionBounds.height + 54));
    const crop = await runtime.sharp(logo).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: 840, height: 286, fit: "inside", kernel: "nearest" }).png().toBuffer();
    const cropMetadata = await runtime.sharp(crop).metadata();
    const panel = await runtime.sharp({ create: { width: 900, height: 326, channels: 4, background: "#17191c" } }).composite([{ input: crop, left: Math.round((900 - cropMetadata.width) / 2), top: Math.round((326 - cropMetadata.height) / 2) }]).png().toBuffer();
    const label = labelSvg(900, 78, `${person.tmdbPersonId} · ${person.canonicalName}`, `${option.label} · Limelight ${record.collectionFontSize}px · tracking ${record.collectionTracking}px · gap ${record.verticalGap}px`);
    cells.push(await runtime.sharp({ create: { width: 900, height: 404, channels: 4, background: "#111315" } }).composite([
      { input: panel, left: 0, top: 0 },
      { input: label, left: 0, top: 326 },
    ]).png().toBuffer());
  }
  return composeSheet({
    cells,
    columns: 2,
    rows: 1,
    cellWidth: 900,
    cellHeight: 404,
    header: "Typography close-up · exact Cormorant Garamond name and Limelight COLLECTION",
    outputPath: path.join(proofRoot, "contact-sheets", "typography-close-up.png"),
    runtime,
  });
}

async function writeFontEvidence({ root, proofRoot, prepared, generatedAt }) {
  const fontStats = await fs.stat(prepared.limelightRecord.fontPath);
  const licenceStats = await fs.stat(prepared.limelightRecord.licencePath);
  const metadataStats = await fs.stat(prepared.limelightRecord.metadataPath);
  const evidence = {
    version: "people-title-logo-limelight-evidence-v1",
    generatedAt,
    valid: true,
    fontModified: false,
    usage: "fixed word COLLECTION only; never the Person name",
    lockPath: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, prepared.configuration.limelightLockPath),
    lockSha256: prepared.configuration.limelightLockHash,
    family: prepared.limelightRecord.family,
    style: prepared.limelightRecord.style,
    weight: prepared.limelightRecord.weight,
    fontPath: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, prepared.limelightRecord.fontPath),
    fontSha256: prepared.limelightRecord.fontHash,
    fontByteCount: fontStats.size,
    licence: prepared.limelightRecord.licence,
    licencePath: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, prepared.limelightRecord.licencePath),
    licenceSha256: prepared.limelightRecord.licenceHash,
    licenceByteCount: licenceStats.size,
    metadataPath: posixRelative(PEOPLE_ARTWORK_REPO_ROOT, prepared.limelightRecord.metadataPath),
    metadataSha256: prepared.limelightRecord.metadataHash,
    metadataByteCount: metadataStats.size,
    sourceRevision: prepared.limelightRecord.fontSourceRevision,
    sourceUrls: {
      font: prepared.limelightRecord.fontSourceUrl,
      licence: prepared.limelightRecord.licenceSourceUrl,
      metadata: prepared.limelightRecord.metadataSourceUrl,
    },
    rendererBinding: prepared.limelightRecord.rendererBinding,
    glyphCoverage: prepared.limelightRecord.glyphCoverage,
  };
  const outputPath = path.join(proofRoot, "font-lock-and-licence-evidence.json");
  await atomicWrite(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { outputPath, evidence };
}

async function writePresentationProofs({ root, proofRoot, first, people, runtime, generatedAt }) {
  const [sharedHero, schema] = await Promise.all([
    inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp }),
    loadPeoplePresentationManifestSchema({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT }),
  ]);
  const proofs = [];
  for (const optionId of TITLE_LOGO_OPTION_IDS) {
    const manifest = buildPeoplePresentationManifest({ titleLogoMetadata: first.metadata, titleLogoOptionId: optionId, permanentSelection: false, sharedHero, generatedAt });
    const errors = validatePeoplePresentationManifest(manifest, schema, { expectedPeople: people, expectedHero: sharedHero });
    assert(errors.length === 0, `${optionId}: presentation-manifest proof failed validation:\n${errors.join("\n")}`);
    const outputPath = path.join(proofRoot, "presentation-manifest-proofs", `${optionId}.json`);
    await atomicWrite(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    proofs.push({ optionId, outputPath: posixRelative(root, outputPath), manifestFingerprint: manifest.manifestFingerprint, valid: true, permanentSelection: false });
  }
  return { sharedHero, proofs };
}

function lineWrapReport(metadata) {
  const records = metadata.records.filter((record) => record.optionId === TITLE_LOGO_OPTION_IDS[0]);
  return [
    "# People v3 title-logo line-wrap report",
    "",
    "D1 and D2 share the same locked Cormorant Garamond name plan; only COLLECTION size, tracking and vertical position differ.",
    "",
    "| TMDB ID | Canonical name | Presentation lines | Final size | Rule |",
    "|---:|---|---|---:|---|",
    ...records.map((record) => `| ${record.tmdbPersonId} | ${record.canonicalName.replaceAll("|", "\\|")} | ${record.presentationLines.join(" / ").replaceAll("|", "\\|")} | ${record.finalFontSize} | ${record.lineBreakSource} |`),
    "",
  ].join("\n");
}

async function artifactRecord(filePath, root) {
  const buffer = await fs.readFile(filePath);
  return { path: posixRelative(root, filePath), sha256: sha256(buffer), byteCount: buffer.length };
}

async function writeOutputInventory({ root, replayRoot, first, second, extraPaths, generatedAt }) {
  const outputs = [];
  for (const run of [first, second]) {
    for (const record of run.metadata.records) {
      outputs.push({
        run: path.basename(run.outputDir),
        optionId: record.optionId,
        tmdbPersonId: record.tmdbPersonId,
        canonicalName: record.canonicalName,
        path: posixRelative(root, path.join(run.outputDir, record.optionId, "individual", record.proofFileName)),
        sha256: record.outputHash,
        byteCount: record.byteCount,
      });
    }
  }
  const artifacts = [];
  for (const filePath of [...new Set(extraPaths)]) artifacts.push(await artifactRecord(filePath, root));
  const inventory = {
    version: "people-title-logo-output-inventory-v1",
    generatedAt,
    personCount: first.metadata.personCount,
    optionCount: first.metadata.optionCount,
    individualPngCount: outputs.length,
    artifacts,
    outputs,
  };
  const outputPath = path.join(replayRoot, "output-hashes-and-byte-counts.json");
  await atomicWrite(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return { outputPath, inventory };
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
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Fresh-process D1/D2 title-logo replay is not byte-identical.");
  const replayPath = path.join(replayRoot, "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-title-logo-replay-v3", generatedAt, ...replay }, null, 2)}\n`);
  const configuration = await loadTitleLogoConfiguration();
  const prepared = await prepareTitleLogoRenderer({ people, configuration, runtime, fontDirectory });
  const sheets = await mainOptionSheets({ proofRoot: replayRoot, first, people, runtime, configuration });
  const typographyCloseup = await typographyCloseupSheet({ proofRoot: replayRoot, first, people, runtime, configuration });
  sheets.push(typographyCloseup);
  const fontEvidence = await writeFontEvidence({ root, proofRoot: replayRoot, prepared, generatedAt });
  const presentationProofs = await writePresentationProofs({ root, proofRoot: replayRoot, first, people, runtime, generatedAt });
  const wrapJsonPath = path.join(replayRoot, "line-wrap-report.json");
  const wrapMarkdownPath = path.join(replayRoot, "line-wrap-report.md");
  const wrapRecords = people.map((person) => {
    const records = TITLE_LOGO_OPTION_IDS.map((optionId) => first.metadata.records.find((record) => record.optionId === optionId && record.tmdbPersonId === person.tmdbPersonId));
    const [d1, d2] = records;
    return {
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationLines: d1.presentationLines,
      finalNameFontSize: d1.finalFontSize,
      lineBreakSource: d1.lineBreakSource,
      options: Object.fromEntries(records.map((record) => [record.optionId, {
        collectionFontSize: record.collectionFontSize,
        collectionTracking: record.collectionTracking,
        collectionTopY: record.collectionTopY,
        verticalGap: record.verticalGap,
        nameBounds: record.lineBounds,
        collectionBounds: record.collectionBounds,
        safeMargins: record.safeMargins,
      }])),
      namePlanIdenticalAcrossOptions: stableStringify(d1.presentationLines) === stableStringify(d2.presentationLines) && d1.finalFontSize === d2.finalFontSize,
    };
  });
  await Promise.all([
    atomicWrite(wrapJsonPath, `${JSON.stringify({
      version: "people-title-logo-line-wrap-and-spacing-report-v3",
      generatedAt,
      presetId: first.metadata.presetId,
      presetHash: first.metadata.presetHash,
      recordCount: wrapRecords.length,
      spacingDifferences: {
        d1: configuration.preset.options[0].collectionStyle,
        d2: configuration.preset.options[1].collectionStyle,
        d2MinusD1: {
          fontSize: configuration.preset.options[1].collectionStyle.fontSize - configuration.preset.options[0].collectionStyle.fontSize,
          tracking: configuration.preset.options[1].collectionStyle.tracking - configuration.preset.options[0].collectionStyle.tracking,
          topY: configuration.preset.options[1].collectionStyle.topY - configuration.preset.options[0].collectionStyle.topY,
        },
      },
      records: wrapRecords,
    }, null, 2)}\n`),
    atomicWrite(wrapMarkdownPath, lineWrapReport(first.metadata)),
  ]);
  const reportPath = path.join(replayRoot, "correction-proof-report.json");
  const report = {
    version: "people-title-logo-final-treatment-proof-v1",
    generatedAt,
    status: "owner-review-required",
    permanentOptionSelected: false,
    personCount: people.length,
    options: TITLE_LOGO_OPTION_IDS,
    individualPngCountPerRun: first.metadata.recordCount,
    fixedCollectionCopyExact: first.metadata.records.every((record) => record.collectionText === "COLLECTION"),
    graphicElementCount: 0,
    nameFont: {
      family: prepared.fontRecord.family,
      weight: prepared.fontRecord.weight,
      fontSha256: prepared.fontRecord.fontHash,
      licenceSha256: prepared.fontRecord.licenceHash,
    },
    collectionFont: {
      family: prepared.limelightRecord.family,
      style: prepared.limelightRecord.style,
      weight: prepared.limelightRecord.weight,
      fontSha256: prepared.limelightRecord.fontHash,
      licence: prepared.limelightRecord.licence,
      licenceSha256: prepared.limelightRecord.licenceHash,
      metadataSha256: prepared.limelightRecord.metadataHash,
      sourceRevision: prepared.limelightRecord.fontSourceRevision,
      lockSha256: configuration.limelightLockHash,
      fontModified: false,
      usage: "COLLECTION only",
    },
    freshProcessReplay: { byteIdentical: replay.byteIdentical, metadataIdentical: replay.metadataIdentical, comparisonCount: replay.comparisons.length },
    run1Metadata: posixRelative(root, first.metadataPath),
    run2Metadata: posixRelative(root, second.metadataPath),
    replayRoot: posixRelative(root, replayRoot),
    replayReport: posixRelative(root, replayPath),
    lineWrapReports: [posixRelative(root, wrapJsonPath), posixRelative(root, wrapMarkdownPath)],
    contactSheets: sheets.map((record) => ({ ...record, path: posixRelative(root, record.path) })),
    typographyCloseup: posixRelative(root, typographyCloseup.path),
    fontEvidence: posixRelative(root, fontEvidence.outputPath),
    presentationManifestProofs: presentationProofs.proofs,
    outputInventory: posixRelative(root, path.join(replayRoot, "output-hashes-and-byte-counts.json")),
  };
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const inventory = await writeOutputInventory({
    root,
    replayRoot,
    first,
    second,
    extraPaths: [
      first.metadataPath,
      second.metadataPath,
      replayPath,
      wrapJsonPath,
      wrapMarkdownPath,
      fontEvidence.outputPath,
      reportPath,
      ...sheets.map((record) => record.path),
      ...presentationProofs.proofs.map((record) => path.join(root, record.outputPath)),
    ],
    generatedAt,
  });
  return { first, second, replay, replayPath, replayRoot, sheets, fontEvidence, presentationProofs, inventory, report, reportPath, prepared };
}

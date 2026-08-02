import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readPeopleFoundation } from "./people-validation.mjs";
import {
  buildPeoplePresentationManifest,
  inspectSharedPeopleHero,
  loadPeoplePresentationManifestSchema,
  writePeoplePresentationManifestCandidate,
} from "./people-presentation-manifest.mjs";
import { stableStringify } from "./people-publication.mjs";
import { validateRenderMetadata, writeRenderMetadata } from "./people-artwork/metadata.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import { resolvePortraitSource } from "./people-artwork/source-resolution.mjs";
import {
  assertPeopleV3ProofPath,
  compareTitleLogoReplay,
  loadTitleLogoConfiguration,
  prepareTitleLogoRenderer,
  selectTitleLogoProofPeople,
  validateTitleLogoMetadata,
} from "./people-artwork/title-logo.mjs";

export const PEOPLE_V3_PORTRAIT_PROOF_SELECTION = Object.freeze([
  Object.freeze({ tmdbPersonId: 8, canonicalName: "Lee Unkrich", coverage: ["director-only", "tracked-profile-path-missing"] }),
  Object.freeze({ tmdbPersonId: 32, canonicalName: "Robin Wright", coverage: ["actor-only", "current-performer"] }),
  Object.freeze({ tmdbPersonId: 47, canonicalName: "Björk", coverage: ["actor-only", "one-word", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 50, canonicalName: "Catherine Deneuve", coverage: ["actor-only", "classic-performer", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 63, canonicalName: "Milla Jovovich", coverage: ["actor-only", "current-performer"] }),
  Object.freeze({ tmdbPersonId: 65, canonicalName: "Ian Holm", coverage: ["actor-only", "classic-performer", "short-name"] }),
  Object.freeze({ tmdbPersonId: 655, canonicalName: "John Rhys-Davies", coverage: ["actor-only", "hyphenated-name"] }),
  Object.freeze({ tmdbPersonId: 1164, canonicalName: "F. Murray Abraham", coverage: ["actor-only", "initial-and-period"] }),
  Object.freeze({ tmdbPersonId: 3829, canonicalName: "Jean-Paul Belmondo", coverage: ["actor-only", "classic-performer", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 4818, canonicalName: "Roberto Benigni", coverage: ["actor-and-director", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 8892, canonicalName: "Olivia Newton-John", coverage: ["actor-only", "hyphenated-name"] }),
  Object.freeze({ tmdbPersonId: 21041, canonicalName: "Shohreh Aghdashloo", coverage: ["actor-only", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 56446, canonicalName: "John Cena", coverage: ["mandatory-proof-identity", "tracked-profile-path-missing"] }),
  Object.freeze({ tmdbPersonId: 56734, canonicalName: "Chloë Grace Moretz", coverage: ["actor-only", "accented-name", "current-performer"] }),
  Object.freeze({ tmdbPersonId: 60561, canonicalName: "Mo'Nique", coverage: ["actor-only", "apostrophe"] }),
  Object.freeze({ tmdbPersonId: 62861, canonicalName: "Andy Samberg", coverage: ["mandatory-proof-identity", "tracked-profile-path-missing"] }),
  Object.freeze({ tmdbPersonId: 70131, canonicalName: "Tatsuya Nakadai", coverage: ["actor-only", "classic-performer", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 77234, canonicalName: "Priyanka Chopra Jonas", coverage: ["actor-only", "long-canonical-name", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 121529, canonicalName: "Léa Seydoux", coverage: ["actor-only", "accented-name", "international-performer"] }),
  Object.freeze({ tmdbPersonId: 2230991, canonicalName: "Daisy Edgar-Jones", coverage: ["actor-only", "hyphenated-name", "current-performer"] }),
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);

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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function matchingFiles(directory, pattern) {
  if (!(await exists(directory))) return [];
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function nextTitleLogoReplayRoot(root) {
  const titleRoot = path.join(root, "title-logos");
  if (!(await exists(path.join(titleRoot, "run-1"))) && !(await exists(path.join(titleRoot, "run-2")))) return titleRoot;
  for (let index = 2; index < 100; index += 1) {
    const candidate = path.join(titleRoot, `replay-attempt-${String(index).padStart(2, "0")}`);
    if (!(await exists(path.join(candidate, "run-1"))) && !(await exists(path.join(candidate, "run-2")))) return candidate;
  }
  throw new Error("No unused title-logo replay workspace remains below this proof attempt.");
}

async function renderTitleLogoSetInFreshProcess({ outputDir, generatedAt, fontDirectory = null } = {}) {
  const workerPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "tools", "people-seed", "scripts", "people-title-logo-proof-worker.mjs");
  const arguments_ = [workerPath, "--output-dir", outputDir, "--generated-at", generatedAt];
  if (fontDirectory) arguments_.push("--font-dir", fontDirectory);
  const { stdout, stderr } = await execFileAsync(process.execPath, arguments_, {
    cwd: PEOPLE_ARTWORK_REPO_ROOT,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (stderr.trim()) throw new Error(`Title-logo proof worker emitted unexpected stderr:\n${stderr.trim()}`);
  const result = JSON.parse(stdout);
  const metadata = await readJson(result.metadataPath);
  return { metadata, metadataPath: result.metadataPath, outputDir: result.outputDir };
}

async function completedTitleLogoReplayRoot(root) {
  const titleRoot = path.join(root, "title-logos");
  if (!(await exists(titleRoot))) return null;
  const entries = await fs.readdir(titleRoot, { withFileTypes: true });
  const candidates = [
    titleRoot,
    ...entries.filter((entry) => entry.isDirectory() && /^replay-attempt-[0-9]{2}$/u.test(entry.name)).map((entry) => path.join(titleRoot, entry.name)),
  ].sort((left, right) => right.localeCompare(left, "en"));
  for (const candidate of candidates) if (await exists(path.join(candidate, "deterministic-replay.json"))) return candidate;
  return null;
}

async function loadCompletedTitleLogoProof({ root, context, runtime, fontDirectory }) {
  const replayRoot = await completedTitleLogoReplayRoot(root);
  if (!replayRoot) return null;
  const first = { outputDir: path.join(replayRoot, "run-1"), metadataPath: path.join(replayRoot, "run-1", "renderer-metadata.json") };
  const second = { outputDir: path.join(replayRoot, "run-2"), metadataPath: path.join(replayRoot, "run-2", "renderer-metadata.json") };
  [first.metadata, second.metadata] = await Promise.all([readJson(first.metadataPath), readJson(second.metadataPath)]);
  for (const result of [first, second]) {
    const errors = validateTitleLogoMetadata(result.metadata, context.titleLogoPeople);
    assert(errors.length === 0, `Completed title-logo proof metadata is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    for (const record of result.metadata.records) {
      const output = await fs.readFile(path.join(result.outputDir, "individual", record.proofFileName));
      assert(output.length === record.byteCount && sha256(output) === record.outputHash, `${record.stableKey}: completed title-logo proof artifact differs from its metadata.`);
    }
  }
  const replay = compareTitleLogoReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Completed title-logo proof no longer passes deterministic replay.");
  const configuration = await loadTitleLogoConfiguration({ registry: context.foundation.registry });
  const prepared = await prepareTitleLogoRenderer({ people: context.titleLogoPeople, configuration, runtime, fontDirectory });
  const hero = await inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp });
  const reviewSheets = await generateTitleLogoReviewSheets({ replayRoot, context, first, hero, runtime, prepared });
  const presentationPath = path.join(root, "candidates", "presentation-manifest.proof.json");
  assert(await exists(presentationPath), "Completed title-logo proof lacks its additive presentation-manifest candidate.");
  return {
    first,
    second,
    replay,
    replayRoot,
    replayPath: path.join(replayRoot, "deterministic-replay.json"),
    ...reviewSheets,
    wrapJsonPath: path.join(replayRoot, "line-wrap-report.json"),
    wrapMarkdownPath: path.join(replayRoot, "line-wrap-report.md"),
    presentationPath,
    presentation: await readJson(presentationPath),
    hero,
    prepared,
    resumed: true,
  };
}

function categoryMembership(tmdbPersonId, actorIds, directorIds) {
  return [
    ...(actorIds.has(tmdbPersonId) ? ["actor"] : []),
    ...(directorIds.has(tmdbPersonId) ? ["director"] : []),
  ];
}

export function selectPortraitProofPeople({ registry, actors, directors, manifest } = {}) {
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const actorIds = new Set(actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(directors.records.map((record) => record.tmdbPersonId));
  const publishedIds = new Set(manifest.records.map((record) => record.tmdbPersonId));
  return PEOPLE_V3_PORTRAIT_PROOF_SELECTION.map((selection) => {
    const record = registryById.get(selection.tmdbPersonId);
    assert(record && record.canonicalName === selection.canonicalName && record.stableKey === `person:${selection.tmdbPersonId}`, `Portrait proof identity differs from tracked catalogue: ${selection.tmdbPersonId}/${selection.canonicalName}`);
    assert(!publishedIds.has(selection.tmdbPersonId), `${record.stableKey}: portrait proof identity is already published.`);
    return {
      stableKey: record.stableKey,
      tmdbPersonId: record.tmdbPersonId,
      canonicalName: record.canonicalName,
      profilePath: record.profilePath,
      categoryMembership: categoryMembership(record.tmdbPersonId, actorIds, directorIds),
      proofCoverage: [...selection.coverage],
    };
  });
}

export async function loadPeopleV3ProofContext({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const [foundation, manifest, decisions] = await Promise.all([
    readPeopleFoundation(repoRoot),
    readJson(path.join(repoRoot, "assets", "collection_covers", "people", "manifest.json")),
    readJson(path.join(repoRoot, "data", "people", "portrait-source-decisions.json")),
  ]);
  return {
    foundation,
    manifest,
    decisions,
    titleLogoPeople: selectTitleLogoProofPeople(foundation),
    portraitPeople: selectPortraitProofPeople({ ...foundation, manifest }),
  };
}

function sanitiseSourceResolution(person, source) {
  return {
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName,
    categoryMembership: person.categoryMembership,
    proofCoverage: person.proofCoverage,
    trackedProfilePath: person.profilePath,
    sourceDecision: source.sourceDecision,
    sourceStatus: source.sourceStatus,
    fallbackReason: source.fallbackReason,
    available: source.available,
    sourceHash: source.available ? source.sourceHash : null,
    sourceWidth: source.available ? source.width : null,
    sourceHeight: source.available ? source.height : null,
    sourceFormat: source.available ? source.format : null,
    sourceByteCount: source.available ? source.byteCount : null,
    cacheFile: source.cacheEntry?.sourceFile || null,
    rawCacheFile: source.cacheEntry?.rawFile || null,
    sourceUrl: source.cacheEntry?.sourceUrl || null,
    cacheKind: source.cacheEntry?.cacheKind || null,
    networkAttempts: source.attempts,
    proofDisposition: source.available ? "render-portrait-proof" : "owner-investigation-no-portrait-output",
  };
}

export async function acquirePortraitProofSources({ attemptRoot, context, generatedAt, runtime: providedRuntime = null, fetchImpl = fetch } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const sourceCache = path.join(root, "portrait-proof", "source-cache");
  const records = [];
  for (const person of context.portraitPeople) {
    const source = await resolvePortraitSource({
      person,
      decisions: context.decisions,
      sourceCache,
      offline: false,
      sharp: runtime.sharp,
      fetchImpl,
    });
    records.push(sanitiseSourceResolution(person, source));
  }
  const report = {
    version: "people-v3-portrait-proof-acquisition-v1",
    generatedAt,
    sourcePolicy: "exact-tracked-relative-tmdb-profile-path-only",
    selectedCount: context.portraitPeople.length,
    acquiredOrValidatedCount: records.filter((record) => record.available).length,
    investigationCount: records.filter((record) => !record.available).length,
    imageCdnRequestCount: records.flatMap((record) => record.networkAttempts).length,
    generalWebRequestCount: 0,
    tmdbMetadataRequestCount: 0,
    records,
  };
  const reportPath = path.join(root, "portrait-proof", "acquisition-report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, sourceCache };
}

function labelBuffer({ runtime, fontRecord, width, height, text, subtitle = null }) {
  const canvas = new runtime.Canvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#151515";
  context.fillRect(0, 0, width, height);
  let fontSize = 22;
  context.textBaseline = "middle";
  while (fontSize >= 13) {
    context.font = `${fontRecord.weight} ${fontSize}px "${fontRecord.registrationAlias}"`;
    if (context.measureText(text).width <= width - 20) break;
    fontSize -= 1;
  }
  context.fillStyle = "#FFFFFF";
  context.textAlign = "center";
  context.fillText(text, width / 2, subtitle ? height * 0.36 : height / 2);
  if (subtitle) {
    context.font = `${fontRecord.weight} 13px "${fontRecord.registrationAlias}"`;
    context.fillStyle = "#C9C9C9";
    context.fillText(subtitle, width / 2, height * 0.73);
  }
  return canvas.toBuffer("png");
}

function checkerboardSvg(width, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#d8d8d8"/><rect width="16" height="16" fill="#a8a8a8"/><rect x="16" y="16" width="16" height="16" fill="#a8a8a8"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`);
}

async function titleLogoCell({ logoPath, person, kind, width, imageHeight, labelHeight, heroPath, runtime, fontRecord }) {
  const logo = await runtime.sharp(logoPath).resize(width - 32, imageHeight - 24, {
    fit: "contain",
    withoutEnlargement: true,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  let background;
  if (kind === "checkerboard") background = checkerboardSvg(width, imageHeight);
  else if (kind === "hero") {
    background = await runtime.sharp(heroPath).resize(width, imageHeight, { fit: "cover", position: "centre" }).modulate({ brightness: 0.62 }).jpeg({ quality: 90 }).toBuffer();
  } else {
    background = await runtime.sharp({ create: { width, height: imageHeight, channels: 3, background: "#24211f" } }).png().toBuffer();
  }
  const logoMetadata = await runtime.sharp(logo).metadata();
  const image = await runtime.sharp(background).composite([{ input: logo, left: Math.round((width - logoMetadata.width) / 2), top: Math.round((imageHeight - logoMetadata.height) / 2) }]).png().toBuffer();
  const label = await labelBuffer({ runtime, fontRecord, width, height: labelHeight, text: `${person.tmdbPersonId} · ${person.canonicalName}`, subtitle: person.categoryMembership.join(" + ") });
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 3, background: "#151515" } }).composite([{ input: image, left: 0, top: 0 }, { input: label, left: 0, top: imageHeight }]).png().toBuffer();
}

async function imageContactCell({ imagePath, person, width, imageHeight, labelHeight, runtime, fontRecord }) {
  const image = await runtime.sharp(imagePath).resize(width - 16, imageHeight - 16, { fit: "contain", background: "#211e1b" }).png().toBuffer();
  const metadata = await runtime.sharp(image).metadata();
  const framed = await runtime.sharp({ create: { width, height: imageHeight, channels: 3, background: "#211e1b" } }).composite([{ input: image, left: Math.round((width - metadata.width) / 2), top: Math.round((imageHeight - metadata.height) / 2) }]).png().toBuffer();
  const label = await labelBuffer({ runtime, fontRecord, width, height: labelHeight, text: `${person.tmdbPersonId} · ${person.canonicalName}`, subtitle: person.categoryMembership.join(" + ") });
  return runtime.sharp({ create: { width, height: imageHeight + labelHeight, channels: 3, background: "#151515" } }).composite([{ input: framed, left: 0, top: 0 }, { input: label, left: 0, top: imageHeight }]).png().toBuffer();
}

async function composePagedSheets({ cells, outputDir, baseName, columns, rows, cellWidth, cellHeight, runtime }) {
  await fs.mkdir(outputDir, { recursive: true });
  const pageSize = columns * rows;
  const paths = [];
  for (let page = 0; page * pageSize < cells.length; page += 1) {
    const slice = cells.slice(page * pageSize, (page + 1) * pageSize);
    const composites = slice.map((cell, index) => ({ input: cell, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight }));
    const usedRows = Math.ceil(slice.length / columns);
    const buffer = await runtime.sharp({ create: { width: columns * cellWidth, height: usedRows * cellHeight, channels: 3, background: "#0f0f0f" } }).composite(composites).png().toBuffer();
    const outputPath = path.join(outputDir, `${baseName}-page-${String(page + 1).padStart(2, "0")}.png`);
    await atomicWrite(outputPath, buffer);
    paths.push(outputPath);
  }
  return paths;
}

async function generateTitleLogoReviewSheets({ replayRoot, context, first, hero, runtime, prepared }) {
  const contactRoot = path.join(replayRoot, "contact-sheets-v2");
  const existing = {
    checkerboardSheets: await matchingFiles(contactRoot, /^checkerboard-page-[0-9]{2}\.png$/u),
    sharedHeroSheets: await matchingFiles(contactRoot, /^shared-hero-page-[0-9]{2}\.png$/u),
    typographySheets: await matchingFiles(contactRoot, /^typography-close-up-page-[0-9]{2}\.png$/u),
  };
  if (existing.checkerboardSheets.length === 1 && existing.sharedHeroSheets.length === 1 && existing.typographySheets.length === 1) return existing;
  assert(!(await exists(contactRoot)), `Corrected title-logo review-sheet workspace is incomplete and will not be overwritten: ${contactRoot}`);
  const heroPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, hero.repositoryPath);
  const titleRecordsById = new Map(first.metadata.records.map((record) => [record.tmdbPersonId, record]));
  const titleRoot = path.join(first.outputDir, "individual");
  const checkerCells = [];
  const heroCells = [];
  const closeupCells = [];
  for (const person of context.titleLogoPeople) {
    const logoPath = path.join(titleRoot, `${person.tmdbPersonId}.png`);
    checkerCells.push(await titleLogoCell({ logoPath, person, kind: "checkerboard", width: 440, imageHeight: 160, labelHeight: 58, heroPath, runtime, fontRecord: prepared.fontRecord }));
    heroCells.push(await titleLogoCell({ logoPath, person, kind: "hero", width: 440, imageHeight: 248, labelHeight: 58, heroPath, runtime, fontRecord: prepared.fontRecord }));
    closeupCells.push(await titleLogoCell({ logoPath, person, kind: "closeup", width: 900, imageHeight: 320, labelHeight: 58, heroPath, runtime, fontRecord: prepared.fontRecord }));
    assert(titleRecordsById.has(person.tmdbPersonId), `${person.stableKey}: title-logo metadata is missing.`);
  }
  return {
    checkerboardSheets: await composePagedSheets({ cells: checkerCells, outputDir: contactRoot, baseName: "checkerboard", columns: 4, rows: 4, cellWidth: 440, cellHeight: 218, runtime }),
    sharedHeroSheets: await composePagedSheets({ cells: heroCells, outputDir: contactRoot, baseName: "shared-hero", columns: 4, rows: 4, cellWidth: 440, cellHeight: 306, runtime }),
    typographySheets: await composePagedSheets({ cells: closeupCells, outputDir: contactRoot, baseName: "typography-close-up", columns: 2, rows: 8, cellWidth: 900, cellHeight: 378, runtime }),
  };
}

async function generatePortraitReviewSheets({ root, renderablePeople, first, runtime, prepared }) {
  const contactRoot = path.join(root, "portrait-proof", "contact-sheets-v2");
  const existing = {
    posterSheets: await matchingFiles(contactRoot, /^poster-page-[0-9]{2}\.png$/u),
    landscapeSheets: await matchingFiles(contactRoot, /^landscape-page-[0-9]{2}\.png$/u),
  };
  if (existing.posterSheets.length === 2 && existing.landscapeSheets.length === 2) return existing;
  assert(!(await exists(contactRoot)), `Corrected portrait review-sheet workspace is incomplete and will not be overwritten: ${contactRoot}`);
  const posterCells = [];
  const landscapeCells = [];
  for (const person of renderablePeople) {
    posterCells.push(await imageContactCell({ imagePath: path.join(first.outputDir, "poster", `${person.tmdbPersonId}.webp`), person, width: 300, imageHeight: 450, labelHeight: 60, runtime, fontRecord: prepared.fontRecord }));
    landscapeCells.push(await imageContactCell({ imagePath: path.join(first.outputDir, "landscape", `${person.tmdbPersonId}.webp`), person, width: 360, imageHeight: 203, labelHeight: 60, runtime, fontRecord: prepared.fontRecord }));
  }
  return {
    posterSheets: await composePagedSheets({ cells: posterCells, outputDir: contactRoot, baseName: "poster", columns: 4, rows: 4, cellWidth: 300, cellHeight: 510, runtime }),
    landscapeSheets: await composePagedSheets({ cells: landscapeCells, outputDir: contactRoot, baseName: "landscape", columns: 4, rows: 4, cellWidth: 360, cellHeight: 263, runtime }),
  };
}

function lineWrapMarkdown(metadata) {
  const lines = [
    "# People v3 title-logo line-wrap report",
    "",
    `Preset: ${metadata.presetId} (${metadata.presetHash})`,
    `Manual override count: ${metadata.records.filter((record) => record.lineBreakSource === "manual-exact-id-override").length}`,
    "",
    "| TMDB ID | Canonical name | Presentation lines | Font px | Source |",
    "| ---: | --- | --- | ---: | --- |",
    ...metadata.records.map((record) => `| ${record.tmdbPersonId} | ${record.canonicalName.replaceAll("|", "\\|")} | ${record.presentationLines.join(" / ").replaceAll("|", "\\|")} | ${record.finalFontSize} | ${record.lineBreakSource} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function generateTitleLogoProof({ attemptRoot, context, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const completed = await loadCompletedTitleLogoProof({ root, context, runtime, fontDirectory });
  if (completed) return completed;
  const replayRoot = await nextTitleLogoReplayRoot(root);
  const first = await renderTitleLogoSetInFreshProcess({ outputDir: path.join(replayRoot, "run-1"), generatedAt, fontDirectory });
  const second = await renderTitleLogoSetInFreshProcess({ outputDir: path.join(replayRoot, "run-2"), generatedAt, fontDirectory });
  const replay = compareTitleLogoReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Title-logo proof replay differs between the two fresh-process complete runs.");
  const configuration = await loadTitleLogoConfiguration({ registry: context.foundation.registry });
  const prepared = await prepareTitleLogoRenderer({ people: context.titleLogoPeople, configuration, runtime, fontDirectory });
  const replayPath = path.join(replayRoot, "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-title-logo-replay-v1", generatedAt, ...replay }, null, 2)}\n`);
  const hero = await inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp });
  const reviewSheets = await generateTitleLogoReviewSheets({ replayRoot, context, first, hero, runtime, prepared });
  const wrapJsonPath = path.join(replayRoot, "line-wrap-report.json");
  const wrapMarkdownPath = path.join(replayRoot, "line-wrap-report.md");
  await Promise.all([
    atomicWrite(wrapJsonPath, `${JSON.stringify({ version: "people-title-logo-line-wrap-report-v1", generatedAt, presetId: first.metadata.presetId, presetHash: first.metadata.presetHash, overrideConfigHash: first.metadata.overrideConfigHash, manualOverrideCount: first.metadata.records.filter((record) => record.lineBreakSource === "manual-exact-id-override").length, records: first.metadata.records.map((record) => ({ tmdbPersonId: record.tmdbPersonId, canonicalName: record.canonicalName, presentationLines: record.presentationLines, finalFontSize: record.finalFontSize, lineBreakSource: record.lineBreakSource, safeMargins: record.safeMargins })) }, null, 2)}\n`),
    atomicWrite(wrapMarkdownPath, lineWrapMarkdown(first.metadata)),
  ]);
  const schema = await loadPeoplePresentationManifestSchema();
  const presentationManifest = buildPeoplePresentationManifest({ titleLogoMetadata: first.metadata, sharedHero: hero, generatedAt, status: "proof-candidate" });
  const presentationPath = path.join(root, "candidates", "presentation-manifest.proof.json");
  const presentation = await writePeoplePresentationManifestCandidate({ manifest: presentationManifest, outputPath: presentationPath, schema, expectedPeople: context.titleLogoPeople, expectedHero: hero });
  return {
    first,
    second,
    replay,
    replayRoot,
    replayPath,
    ...reviewSheets,
    wrapJsonPath,
    wrapMarkdownPath,
    presentationPath,
    presentation,
    hero,
    prepared,
  };
}

function portraitReplay(first, second) {
  const firstRows = first.metadata.records.map((record) => [record.stableKey, record.formatId, record.outputHash, record.byteCount]);
  const secondRows = second.metadata.records.map((record) => [record.stableKey, record.formatId, record.outputHash, record.byteCount]);
  return {
    byteIdentical: stableStringify(firstRows) === stableStringify(secondRows),
    metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata),
    firstFingerprint: sha256(stableStringify(firstRows)),
    secondFingerprint: sha256(stableStringify(secondRows)),
    comparisons: firstRows.map((row, index) => ({ stableKey: row[0], formatId: row[1], firstHash: row[2], secondHash: secondRows[index]?.[2] || null, byteIdentical: stableStringify(row) === stableStringify(secondRows[index]) })),
  };
}

function sourceAndCropFindings(context, acquisition, renderResult) {
  const renderByKeyFormat = new Map(renderResult.metadata.records.map((record) => [`${record.stableKey}:${record.formatId}`, record]));
  return context.portraitPeople.map((person) => {
    const source = acquisition.report.records.find((record) => record.stableKey === person.stableKey);
    const landscape = renderByKeyFormat.get(`${person.stableKey}:landscape`) || null;
    const poster = renderByKeyFormat.get(`${person.stableKey}:poster`) || null;
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categoryMembership: person.categoryMembership,
      proofCoverage: person.proofCoverage,
      trackedProfilePath: person.profilePath,
      sourceAvailable: source.available,
      sourceStatus: source.sourceStatus,
      fallbackReason: source.fallbackReason,
      sourceHash: source.sourceHash,
      sourceDimensions: source.available ? { width: source.sourceWidth, height: source.sourceHeight } : null,
      sourceAspectRatio: source.available ? Number((source.sourceWidth / source.sourceHeight).toFixed(4)) : null,
      cropOverrideUsed: Boolean(landscape?.cropOverrideUsed),
      landscapeCrop: landscape ? { cropRectangle: landscape.cropRectangle, cropRetainedAreaFraction: landscape.cropRetainedAreaFraction, resizeScale: landscape.resizeScale, upscaleFactor: landscape.upscaleFactor, portraitBounds: landscape.portraitBounds } : null,
      posterCrop: poster ? { cropRectangle: poster.cropRectangle, cropRetainedAreaFraction: poster.cropRetainedAreaFraction, resizeScale: poster.resizeScale, upscaleFactor: poster.upscaleFactor, portraitBounds: poster.portraitBounds } : null,
      ownerReviewRequired: true,
      ownerReviewReasons: source.available ? ["new-person-portrait-and-crop-proof"] : ["no-usable-tracked-profile-source", "no-fallback-rendered-in-proof"],
      proofOutputs: source.available ? { landscape: landscape.outputPath, poster: poster.outputPath } : null,
    };
  });
}

export async function generatePortraitProof({ attemptRoot, context, acquisition = null, generatedAt, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const resolvedAcquisition = acquisition || { report: await readJson(path.join(root, "portrait-proof", "acquisition-report.json")), sourceCache: path.join(root, "portrait-proof", "source-cache") };
  const availableIds = new Set(resolvedAcquisition.report.records.filter((record) => record.available).map((record) => record.tmdbPersonId));
  const renderablePeople = context.portraitPeople.filter((person) => availableIds.has(person.tmdbPersonId));
  assert(renderablePeople.length > 0, "No exact-profile sources are available for the representative portrait proof.");
  const completedReplayPath = path.join(root, "portrait-proof", "deterministic-replay.json");
  if (await exists(completedReplayPath)) {
    const first = { outputDir: path.join(root, "portrait-proof", "run-1") };
    const second = { outputDir: path.join(root, "portrait-proof", "run-2") };
    [first.metadata, second.metadata] = await Promise.all([
      readJson(path.join(first.outputDir, "render-metadata.json")),
      readJson(path.join(second.outputDir, "render-metadata.json")),
    ]);
    first.written = { jsonPath: path.join(first.outputDir, "render-metadata.json"), csvPath: path.join(first.outputDir, "render-metadata.csv"), recordCount: first.metadata.recordCount };
    second.written = { jsonPath: path.join(second.outputDir, "render-metadata.json"), csvPath: path.join(second.outputDir, "render-metadata.csv"), recordCount: second.metadata.recordCount };
    for (const result of [first, second]) {
      const errors = await validateRenderMetadata(result.metadata);
      assert(errors.length === 0, `Completed portrait proof metadata is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
      for (const record of result.metadata.records) {
        const output = await fs.readFile(path.join(result.outputDir, record.outputPath));
        assert(output.length === record.byteCount && sha256(output) === record.outputHash, `${record.stableKey}/${record.formatId}: completed portrait proof artifact differs from its metadata.`);
      }
    }
    const replay = portraitReplay(first, second);
    assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Completed portrait proof no longer passes deterministic replay.");
    const findingsPath = path.join(root, "portrait-proof", "source-and-crop-findings.json");
    const findings = (await readJson(findingsPath)).records;
    const configuration = await loadTitleLogoConfiguration({ registry: context.foundation.registry });
    const prepared = await prepareTitleLogoRenderer({ people: renderablePeople, configuration, runtime, fontDirectory });
    const reviewSheets = await generatePortraitReviewSheets({ root, renderablePeople, first, runtime, prepared });
    return {
      first,
      second,
      replay,
      replayPath: completedReplayPath,
      findings,
      findingsPath,
      ...reviewSheets,
      renderablePeople,
      investigationPeople: context.portraitPeople.filter((person) => !availableIds.has(person.tmdbPersonId)),
      prepared,
      resumed: true,
    };
  }
  const run = async (number) => {
    const outputDir = path.join(root, "portrait-proof", `run-${number}`);
    const result = await renderPeopleArtwork({
      people: renderablePeople,
      decisions: context.decisions,
      sourceCache: resolvedAcquisition.sourceCache,
      outputDir,
      format: "both",
      offline: true,
      fontDirectory,
      runtime,
    });
    assert(result.metadata.records.length === renderablePeople.length * 2, `Portrait proof run ${number} output count differs from two independently rendered formats per source.`);
    assert(result.metadata.records.every((record) => record.fallbackUsed === false && record.independentlyGeneratedFromOriginalSource === true && record.derivedFromOtherFormat === false), `Portrait proof run ${number} produced a fallback or derived format.`);
    const written = await writeRenderMetadata({ metadata: result.metadata, outputDir });
    return { ...result, outputDir, written };
  };
  const first = await run(1);
  const second = await run(2);
  const replay = portraitReplay(first, second);
  assert(replay.byteIdentical && replay.metadataIdentical && replay.comparisons.every((record) => record.byteIdentical), "Representative portrait proof replay differs between complete runs.");
  const replayPath = path.join(root, "portrait-proof", "deterministic-replay.json");
  await atomicWrite(replayPath, `${JSON.stringify({ version: "people-v3-portrait-proof-replay-v1", generatedAt, selectedCount: context.portraitPeople.length, renderedIdentityCount: renderablePeople.length, noOutputInvestigationCount: context.portraitPeople.length - renderablePeople.length, ...replay }, null, 2)}\n`);
  const findings = sourceAndCropFindings(context, resolvedAcquisition, first);
  const findingsPath = path.join(root, "portrait-proof", "source-and-crop-findings.json");
  await atomicWrite(findingsPath, `${JSON.stringify({ version: "people-v3-portrait-source-crop-findings-v1", generatedAt, selectedCount: context.portraitPeople.length, renderedIdentityCount: renderablePeople.length, investigationCount: findings.filter((record) => !record.sourceAvailable).length, records: findings }, null, 2)}\n`);
  const configuration = await loadTitleLogoConfiguration({ registry: context.foundation.registry });
  const prepared = await prepareTitleLogoRenderer({ people: renderablePeople, configuration, runtime, fontDirectory });
  const reviewSheets = await generatePortraitReviewSheets({ root, renderablePeople, first, runtime, prepared });
  return { first, second, replay, replayPath, findings, findingsPath, ...reviewSheets, renderablePeople, investigationPeople: context.portraitPeople.filter((person) => !availableIds.has(person.tmdbPersonId)), prepared };
}

async function compositionMockup({ person, posterPath, landscapePath, logoPath, heroPath, runtime, fontRecord }) {
  const width = 1920;
  const height = 1080;
  const hero = await runtime.sharp(heroPath).resize(width, height, { fit: "cover", position: "centre" }).modulate({ brightness: 0.48 }).jpeg({ quality: 92 }).toBuffer();
  const poster = await runtime.sharp(posterPath).resize(390, 585, { fit: "cover" }).png().toBuffer();
  const landscape = await runtime.sharp(landscapePath).resize(520, 293, { fit: "cover" }).png().toBuffer();
  const logo = await runtime.sharp(logoPath).resize(1050, 380, { fit: "contain" }).png().toBuffer();
  const label = await labelBuffer({ runtime, fontRecord, width: 1920, height: 72, text: `COMPOSITION PROOF — NOT NUVIO CLIENT · ${person.tmdbPersonId} · ${person.canonicalName}`, subtitle: "coverImageUrl + titleLogoUrl + shared heroBackdropUrl" });
  return runtime.sharp(hero).composite([
    { input: poster, left: 120, top: 170 },
    { input: landscape, left: 1270, top: 700 },
    { input: logo, left: 670, top: 160 },
    { input: label, left: 0, top: 0 },
  ]).png().toBuffer();
}

export async function generateCombinedPresentationMockups({ attemptRoot, context, titleProof, portraitProof, runtime: providedRuntime = null } = {}) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const selectedIds = [47, 1164, 3829, 56734, 77234];
  const portraitIds = new Set(portraitProof.renderablePeople.map((person) => person.tmdbPersonId));
  const peopleById = new Map(context.portraitPeople.map((person) => [person.tmdbPersonId, person]));
  assert(selectedIds.every((id) => portraitIds.has(id)), "Combined presentation mockup selection lacks a rendered portrait proof.");
  const baseMockupRoot = path.join(root, "composition-proofs");
  const existingRoots = [baseMockupRoot];
  if (await exists(baseMockupRoot)) existingRoots.push(...(await fs.readdir(baseMockupRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^retry-[0-9]{2}$/u.test(entry.name)).map((entry) => path.join(baseMockupRoot, entry.name)));
  for (const candidate of existingRoots.sort((left, right) => right.localeCompare(left, "en"))) {
    const candidatePaths = selectedIds.map((id) => path.join(candidate, `${id}.png`));
    const contactSheets = await matchingFiles(candidate, /^composition-proofs-page-[0-9]{2}\.png$/u);
    const candidateFilesExist = (await Promise.all(candidatePaths.map((filePath) => exists(filePath)))).every(Boolean);
    if (candidateFilesExist && contactSheets.length === 1 && await exists(path.join(candidate, "README.md"))) {
      return { paths: candidatePaths, contactSheets, reportPath: path.join(candidate, "README.md"), resumed: true };
    }
  }
  let mockupRoot = baseMockupRoot;
  if ((await matchingFiles(baseMockupRoot, /^[0-9]+\.png$/u)).length > 0) {
    for (let index = 2; index < 100; index += 1) {
      const candidate = path.join(baseMockupRoot, `retry-${String(index).padStart(2, "0")}`);
      if (!(await exists(candidate))) { mockupRoot = candidate; break; }
    }
  }
  await fs.mkdir(mockupRoot, { recursive: true });
  const paths = [];
  const heroPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "assets", "collection_covers", "people", "people hero backdrop.jpg");
  for (const tmdbPersonId of selectedIds) {
    const person = peopleById.get(tmdbPersonId);
    const buffer = await compositionMockup({
      person,
      posterPath: path.join(portraitProof.first.outputDir, "poster", `${tmdbPersonId}.webp`),
      landscapePath: path.join(portraitProof.first.outputDir, "landscape", `${tmdbPersonId}.webp`),
      logoPath: path.join(titleProof.first.outputDir, "individual", `${tmdbPersonId}.png`),
      heroPath,
      runtime,
      fontRecord: titleProof.prepared.fontRecord,
    });
    const outputPath = path.join(mockupRoot, `${tmdbPersonId}.png`);
    await atomicWrite(outputPath, buffer);
    paths.push(outputPath);
  }
  const contactCells = [];
  for (const outputPath of paths) {
    const image = await runtime.sharp(outputPath).resize(640, 360, { fit: "contain" }).png().toBuffer();
    contactCells.push(image);
  }
  const contactSheets = await composePagedSheets({ cells: contactCells, outputDir: mockupRoot, baseName: "composition-proofs", columns: 2, rows: 3, cellWidth: 640, cellHeight: 360, runtime });
  const reportPath = path.join(mockupRoot, "README.md");
  await atomicWrite(reportPath, `# People v3 combined presentation composition proofs\n\nThese ignored mockups combine the existing three-field concept: runtime coverImageUrl, transparent titleLogoUrl, and the shared heroBackdropUrl. They are design evidence only and do not claim exact Nuvio client layout.\n`);
  return { paths, contactSheets, reportPath };
}

export async function readPortraitAcquisitionFromAttempt(attemptRoot) {
  const root = assertPeopleV3ProofPath(attemptRoot);
  return {
    report: await readJson(path.join(root, "portrait-proof", "acquisition-report.json")),
    reportPath: path.join(root, "portrait-proof", "acquisition-report.json"),
    sourceCache: path.join(root, "portrait-proof", "source-cache"),
  };
}

export async function assertAttemptDoesNotExist(attemptRoot) {
  assertPeopleV3ProofPath(attemptRoot);
  assert(!(await exists(attemptRoot)), `People v3 proof attempt already exists and will not be deleted or recreated: ${attemptRoot}`);
}

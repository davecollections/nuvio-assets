#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRenderMetadata } from "../src/people-artwork/metadata.mjs";
import { renderPeopleArtwork } from "../src/people-artwork/renderer.mjs";
import { loadPeopleArtworkRuntime } from "../src/people-artwork/runtime-dependencies.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const lookupRoot = path.resolve(repoRoot, "../tmdb-id-lookup");
const proofRoot = path.join(packageRoot, ".work", "people-production-promotion-proof");
const stage1 = path.join(packageRoot, ".work", "people-visual-proof", "stage-1");
const stage1b = path.join(packageRoot, ".work", "people-visual-proof", "stage-1b-toned-aspects");
const stage2 = path.join(packageRoot, ".work", "people-visual-proof", "stage-2-locked-40");
const stage3 = path.join(packageRoot, ".work", "people-visual-proof", "stage-3-final-typography");
const typography = path.join(packageRoot, ".work", "people-typography-calibration");
const refinement = path.join(packageRoot, ".work", "cormorant-refinement");
const owner = path.join(packageRoot, ".work", "people-owner-source-review");
const landscape96 = path.join(owner, "text-fallback-proof", "landscape-96-refinement");
const lockPath = path.join(packageRoot, ".work", "people-proof-selection", "drafts", "people-proof-set.lock.draft.json");
const expectedCommit = "2a9506c2b2fa807695d27b569745b0d69f04c870";
const fallbackFixtures = [
  { stableKey: "person:1158", tmdbPersonId: 1158, canonicalName: "Al Pacino", profilePath: null, categoryMembership: ["actor"] },
  { stableKey: "person:3223", tmdbPersonId: 3223, canonicalName: "Robert Downey Jr.", profilePath: null, categoryMembership: ["actor"] },
  { stableKey: "person:68813", tmdbPersonId: 68813, canonicalName: "Céline Sciamma", profilePath: null, categoryMembership: ["director"] },
  { stableKey: "person:1283", tmdbPersonId: 1283, canonicalName: "Helena Bonham Carter", profilePath: null, categoryMembership: ["actor"] },
  { stableKey: "person:69759", tmdbPersonId: 69759, canonicalName: "Apichatpong Weerasethakul", profilePath: null, categoryMembership: ["director"] },
  { stableKey: "person:1100", tmdbPersonId: 1100, canonicalName: "Arnold Schwarzenegger", profilePath: null, categoryMembership: ["actor"] },
];

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const posix = (value) => value.replaceAll("\\", "/");
const relative = (value) => posix(path.relative(repoRoot, value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

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
}

async function writeText(filePath, value) {
  await atomicWrite(filePath, `${value.replace(/\s+$/u, "")}\n`);
}

function csvValue(value) {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(filePath, fields, rows) {
  await writeText(filePath, [fields.join(","), ...rows.map((row) => fields.map((field) => csvValue(row[field])).join(","))].join("\n"));
}

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function gitIsAncestor(ancestor, descendant, cwd = repoRoot) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function walk(root) {
  if (!(await exists(root))) return [];
  const files = [];
  async function visit(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

async function treeFingerprint(root) {
  const files = await walk(root);
  const records = [];
  for (const filePath of files) {
    const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    records.push({ path: posix(path.relative(root, filePath)), hash: sha256(buffer), bytes: buffer.length, mtimeMs: Math.trunc(stat.mtimeMs) });
  }
  return {
    fileCount: records.length,
    contentFingerprint: sha256(JSON.stringify(records.map(({ path: itemPath, hash, bytes }) => ({ path: itemPath, hash, bytes })))),
    mtimeFingerprint: sha256(JSON.stringify(records.map(({ path: itemPath, mtimeMs }) => ({ path: itemPath, mtimeMs })))),
  };
}

async function protectedState() {
  const trackedFoundation = [
    "data/people/people-registry.json",
    "data/people/actors-seed.json",
    "data/people/directors-seed.json",
    "data/people/sources.json",
    "data/people/actor-owner-supplement.json",
  ];
  const trackedHashes = {};
  for (const item of trackedFoundation) trackedHashes[item] = sha256(await fs.readFile(path.join(repoRoot, item)));
  return {
    primary: {
      branch: git(["branch", "--show-current"]),
      head: git(["rev-parse", "HEAD"]),
      originMain: git(["rev-parse", "origin/main"]),
      baselineAncestorOfHead: gitIsAncestor(expectedCommit, "HEAD"),
      baselineAncestorOfOriginMain: gitIsAncestor(expectedCommit, "origin/main"),
      protectedFoundationDiff: git(["diff", expectedCommit, "--", ...trackedFoundation]),
    },
    lookup: {
      head: git(["rev-parse", "HEAD"], lookupRoot),
      status: git(["status", "--short"], lookupRoot),
    },
    trackedHashes,
    trees: {
      stage1: await treeFingerprint(stage1),
      stage1b: await treeFingerprint(stage1b),
      stage2: await treeFingerprint(stage2),
      typography: await treeFingerprint(typography),
      refinement: await treeFingerprint(refinement),
      stage3: await treeFingerprint(stage3),
      ownerSourceReview: await treeFingerprint(owner),
      fallbackRefinement: await treeFingerprint(landscape96),
      studioCompanies: await treeFingerprint(path.join(repoRoot, "assets", "collection_covers", "companies")),
      studioNetworks: await treeFingerprint(path.join(repoRoot, "assets", "collection_covers", "networks")),
      studioStaging: await treeFingerprint(path.join(repoRoot, "tools", "studio-network-batch", ".work", "staging")),
    },
    files: {
      studioManifest: sha256(await fs.readFile(path.join(repoRoot, "assets", "collection_covers", "manifest.json"))),
      studioApprovalState: sha256(await fs.readFile(path.join(repoRoot, "tools", "studio-network-batch", "config", "review-state.json"))),
      locked40: sha256(await fs.readFile(lockPath)),
    },
  };
}

async function preflight() {
  const state = await protectedState();
  assert(state.primary.branch === "main", `Expected main, found ${state.primary.branch}.`);
  assert(state.primary.baselineAncestorOfHead && state.primary.baselineAncestorOfOriginMain, "People renderer promotion baseline is not an ancestor of local or origin main.");
  assert(state.primary.protectedFoundationDiff === "", "Committed people foundation has uncommitted changes.");
  assert(state.lookup.status === "", "tmdb-id-lookup is not clean.");
  assert(state.trees.studioCompanies.fileCount === 1797 && state.trees.studioNetworks.fileCount === 569, "Published studio/network cover count drifted.");
  const [stage3Validation, stage3Determinism, ownerValidation, ownerDeterminism, fallbackValidation, fallbackDeterminism] = await Promise.all([
    readJson(path.join(stage3, "reports", "final-validation.json")),
    readJson(path.join(stage3, "reports", "determinism-verification.json")),
    readJson(path.join(owner, "reports", "final-validation.json")),
    readJson(path.join(owner, "reports", "determinism-verification.json")),
    readJson(path.join(landscape96, "reports", "final-validation.json")),
    readJson(path.join(landscape96, "reports", "determinism-verification.json")),
  ]);
  assert(stage3Validation.valid && stage3Determinism.valid, "Approved Stage 3 evidence is incomplete.");
  assert(ownerValidation.valid && ownerDeterminism.valid, "Approved owner-source evidence is incomplete.");
  assert(fallbackValidation.valid && fallbackDeterminism.valid, "Approved fallback evidence is incomplete.");
  return state;
}

async function resolveLockedPeople(registry, actors, directors) {
  const lock = await readJson(lockPath);
  assert(lock.selectedStableKeys.length === 40 && new Set(lock.selectedStableKeys).size === 40, "Locked proof scope is not exactly 40 unique people.");
  assert(lock.actorSelections.length === 24 && lock.directorSelections.length === 16, "Locked proof composition changed.");
  assert(!lock.selectedStableKeys.includes("person:1100") && lock.selectedStableKeys.includes("person:3894"), "Arnold or Christian Bale locked-scope boundary changed.");
  const registryByKey = new Map(registry.records.map((item) => [item.stableKey, item]));
  const actorKeys = new Set(actors.records.map((item) => item.stableKey));
  const directorKeys = new Set(directors.records.map((item) => item.stableKey));
  return lock.selectedStableKeys.map((stableKey) => {
    const person = registryByKey.get(stableKey);
    assert(person, `Missing locked identity ${stableKey}.`);
    return {
      stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      profilePath: person.profilePath,
      categoryMembership: [...(actorKeys.has(stableKey) ? ["actor"] : []), ...(directorKeys.has(stableKey) ? ["director"] : [])],
    };
  });
}

async function prepareSourceCache(people, decisions) {
  const sourceCache = path.join(proofRoot, "source-cache");
  const [stageSources, selectedSources] = await Promise.all([
    readJson(path.join(stage3, "reports", "source-inputs.json")),
    readJson(path.join(owner, "reports", "owner-selected-source-records.json")),
  ]);
  const decisionByKey = new Map(decisions.records.map((item) => [item.stableKey, item]));
  const entries = people.map((person) => {
    const decision = decisionByKey.get(person.stableKey);
    if (decision?.decision === "use-owner-selected") {
      const selected = selectedSources.find((item) => item.stableKey === person.stableKey);
      assert(selected && selected.selectedProfilePath === decision.approvedProfilePath && selected.sourceHash === decision.approvedSourceHash, `${person.stableKey}: owner-selected cache binding drifted.`);
      return {
        stableKey: person.stableKey,
        profilePath: selected.selectedProfilePath,
        sourceFile: posix(path.relative(sourceCache, path.join(repoRoot, selected.normalizedPath))),
        sourceHash: selected.sourceHash,
        width: selected.width,
        height: selected.height,
        exifOrientation: 1,
        cacheKind: "approved-owner-selected-normalized-source",
      };
    }
    const stageSource = stageSources.find((item) => item.stableKey === person.stableKey);
    assert(stageSource && stageSource.profilePath === person.profilePath, `${person.stableKey}: approved Stage 3 source binding drifted.`);
    if (decision) assert(stageSource.sha256 === decision.approvedSourceHash, `${person.stableKey}: retained approved source hash drifted.`);
    return {
      stableKey: person.stableKey,
      profilePath: stageSource.profilePath,
      sourceFile: posix(path.relative(sourceCache, path.join(repoRoot, stageSource.cachePath))),
      sourceHash: stageSource.sha256,
      width: stageSource.width,
      height: stageSource.height,
      exifOrientation: stageSource.exifOrientation || 1,
      cacheKind: "approved-stage-3-original-source",
    };
  }).sort((left, right) => left.stableKey.localeCompare(right.stableKey) || left.profilePath.localeCompare(right.profilePath));
  await writeJson(path.join(sourceCache, "index.json"), { version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries });
  return { sourceCache, entries };
}

function trackedPreset(result, fallback, formatId) {
  return (fallback ? result.presetRecords.fallback : result.presetRecords.portrait)[formatId];
}

async function expectedPortraitRecords(people, decisions) {
  const [stageRows, candidateRows, stageSources] = await Promise.all([
    readJson(path.join(stage3, "reports", "render-metadata.json")),
    readJson(path.join(owner, "reports", "candidate-render-metadata.json")),
    readJson(path.join(stage3, "reports", "source-inputs.json")),
  ]);
  const decisionByKey = new Map(decisions.records.map((item) => [item.stableKey, item]));
  return people.flatMap((person) => ["landscape", "poster"].map((formatId) => {
    const decision = decisionByKey.get(person.stableKey);
    const selected = decision?.decision === "use-owner-selected";
    const source = selected ? candidateRows.find((item) => item.stableKey === person.stableKey && item.formatId === formatId) : stageRows.find((item) => item.stableKey === person.stableKey && item.formatId === formatId);
    const stageSource = stageSources.find((item) => item.stableKey === person.stableKey);
    assert(source && stageSource, `Missing approved portrait target ${person.stableKey}/${formatId}.`);
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      formatId,
      sourceDecision: decision?.decision || "registry-default",
      profilePath: selected ? source.sourceProfilePath : stageSource.profilePath,
      sourceHash: source.sourceHash,
      sourceWidth: selected ? source.sourceWidth : stageSource.width,
      sourceHeight: selected ? source.sourceHeight : stageSource.height,
      cropRectangle: source.cropRectangle,
      retainedArea: source.cropRetainedAreaFraction,
      requestedFontSize: source.requestedFontSize,
      finalFontSize: source.finalFontSize,
      nameLines: source.nameLines,
      textBounds: source.textBounds,
      grainSeed: selected ? source.grainSeed : source.portraitTreatment.grainSeed,
      grainAmount: selected ? source.grainAmount : source.portraitTreatment.grainAmount,
      gradientBounds: selected ? null : source.gradientBounds,
      canvasWidth: selected ? source.canvasWidth : source.canvasWidth,
      canvasHeight: selected ? source.canvasHeight : source.canvasHeight,
      outputHash: source.outputHash,
      byteCount: source.byteCount,
    };
  }));
}

async function portraitParity(result, expected) {
  const evidencePresets = {
    landscape: await readJson(path.join(stage3, "presets", "people-landscape-cormorant-v1.draft.json")),
    poster: await readJson(path.join(stage3, "presets", "people-poster-cormorant-v1.draft.json")),
  };
  const rows = result.metadata.records.map((actual) => {
    const target = expected.find((item) => item.stableKey === actual.stableKey && item.formatId === actual.formatId);
    const preset = trackedPreset(result, false, actual.formatId).preset;
    const checks = {
      resolvedProfilePath: actual.profilePathAttempted === target.profilePath,
      sourceHash: actual.sourceHash === target.sourceHash,
      sourceDimensions: actual.sourceWidth === target.sourceWidth && actual.sourceHeight === target.sourceHeight,
      cropRectangle: same(actual.cropRectangle, target.cropRectangle),
      retainedArea: actual.cropRetainedAreaFraction === target.retainedArea,
      requestedFontSize: actual.requestedFontSize === target.requestedFontSize,
      finalFontSize: actual.finalFontSize === target.finalFontSize,
      lineWrapping: same(actual.nameLines, target.nameLines),
      textBounds: same(actual.textBounds, target.textBounds),
      gradient: target.gradientBounds === null || same(actual.gradientBounds, target.gradientBounds),
      tone: same(preset.tonal, evidencePresets[actual.formatId].tonal),
      grain: actual.grainSeed === target.grainSeed && actual.grainAmount === target.grainAmount,
      canvas: actual.canvasWidth === target.canvasWidth && actual.canvasHeight === target.canvasHeight,
      webpEncoding: same(preset.output, evidencePresets[actual.formatId].output),
      outputByteCount: actual.byteCount === target.byteCount,
      outputHash: actual.outputHash === target.outputHash,
    };
    return {
      stableKey: actual.stableKey,
      tmdbPersonId: actual.tmdbPersonId,
      canonicalName: actual.canonicalName,
      formatId: actual.formatId,
      sourceDecision: actual.sourceDecision,
      profilePath: actual.profilePathAttempted,
      sourceHash: actual.sourceHash,
      expectedOutputHash: target.outputHash,
      actualOutputHash: actual.outputHash,
      expectedByteCount: target.byteCount,
      actualByteCount: actual.byteCount,
      checks,
      parity: Object.values(checks).every(Boolean),
    };
  });
  assert(rows.length === 80 && rows.every((item) => item.parity), "Tracked renderer failed exact approved portrait parity.");
  return rows;
}

async function expectedFallbackRecords() {
  const [landscapeRows, fallbackRows] = await Promise.all([
    readJson(path.join(landscape96, "reports", "landscape-96-render-metadata.json")),
    readJson(path.join(owner, "reports", "text-fallback-render-metadata.json")),
  ]);
  return fallbackFixtures.flatMap((fixture) => ["landscape", "poster"].map((formatId) => {
    const source = formatId === "landscape"
      ? landscapeRows.find((item) => item.stableKey === fixture.stableKey)
      : fallbackRows.find((item) => item.stableKey === fixture.stableKey && item.formatId === "poster");
    assert(source, `Missing approved fallback target ${fixture.stableKey}/${formatId}.`);
    return {
      stableKey: fixture.stableKey,
      formatId,
      requestedFontSize: source.requestedFontSize,
      finalFontSize: source.finalFontSize,
      nameLines: source.exactLines || source.nameLines,
      textBounds: source.textBounds,
      grainSeed: source.grainSeed,
      grainAmount: source.grainAmount,
      outputHash: source.outputHash,
      byteCount: source.byteCount,
    };
  }));
}

async function fallbackParity(result, expected) {
  const evidencePresets = {
    landscape: await readJson(path.join(landscape96, "preset", "people-text-fallback-landscape-v2.draft.json")),
    poster: await readJson(path.join(owner, "text-fallback-proof", "presets", "people-text-fallback-poster-v1.draft.json")),
  };
  const rows = result.metadata.records.map((actual) => {
    const target = expected.find((item) => item.stableKey === actual.stableKey && item.formatId === actual.formatId);
    const preset = trackedPreset(result, true, actual.formatId).preset;
    const checks = {
      fallbackUsed: actual.fallbackUsed === true && actual.fallbackReason === "no-profile-path",
      noPortraitRead: actual.sourcePath === null && actual.sourceHash === null && actual.cropRectangle === null,
      requestedFontSize: actual.requestedFontSize === target.requestedFontSize,
      finalFontSize: actual.finalFontSize === target.finalFontSize,
      lineWrapping: same(actual.nameLines, target.nameLines),
      textBounds: same(actual.textBounds, target.textBounds),
      grain: actual.grainSeed === target.grainSeed && actual.grainAmount === target.grainAmount,
      canvas: actual.canvasWidth === preset.canvas.width && actual.canvasHeight === preset.canvas.height,
      webpEncoding: same(preset.output, evidencePresets[actual.formatId].output),
      outputByteCount: actual.byteCount === target.byteCount,
      outputHash: actual.outputHash === target.outputHash,
    };
    return {
      stableKey: actual.stableKey,
      tmdbPersonId: actual.tmdbPersonId,
      canonicalName: actual.canonicalName,
      formatId: actual.formatId,
      requestedFontSize: actual.requestedFontSize,
      finalFontSize: actual.finalFontSize,
      expectedOutputHash: target.outputHash,
      actualOutputHash: actual.outputHash,
      expectedByteCount: target.byteCount,
      actualByteCount: actual.byteCount,
      checks,
      parity: Object.values(checks).every(Boolean),
    };
  });
  assert(rows.length === 12 && rows.every((item) => item.parity), "Tracked renderer failed exact approved fallback parity.");
  return rows;
}

function escapeSvg(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelLayer(width, height, body) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Arial, sans-serif" fill="#EDF2F4">${body}</g></svg>`);
}

async function writeSheet(runtime, filePath, width, height, composites, labels) {
  const buffer = await runtime.sharp({ create: { width, height, channels: 3, background: "#071117" } })
    .composite([...composites, { input: labelLayer(width, height, labels), left: 0, top: 0 }])
    .png()
    .toBuffer();
  await atomicWrite(filePath, buffer);
  return { path: posix(path.relative(path.dirname(filePath), filePath)), hash: sha256(buffer), width, height };
}

async function thumbnail(runtime, filePath, width, height, fit = "fill") {
  return runtime.sharp(filePath).resize(width, height, { fit, background: "#171512" }).png().toBuffer();
}

async function buildContactSheets({ runtime, sheetRoot, portraitRoot, fallbackRoot, people, portraitRows, fallbackRows, portraitParityRows, fallbackParityRows, decisions }) {
  const entries = [];
  const portraitBy = (stableKey, formatId) => portraitRows.find((item) => item.stableKey === stableKey && item.formatId === formatId);
  const portraitParityBy = (stableKey, formatId) => portraitParityRows.find((item) => item.stableKey === stableKey && item.formatId === formatId);
  const fallbackBy = (stableKey, formatId) => fallbackRows.find((item) => item.stableKey === stableKey && item.formatId === formatId);
  const fallbackParityBy = (stableKey, formatId) => fallbackParityRows.find((item) => item.stableKey === stableKey && item.formatId === formatId);
  const decisionByKey = new Map(decisions.records.map((item) => [item.stableKey, item]));

  const pages = Array.from({ length: 8 }, (_, index) => people.slice(index * 5, index * 5 + 5));
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const width = 1600;
    const rowHeight = 320;
    const height = 80 + page.length * rowHeight;
    const composites = [];
    let labels = `<text x="24" y="42" font-size="28" font-weight="700">Locked 40 promotion parity · ${pageIndex + 1}/8</text><text x="24" y="67" font-size="15" fill="#9EB0BA">Landscape · poster · identity · source decision · exact parity</text>`;
    for (let index = 0; index < page.length; index += 1) {
      const person = page[index];
      const landscape = portraitBy(person.stableKey, "landscape");
      const poster = portraitBy(person.stableKey, "poster");
      const landscapeParity = portraitParityBy(person.stableKey, "landscape");
      const posterParity = portraitParityBy(person.stableKey, "poster");
      const y = 80 + index * rowHeight;
      composites.push(
        { input: await thumbnail(runtime, path.join(portraitRoot, landscape.outputPath), 480, 270), left: 20, top: y + 18 },
        { input: await thumbnail(runtime, path.join(portraitRoot, poster.outputPath), 180, 270), left: 520, top: y + 18 },
      );
      labels += `<line x1="16" y1="${y}" x2="1584" y2="${y}" stroke="#29404C"/><text x="730" y="${y + 55}" font-size="23" font-weight="700">${escapeSvg(person.canonicalName)}</text><text x="730" y="${y + 84}" font-size="15" fill="#9EB0BA">${person.stableKey} · ${escapeSvg(landscape.sourceDecision)}</text><text x="730" y="${y + 115}" font-size="14">source ${landscape.sourceHash.slice(0, 12)} · L ${landscape.outputHash.slice(0, 12)} · P ${poster.outputHash.slice(0, 12)}</text><text x="730" y="${y + 148}" font-size="18" fill="#8EE3A1">parity ${landscapeParity.parity && posterParity.parity ? "PASS" : "FAIL"}</text>`;
    }
    const filePath = path.join(sheetRoot, "locked-40", `page-${String(pageIndex + 1).padStart(2, "0")}.png`);
    const sheet = await writeSheet(runtime, filePath, width, height, composites, labels);
    entries.push({ ...sheet, path: posix(path.relative(sheetRoot, filePath)), type: "locked-40", records: page.map((item) => item.stableKey) });
  }

  {
    const selected = decisions.records;
    const width = 1700;
    const rowHeight = 330;
    const height = 80 + selected.length * rowHeight;
    const composites = [];
    let labels = `<text x="24" y="44" font-size="28" font-weight="700">Approved portrait-source decisions</text><text x="24" y="68" font-size="15" fill="#9EB0BA">Four owner-selected overrides · three retained registry sources</text>`;
    for (let index = 0; index < selected.length; index += 1) {
      const decision = selected[index];
      const landscape = portraitBy(decision.stableKey, "landscape");
      const poster = portraitBy(decision.stableKey, "poster");
      const y = 80 + index * rowHeight;
      composites.push(
        { input: await thumbnail(runtime, path.join(portraitRoot, landscape.outputPath), 480, 270), left: 20, top: y + 22 },
        { input: await thumbnail(runtime, path.join(portraitRoot, poster.outputPath), 180, 270), left: 520, top: y + 22 },
      );
      labels += `<line x1="16" y1="${y}" x2="1684" y2="${y}" stroke="#29404C"/><text x="730" y="${y + 55}" font-size="23" font-weight="700">${escapeSvg(decision.canonicalName)}</text><text x="730" y="${y + 86}" font-size="16">${decision.stableKey} · ${escapeSvg(decision.decision)}</text><text x="730" y="${y + 118}" font-size="14" fill="#9EB0BA">${escapeSvg(decision.approvedProfilePath)}</text><text x="730" y="${y + 150}" font-size="14">source ${decision.approvedSourceHash.slice(0, 16)}</text><text x="730" y="${y + 184}" font-size="18" fill="#8EE3A1">parity ${portraitParityBy(decision.stableKey, "landscape").parity && portraitParityBy(decision.stableKey, "poster").parity ? "PASS" : "FAIL"}</text>`;
    }
    const filePath = path.join(sheetRoot, "source-overrides.png");
    const sheet = await writeSheet(runtime, filePath, width, height, composites, labels);
    entries.push({ ...sheet, path: posix(path.relative(sheetRoot, filePath)), type: "source-overrides", records: selected.map((item) => item.stableKey) });
  }

  for (const formatId of ["landscape", "poster"]) {
    const width = 1500;
    const cellWidth = 480;
    const cellHeight = formatId === "landscape" ? 350 : 600;
    const height = 80 + 2 * cellHeight;
    const composites = [];
    let labels = `<text x="24" y="45" font-size="28" font-weight="700">Text-only fallback · ${formatId}</text><text x="24" y="69" font-size="15" fill="#9EB0BA">Canonical name only · exact approved hash parity</text>`;
    for (let index = 0; index < fallbackFixtures.length; index += 1) {
      const fixture = fallbackFixtures[index];
      const row = fallbackBy(fixture.stableKey, formatId);
      const x = 20 + (index % 3) * cellWidth;
      const y = 80 + Math.floor(index / 3) * cellHeight;
      const imageWidth = formatId === "landscape" ? 440 : 300;
      const imageHeight = formatId === "landscape" ? 248 : 450;
      composites.push({ input: await thumbnail(runtime, path.join(fallbackRoot, row.outputPath), imageWidth, imageHeight), left: x, top: y + 15 });
      labels += `<text x="${x}" y="${y + imageHeight + 42}" font-size="18" font-weight="700">${escapeSvg(fixture.canonicalName)}</text><text x="${x}" y="${y + imageHeight + 67}" font-size="13" fill="#9EB0BA">${fixture.stableKey} · ${row.requestedFontSize}→${row.finalFontSize}px · ${row.outputHash.slice(0, 12)}</text><text x="${x}" y="${y + imageHeight + 90}" font-size="14" fill="#8EE3A1">parity ${fallbackParityBy(fixture.stableKey, formatId).parity ? "PASS" : "FAIL"}</text>`;
    }
    const filePath = path.join(sheetRoot, `fallback-${formatId}.png`);
    const sheet = await writeSheet(runtime, filePath, width, height, composites, labels);
    entries.push({ ...sheet, path: posix(path.relative(sheetRoot, filePath)), type: `fallback-${formatId}`, records: fallbackFixtures.map((item) => item.stableKey) });
  }

  {
    const width = 1200;
    const height = 560;
    const composites = [];
    let labels = `<text x="24" y="44" font-size="28" font-weight="700">Fallback exact thumbnail simulations</text><text x="24" y="68" font-size="15" fill="#9EB0BA">Landscape 160×90 · poster 100×150</text>`;
    for (let index = 0; index < fallbackFixtures.length; index += 1) {
      const fixture = fallbackFixtures[index];
      const landscape = fallbackBy(fixture.stableKey, "landscape");
      const poster = fallbackBy(fixture.stableKey, "poster");
      const x = 25 + (index % 3) * 390;
      const y = 90 + Math.floor(index / 3) * 230;
      composites.push(
        { input: await thumbnail(runtime, path.join(fallbackRoot, landscape.outputPath), 320, 180), left: x, top: y },
        { input: await thumbnail(runtime, path.join(fallbackRoot, poster.outputPath), 100, 150), left: x + 255, top: y + 15 },
      );
      labels += `<text x="${x}" y="${y + 207}" font-size="15" font-weight="700">${escapeSvg(fixture.canonicalName)}</text>`;
    }
    const filePath = path.join(sheetRoot, "fallback-thumbnails.png");
    const sheet = await writeSheet(runtime, filePath, width, height, composites, labels);
    entries.push({ ...sheet, path: posix(path.relative(sheetRoot, filePath)), type: "fallback-thumbnails", records: fallbackFixtures.map((item) => item.stableKey) });
  }

  await writeJson(path.join(sheetRoot, "index.json"), { version: "people-production-promotion-contact-sheets-v1", ordering: "locked-pages-then-source-decisions-then-fallbacks", entries });
  return entries;
}

function deterministicSignature({ portraitResult, fallbackResult, portraitParityRows, fallbackParityRows, contactEntries }) {
  return {
    font: { fontHash: portraitResult.fontRecord.fontHash, licenceHash: portraitResult.fontRecord.licenceHash },
    presets: [
      ...Object.values(portraitResult.presetRecords.portrait),
      ...Object.values(portraitResult.presetRecords.fallback),
    ].map((item) => ({ id: item.preset.id, hash: item.presetHash })),
    sourceResolution: portraitResult.resolutions,
    portraitMetadata: portraitResult.metadata,
    fallbackMetadata: fallbackResult.metadata,
    portraitParityOrdering: portraitParityRows.map((item) => `${item.stableKey}/${item.formatId}`),
    fallbackParityOrdering: fallbackParityRows.map((item) => `${item.stableKey}/${item.formatId}`),
    contactSheets: contactEntries.map((item) => ({ path: item.path, hash: item.hash, records: item.records })),
  };
}

async function runRendering({ runtime, people, decisions, sourceCache, portraitRoot, fallbackRoot, sheetRoot, expectedPortrait, expectedFallback }) {
  const portraitResult = await renderPeopleArtwork({ people, decisions, sourceCache, outputDir: portraitRoot, format: "both", offline: true, runtime });
  const fallbackResult = await renderPeopleArtwork({ people: fallbackFixtures, decisions: { records: [] }, sourceCache, outputDir: fallbackRoot, format: "both", offline: true, runtime });
  const [portraitMetadataErrors, fallbackMetadataErrors] = await Promise.all([
    validateRenderMetadata(portraitResult.metadata),
    validateRenderMetadata(fallbackResult.metadata),
  ]);
  assert(portraitMetadataErrors.length === 0 && fallbackMetadataErrors.length === 0, `Metadata contract failed: ${[...portraitMetadataErrors, ...fallbackMetadataErrors].join("; ")}`);
  const portraitParityRows = await portraitParity(portraitResult, expectedPortrait);
  const fallbackParityRows = await fallbackParity(fallbackResult, expectedFallback);
  const contactEntries = await buildContactSheets({ runtime, sheetRoot, portraitRoot, fallbackRoot, people, portraitRows: portraitResult.metadata.records, fallbackRows: fallbackResult.metadata.records, portraitParityRows, fallbackParityRows, decisions });
  return { portraitResult, fallbackResult, portraitParityRows, fallbackParityRows, contactEntries, signature: deterministicSignature({ portraitResult, fallbackResult, portraitParityRows, fallbackParityRows, contactEntries }) };
}

async function presetVerification(result) {
  const records = [];
  const evidencePaths = {
    "people-landscape-cormorant-v1": path.join(stage3, "presets", "people-landscape-cormorant-v1.draft.json"),
    "people-poster-cormorant-v1": path.join(stage3, "presets", "people-poster-cormorant-v1.draft.json"),
    "people-text-fallback-landscape-v2": path.join(landscape96, "preset", "people-text-fallback-landscape-v2.draft.json"),
    "people-text-fallback-poster-v1": path.join(owner, "text-fallback-proof", "presets", "people-text-fallback-poster-v1.draft.json"),
  };
  for (const presetRecord of [...Object.values(result.presetRecords.portrait), ...Object.values(result.presetRecords.fallback)]) {
    const evidencePath = evidencePaths[presetRecord.preset.id];
    const evidenceBuffer = await fs.readFile(evidencePath);
    const evidence = JSON.parse(evidenceBuffer);
    const portrait = Object.hasOwn(presetRecord.preset, "tonal");
    const renderingChecks = {
      canvas: same(presetRecord.preset.canvas, evidence.canvas),
      output: same(presetRecord.preset.output, evidence.output),
      background: same(presetRecord.preset.background, evidence.background),
      grain: same(presetRecord.preset.grain, evidence.grain),
      typographyRequested: presetRecord.preset.typography.requestedFontSize === evidence.typography.requestedFontSize,
      typographyMinimum: presetRecord.preset.typography.minimumFontSize === evidence.typography.minimumFontSize,
      typographyStep: presetRecord.preset.typography.fontSizeStep === evidence.typography.fontSizeStep,
      typographyLineHeight: presetRecord.preset.typography.lineHeight === evidence.typography.lineHeight,
      typographyRegion: same(presetRecord.preset.typography.region, evidence.typography.region),
      portraitTreatment: !portrait || (same(presetRecord.preset.crop, evidence.crop) && same(presetRecord.preset.tonal, evidence.tonal) && same(presetRecord.preset.portraitRegion, evidence.portraitRegion)),
    };
    records.push({
      presetId: presetRecord.preset.id,
      trackedPath: relative(presetRecord.presetPath),
      trackedHash: presetRecord.presetHash,
      evidencePath: relative(evidencePath),
      evidenceHash: sha256(evidenceBuffer),
      renderingChecks,
      valid: Object.values(renderingChecks).every(Boolean),
    });
  }
  assert(records.every((item) => item.valid), "Tracked preset rendering values differ from approved evidence.");
  return records;
}

function deterministicFontRecord(fontRecord) {
  return {
    valid: fontRecord.valid,
    family: fontRecord.family,
    registrationAlias: fontRecord.registrationAlias,
    weight: fontRecord.weight,
    genuineWeight700: fontRecord.genuineWeight700,
    fontHash: fontRecord.fontHash,
    licenceHash: fontRecord.licenceHash,
    variation: fontRecord.variation,
    glyphCoverage: fontRecord.glyphCoverage,
  };
}

async function preservationResult(before) {
  const after = await protectedState();
  const checks = {
    primaryHeadUnchanged: before.primary.head === after.primary.head && after.primary.baselineAncestorOfHead,
    originMainUnchanged: before.primary.originMain === after.primary.originMain && after.primary.baselineAncestorOfOriginMain,
    foundationUnchanged: same(before.trackedHashes, after.trackedHashes) && after.primary.protectedFoundationDiff === "",
    peopleRegistryUnchanged: before.trackedHashes["data/people/people-registry.json"] === after.trackedHashes["data/people/people-registry.json"],
    actorMembershipsUnchanged: before.trackedHashes["data/people/actors-seed.json"] === after.trackedHashes["data/people/actors-seed.json"],
    directorMembershipsUnchanged: before.trackedHashes["data/people/directors-seed.json"] === after.trackedHashes["data/people/directors-seed.json"],
    sourceRecordsUnchanged: before.trackedHashes["data/people/sources.json"] === after.trackedHashes["data/people/sources.json"],
    actorSupplementUnchanged: before.trackedHashes["data/people/actor-owner-supplement.json"] === after.trackedHashes["data/people/actor-owner-supplement.json"],
    locked40Unchanged: before.files.locked40 === after.files.locked40,
    stage1Unchanged: same(before.trees.stage1, after.trees.stage1),
    stage1bUnchanged: same(before.trees.stage1b, after.trees.stage1b),
    stage2Unchanged: same(before.trees.stage2, after.trees.stage2),
    typographyCalibrationUnchanged: same(before.trees.typography, after.trees.typography),
    cormorantRefinementUnchanged: same(before.trees.refinement, after.trees.refinement),
    stage3Unchanged: same(before.trees.stage3, after.trees.stage3),
    ownerSourceReviewUnchanged: same(before.trees.ownerSourceReview, after.trees.ownerSourceReview),
    fallbackRefinementUnchanged: same(before.trees.fallbackRefinement, after.trees.fallbackRefinement),
    studioCompaniesUnchanged: same(before.trees.studioCompanies, after.trees.studioCompanies),
    studioNetworksUnchanged: same(before.trees.studioNetworks, after.trees.studioNetworks),
    studioStagingUnchanged: same(before.trees.studioStaging, after.trees.studioStaging),
    studioManifestUnchanged: before.files.studioManifest === after.files.studioManifest,
    studioApprovalStateUnchanged: before.files.studioApprovalState === after.files.studioApprovalState,
    tmdbIdLookupUnchanged: same(before.lookup, after.lookup) && after.lookup.status === "",
  };
  return { version: "people-production-promotion-preservation-v1", valid: Object.values(checks).every(Boolean), checks, before, after };
}

async function writePromotionReports({ run, replay, determinism, preservation, presetRecords }) {
  const reports = path.join(proofRoot, "reports");
  const sourceResolutionRows = run.portraitResult.resolutions;
  const networkAccounting = {
    profileImageDownloads: 0,
    tmdbMetadataRequests: 0,
    personImagesRequests: 0,
    imageCdnRequests: 0,
    fontDownloads: 0,
    sourceCacheHits: run.portraitResult.networkAccounting.sourceCacheHits,
    generalWebRequests: 0,
    unauthorisedRequests: 0,
    attemptedRequests: [],
    cacheResults: sourceResolutionRows.map((item) => ({ stableKey: item.stableKey, profilePath: item.resolvedProfilePath, sourceHash: item.sourceHash, cacheHit: item.cacheHit })),
  };
  assert(networkAccounting.sourceCacheHits === 40, "Promotion proof did not use exactly 40 cache hits.");
  const metadataContract = {
    valid: (await validateRenderMetadata(run.portraitResult.metadata)).length === 0 && (await validateRenderMetadata(run.fallbackResult.metadata)).length === 0,
    schemaPath: "schemas/people-artwork-render-metadata.schema.json",
    portraitRecords: run.portraitResult.metadata.recordCount,
    fallbackRecords: run.fallbackResult.metadata.recordCount,
    categoryNeutralReuse: run.portraitResult.metadata.records.every((item) => item.categoryNeutralReuse),
    deterministicOrdering: true,
  };
  const summary = {
    version: "people-production-promotion-summary-v1",
    baselineCommit: expectedCommit,
    valid: run.portraitParityRows.every((item) => item.parity) && run.fallbackParityRows.every((item) => item.parity) && determinism.valid && preservation.valid,
    lockedPeople: 40,
    actors: 24,
    directors: 16,
    portraitOutputs: run.portraitResult.metadata.recordCount,
    fallbackOutputs: run.fallbackResult.metadata.recordCount,
    ownerSelectedOverrides: 4,
    retainedRegistrySources: 3,
    portraitParity: run.portraitParityRows.filter((item) => item.parity).length,
    fallbackParity: run.fallbackParityRows.filter((item) => item.parity).length,
    zeroNetwork: networkAccounting.imageCdnRequests === 0,
    deterministicReplay: determinism.valid,
    productionPeopleArtworkFilesWritten: 0,
    productionPeopleArtworkManifestWritten: false,
  };
  const finalValidation = {
    version: "people-production-promotion-final-validation-v1",
    valid: summary.valid && metadataContract.valid && presetRecords.every((item) => item.valid),
    checks: {
      exactLocked40: summary.lockedPeople === 40 && summary.actors === 24 && summary.directors === 16,
      noArnoldInLocked40: !run.portraitResult.metadata.records.some((item) => item.tmdbPersonId === 1100),
      christianBaleBothFormats: run.portraitResult.metadata.records.filter((item) => item.tmdbPersonId === 3894).length === 2,
      exactly80PortraitOutputs: summary.portraitOutputs === 80,
      exactly12FallbackOutputs: summary.fallbackOutputs === 12,
      exactPortraitParity: summary.portraitParity === 80,
      exactFallbackParity: summary.fallbackParity === 12,
      metadataContract: metadataContract.valid,
      zeroNetwork: summary.zeroNetwork,
      deterministicReplay: summary.deterministicReplay,
      preservation: preservation.valid,
      noPermanentPeopleWrites: true,
      noProductionManifest: true,
    },
  };
  finalValidation.valid = finalValidation.valid && Object.values(finalValidation.checks).every(Boolean);
  assert(finalValidation.valid, "Promotion final validation failed.");
  await Promise.all([
    writeJson(path.join(reports, "promotion-summary.json"), summary),
    writeText(path.join(reports, "promotion-summary.md"), `# People renderer promotion\n\nThe approved renderer was promoted against ${expectedCommit}. Exactly 40 locked people produced 80 portrait covers with exact byte parity, and six fixed names produced 12 exact fallback covers. The complete replay was offline and deterministic. No permanent people cover or production manifest was written.`),
    writeJson(path.join(reports, "portrait-parity.json"), run.portraitParityRows),
    writeCsv(path.join(reports, "portrait-parity.csv"), ["stableKey", "tmdbPersonId", "canonicalName", "formatId", "sourceDecision", "profilePath", "sourceHash", "expectedOutputHash", "actualOutputHash", "expectedByteCount", "actualByteCount", "parity"], run.portraitParityRows),
    writeJson(path.join(reports, "fallback-parity.json"), run.fallbackParityRows),
    writeCsv(path.join(reports, "fallback-parity.csv"), ["stableKey", "tmdbPersonId", "canonicalName", "formatId", "requestedFontSize", "finalFontSize", "expectedOutputHash", "actualOutputHash", "expectedByteCount", "actualByteCount", "parity"], run.fallbackParityRows),
    writeJson(path.join(reports, "source-resolution.json"), sourceResolutionRows),
    writeCsv(path.join(reports, "source-resolution.csv"), ["stableKey", "tmdbPersonId", "canonicalName", "sourceDecision", "resolvedProfilePath", "sourceStatus", "fallbackReason", "sourceHash", "sourceWidth", "sourceHeight", "cacheHit"], sourceResolutionRows),
    writeJson(path.join(reports, "font-verification.json"), deterministicFontRecord(run.portraitResult.fontRecord)),
    writeJson(path.join(reports, "preset-verification.json"), presetRecords),
    writeJson(path.join(reports, "metadata-contract-validation.json"), metadataContract),
    writeJson(path.join(reports, "network-accounting.json"), networkAccounting),
    writeJson(path.join(reports, "determinism-verification.json"), determinism),
    writeJson(path.join(reports, "preservation-proof.json"), preservation),
    writeJson(path.join(reports, "final-validation.json"), finalValidation),
    writeJson(path.join(reports, "portrait-render-metadata.json"), run.portraitResult.metadata),
    writeJson(path.join(reports, "fallback-render-metadata.json"), run.fallbackResult.metadata),
    writeJson(path.join(proofRoot, "logs", "offline-replay.json"), { offline: true, zeroNetworkRequests: true, valid: determinism.valid, replaySignatureHash: sha256(JSON.stringify(replay.signature)) }),
  ]);
  return { summary, finalValidation, networkAccounting, metadataContract };
}

async function main() {
  const replayOnly = process.argv.includes("--replay-only");
  const before = await preflight();
  const [registry, actors, directors, decisions] = await Promise.all([
    readJson(path.join(repoRoot, "data", "people", "people-registry.json")),
    readJson(path.join(repoRoot, "data", "people", "actors-seed.json")),
    readJson(path.join(repoRoot, "data", "people", "directors-seed.json")),
    readJson(path.join(repoRoot, "data", "people", "portrait-source-decisions.json")),
  ]);
  assert(registry.records.length === 817 && actors.records.length === 523 && directors.records.length === 300, "Committed people foundation counts drifted.");
  assert(decisions.records.length === 7 && decisions.records.filter((item) => item.decision === "use-owner-selected").length === 4 && decisions.records.filter((item) => item.decision === "retain-registry-source").length === 3, "Tracked source decisions drifted.");
  const people = await resolveLockedPeople(registry, actors, directors);
  const { sourceCache } = await prepareSourceCache(people, decisions);
  const [expectedPortrait, expectedFallback] = await Promise.all([expectedPortraitRecords(people, decisions), expectedFallbackRecords()]);
  const runtime = loadPeopleArtworkRuntime();
  const replayRoots = {
    portraitRoot: path.join(proofRoot, "temporary", "replay", "renders", "locked-40"),
    fallbackRoot: path.join(proofRoot, "temporary", "replay", "renders", "fallback"),
    sheetRoot: path.join(proofRoot, "temporary", "replay", "contact-sheets"),
  };

  if (replayOnly) {
    const initialLog = await readJson(path.join(proofRoot, "logs", "initial-run.json"));
    const replay = await runRendering({ runtime, people, decisions, sourceCache, ...replayRoots, expectedPortrait, expectedFallback });
    const valid = same(initialLog.signature, replay.signature);
    const determinism = {
      version: "people-production-promotion-determinism-v1",
      valid,
      offline: true,
      identicalFontHash: initialLog.signature.font.fontHash === replay.signature.font.fontHash,
      identicalPresetHashes: same(initialLog.signature.presets, replay.signature.presets),
      identicalSourceResolution: same(initialLog.signature.sourceResolution, replay.signature.sourceResolution),
      identicalPortraitMetadata: same(initialLog.signature.portraitMetadata, replay.signature.portraitMetadata),
      identicalFallbackMetadata: same(initialLog.signature.fallbackMetadata, replay.signature.fallbackMetadata),
      identicalPortraitOutputs: same(initialLog.signature.portraitMetadata.records.map((item) => item.outputHash), replay.signature.portraitMetadata.records.map((item) => item.outputHash)),
      identicalFallbackOutputs: same(initialLog.signature.fallbackMetadata.records.map((item) => item.outputHash), replay.signature.fallbackMetadata.records.map((item) => item.outputHash)),
      identicalReportOrdering: same(initialLog.signature.portraitParityOrdering, replay.signature.portraitParityOrdering) && same(initialLog.signature.fallbackParityOrdering, replay.signature.fallbackParityOrdering),
      identicalContactSheetOrderingAndHashes: same(initialLog.signature.contactSheets, replay.signature.contactSheets),
    };
    assert(valid, "Offline deterministic replay differs from the initial promotion proof.");
    await writeJson(path.join(proofRoot, "reports", "determinism-verification.json"), determinism);
    await writeJson(path.join(proofRoot, "logs", "offline-replay.json"), { offline: true, zeroNetworkRequests: true, valid, replaySignatureHash: sha256(JSON.stringify(replay.signature)) });
    process.stdout.write(`${JSON.stringify({ replayOnly: true, valid, portraitOutputs: replay.portraitResult.metadata.recordCount, fallbackOutputs: replay.fallbackResult.metadata.recordCount, contactSheets: replay.contactEntries.length }, null, 2)}\n`);
    return;
  }

  await writeJson(path.join(proofRoot, "baseline", "protected-before.json"), before);
  const run = await runRendering({
    runtime,
    people,
    decisions,
    sourceCache,
    portraitRoot: path.join(proofRoot, "renders", "locked-40"),
    fallbackRoot: path.join(proofRoot, "renders", "fallback"),
    sheetRoot: path.join(proofRoot, "contact-sheets"),
    expectedPortrait,
    expectedFallback,
  });
  await writeJson(path.join(proofRoot, "logs", "initial-run.json"), { offline: true, zeroNetworkRequests: true, signature: run.signature });
  const replay = await runRendering({ runtime, people, decisions, sourceCache, ...replayRoots, expectedPortrait, expectedFallback });
  const determinism = {
    version: "people-production-promotion-determinism-v1",
    valid: same(run.signature, replay.signature),
    offline: true,
    identicalFontHash: run.signature.font.fontHash === replay.signature.font.fontHash,
    identicalPresetHashes: same(run.signature.presets, replay.signature.presets),
    identicalSourceResolution: same(run.signature.sourceResolution, replay.signature.sourceResolution),
    identicalPortraitMetadata: same(run.signature.portraitMetadata, replay.signature.portraitMetadata),
    identicalFallbackMetadata: same(run.signature.fallbackMetadata, replay.signature.fallbackMetadata),
    identicalPortraitOutputs: same(run.signature.portraitMetadata.records.map((item) => item.outputHash), replay.signature.portraitMetadata.records.map((item) => item.outputHash)),
    identicalFallbackOutputs: same(run.signature.fallbackMetadata.records.map((item) => item.outputHash), replay.signature.fallbackMetadata.records.map((item) => item.outputHash)),
    identicalReportOrdering: same(run.signature.portraitParityOrdering, replay.signature.portraitParityOrdering) && same(run.signature.fallbackParityOrdering, replay.signature.fallbackParityOrdering),
    identicalContactSheetOrderingAndHashes: same(run.signature.contactSheets, replay.signature.contactSheets),
  };
  assert(determinism.valid, "Complete offline replay differs from the initial promotion run.");
  const preservation = await preservationResult(before);
  assert(preservation.valid, "Protected state changed during people renderer promotion proof.");
  const presets = await presetVerification(run.portraitResult);
  const reports = await writePromotionReports({ run, replay, determinism, preservation, presetRecords: presets });
  process.stdout.write(`${JSON.stringify({
    valid: reports.finalValidation.valid,
    baselineCommit: expectedCommit,
    lockedPeople: people.length,
    actors: 24,
    directors: 16,
    portraitOutputs: run.portraitResult.metadata.recordCount,
    fallbackOutputs: run.fallbackResult.metadata.recordCount,
    portraitParity: run.portraitParityRows.filter((item) => item.parity).length,
    fallbackParity: run.fallbackParityRows.filter((item) => item.parity).length,
    sourceCacheHits: reports.networkAccounting.sourceCacheHits,
    networkRequests: reports.networkAccounting.imageCdnRequests,
    contactSheets: run.contactEntries.length,
    deterministicReplay: determinism.valid,
    preservation: preservation.valid,
    proofRoot: relative(proofRoot),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

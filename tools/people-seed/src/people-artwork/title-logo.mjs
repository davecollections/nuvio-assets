import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "../people-publication.mjs";
import { validateAgainstSchema } from "../schema-validator.mjs";
import { runFamilies, verifyFont } from "./font.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

export const PEOPLE_TITLE_LOGO_RENDERER_VERSION = "people-title-logo-renderer-v1";
export const PEOPLE_TITLE_LOGO_PRESET_ID = "people-title-logo-cinematic-v1";
export const PEOPLE_TITLE_LOGO_PRESET_PATH = "tools/people-seed/presets/people-title-logo-cinematic-v1.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_PATH = "data/people/title-logo-line-break-overrides.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH = "schemas/people-title-logo-line-break-overrides.schema.json";
export const PEOPLE_TITLE_LOGO_PUBLIC_ROOT = "assets/collection_covers/people/title-logo";

export const TITLE_LOGO_PROOF_IDENTITIES = Object.freeze([
  Object.freeze([47, "Björk"]),
  Object.freeze([655, "John Rhys-Davies"]),
  Object.freeze([1164, "F. Murray Abraham"]),
  Object.freeze([3829, "Jean-Paul Belmondo"]),
  Object.freeze([6730, "Sacha Baron Cohen"]),
  Object.freeze([8892, "Olivia Newton-John"]),
  Object.freeze([8630, "Erich von Stroheim"]),
  Object.freeze([13848, "Charlie Chaplin"]),
  Object.freeze([21041, "Shohreh Aghdashloo"]),
  Object.freeze([45400, "Greta Gerwig"]),
  Object.freeze([56734, "Chloë Grace Moretz"]),
  Object.freeze([60561, "Mo'Nique"]),
  Object.freeze([70131, "Tatsuya Nakadai"]),
  Object.freeze([77234, "Priyanka Chopra Jonas"]),
  Object.freeze([121529, "Léa Seydoux"]),
  Object.freeze([2230991, "Daisy Edgar-Jones"]),
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const round = (value, places = 3) => Number(value.toFixed(places));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

export function assertPeopleV3ProofPath(targetPath, { repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(repoRoot, resolved).replaceAll("\\", "/");
  assert(/^tools\/people-seed\/\.work\/people-v3-artwork-proof\/attempt-[0-9]{8}T[0-9]{6}Z(?:\/|$)/u.test(relative), `People v3 proof output must remain in a unique ignored attempt workspace: ${resolved}`);
  return resolved;
}

export function validateTitleLogoOverrides(document, schema, { registry = null } = {}) {
  const errors = validateAgainstSchema(document, schema, "title-logo-line-break-overrides.json");
  if (document?.recordCount !== document?.records?.length) errors.push("title-logo override recordCount must equal records length");
  const ids = new Set();
  const keys = new Set();
  const registryById = registry ? new Map(registry.records.map((record) => [record.tmdbPersonId, record])) : null;
  for (const [index, record] of (Array.isArray(document?.records) ? document.records : []).entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (ids.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate title-logo override TMDB Person ID`);
    if (keys.has(record.stableKey)) errors.push(`${record.stableKey}: duplicate title-logo override stable key`);
    ids.add(record.tmdbPersonId);
    keys.add(record.stableKey);
    if (index > 0 && document.records[index - 1]?.tmdbPersonId >= record.tmdbPersonId) errors.push("title-logo overrides must use ascending TMDB Person ID order");
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: title-logo override identity mismatch`);
    if (Array.isArray(record.lines) && record.lines.join(" ") !== record.canonicalName) errors.push(`${record.stableKey}: title-logo override lines do not preserve the exact canonical name`);
    if (registryById) {
      const person = registryById.get(record.tmdbPersonId);
      if (!person || person.stableKey !== record.stableKey || person.canonicalName !== record.canonicalName) errors.push(`${record.stableKey}: title-logo override differs from the People registry`);
    }
  }
  return errors;
}

export async function loadTitleLogoConfiguration({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const presetPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_PRESET_PATH);
  const overridePath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_PATH);
  const overrideSchemaPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH);
  const fontLockPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "config", "cormorant-garamond-700.json");
  const [presetBuffer, overrideBuffer, schemaBuffer, fontLockBuffer] = await Promise.all([
    fs.readFile(presetPath),
    fs.readFile(overridePath),
    fs.readFile(overrideSchemaPath),
    fs.readFile(fontLockPath),
  ]);
  const preset = JSON.parse(presetBuffer);
  const overrides = JSON.parse(overrideBuffer);
  const overrideSchema = JSON.parse(schemaBuffer);
  const errors = validateTitleLogoOverrides(overrides, overrideSchema, { registry });
  if (errors.length) throw new Error(`Title-logo overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  assert(preset.id === PEOPLE_TITLE_LOGO_PRESET_ID && preset.rendererVersion === PEOPLE_TITLE_LOGO_RENDERER_VERSION, "Title-logo preset identity or renderer version changed.");
  assert(preset.canvas.width === 1863 && preset.canvas.height === 673 && preset.output.alpha === true, "Title-logo preset must remain 1863x673 transparent PNG.");
  return {
    preset,
    presetPath,
    presetHash: sha256(presetBuffer),
    overrides,
    overridePath,
    overrideHash: sha256(overrideBuffer),
    overridesById: new Map(overrides.records.map((record) => [record.tmdbPersonId, record])),
    fontLock: JSON.parse(fontLockBuffer),
    fontLockHash: sha256(fontLockBuffer),
  };
}

function textContext(runtime, fontRecord, fontSize, letterSpacing = 0) {
  const canvas = new runtime.Canvas(3200, 800);
  const context = canvas.getContext("2d");
  context.font = `${fontRecord.weight} ${fontSize}px "${fontRecord.registrationAlias}"`;
  context.letterSpacing = `${letterSpacing}px`;
  context.textBaseline = "alphabetic";
  return context;
}

function measureText(text, runtime, fontRecord, fontSize, letterSpacing = 0) {
  const metrics = textContext(runtime, fontRecord, fontSize, letterSpacing).measureText(text);
  const families = runFamilies(metrics);
  assert(families.length > 0 && families.every((family) => family === fontRecord.family), `Title-logo glyph fallback detected for ${text}: ${families.join(", ")}`);
  return {
    text,
    width: metrics.width,
    ascent: Math.max(1, metrics.actualBoundingBoxAscent),
    descent: Math.max(1, metrics.actualBoundingBoxDescent),
  };
}

function balancedLines(canonicalName, presentationName, runtime, fontRecord, fontSize) {
  const canonicalWords = canonicalName.trim().split(/\s+/u);
  const presentationWords = presentationName.trim().split(/\s+/u);
  if (canonicalWords.length < 2) return { canonicalLines: [canonicalName], presentationLines: [presentationName] };
  const candidates = [];
  for (let split = 1; split < canonicalWords.length; split += 1) {
    const canonicalLines = [canonicalWords.slice(0, split).join(" "), canonicalWords.slice(split).join(" ")];
    const presentationLines = [presentationWords.slice(0, split).join(" "), presentationWords.slice(split).join(" ")];
    const widths = presentationLines.map((line) => measureText(line, runtime, fontRecord, fontSize).width);
    candidates.push({ canonicalLines, presentationLines, difference: Math.abs(widths[0] - widths[1]), maximumWidth: Math.max(...widths), split });
  }
  candidates.sort((left, right) => left.difference - right.difference || left.maximumWidth - right.maximumWidth || left.split - right.split);
  return candidates[0];
}

function linePlan(person, preset, configuration, runtime, fontRecord) {
  const presentationName = person.canonicalName.toLocaleUpperCase("en-US");
  const manual = configuration.overridesById.get(person.tmdbPersonId) || null;
  if (manual) {
    assert(manual.stableKey === person.stableKey && manual.canonicalName === person.canonicalName, `${person.stableKey}: manual title-logo override identity drifted.`);
    return {
      canonicalLines: [...manual.lines],
      presentationLines: manual.lines.map((line) => line.toLocaleUpperCase("en-US")),
      source: "manual-exact-id-override",
      override: manual,
      presentationName,
    };
  }
  const full = measureText(presentationName, runtime, fontRecord, preset.typography.requestedFontSize);
  if (full.width <= preset.typography.region.width) {
    return { canonicalLines: [person.canonicalName], presentationLines: [presentationName], source: "automatic-measured-one-line", override: null, presentationName };
  }
  return { ...balancedLines(person.canonicalName, presentationName, runtime, fontRecord, preset.typography.requestedFontSize), source: "automatic-balanced-word-boundary", override: null, presentationName };
}

function fitLines(plan, preset, runtime, fontRecord) {
  const typography = preset.typography;
  let chosen = null;
  for (let fontSize = typography.requestedFontSize; fontSize >= typography.minimumFontSize; fontSize -= typography.fontSizeStep) {
    const measures = plan.presentationLines.map((line) => measureText(line, runtime, fontRecord, fontSize, typography.letterSpacing));
    const maxAscent = Math.max(...measures.map((item) => item.ascent));
    const maxDescent = Math.max(...measures.map((item) => item.descent));
    const width = Math.max(...measures.map((item) => item.width));
    const height = maxAscent + maxDescent + (measures.length - 1) * typography.lineHeight;
    chosen = { fontSize, measures, maxAscent, maxDescent, width, height };
    if (width <= typography.region.width && height <= typography.region.height) break;
  }
  assert(chosen && chosen.width <= typography.region.width + 0.5 && chosen.height <= typography.region.height + 0.5, `Title-logo typography cannot fit ${plan.presentationName}.`);
  return chosen;
}

function drawTrackedText(context, text, centerX, baseline, tracking, runtime, fontRecord, fontSize) {
  const characters = [...text];
  const measures = characters.map((character) => measureText(character, runtime, fontRecord, fontSize));
  const width = measures.reduce((sum, item) => sum + item.width, 0) + Math.max(0, characters.length - 1) * tracking;
  let x = centerX - width / 2;
  for (let index = 0; index < characters.length; index += 1) {
    context.fillText(characters[index], x, baseline);
    x += measures[index].width + tracking;
  }
  return { x: round(centerX - width / 2), y: round(baseline - Math.max(...measures.map((item) => item.ascent))), width: round(width), height: round(Math.max(...measures.map((item) => item.ascent + item.descent))), baseline: round(baseline) };
}

export async function prepareTitleLogoRenderer({ people, configuration = null, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const resolvedConfiguration = configuration || await loadTitleLogoConfiguration();
  assert(runtime.versions.skiaCanvas === resolvedConfiguration.preset.renderer.skiaCanvas, `Title-logo Skia runtime must be ${resolvedConfiguration.preset.renderer.skiaCanvas}.`);
  const glyphTexts = people.flatMap((person) => [person.canonicalName.toLocaleUpperCase("en-US")]);
  glyphTexts.push(resolvedConfiguration.preset.subtitle.text);
  const fontRecord = await verifyFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: glyphTexts, fontDirectory });
  assert(fontRecord.fontHash === resolvedConfiguration.preset.typography.fontHash, "Title-logo preset font hash differs from the approved font lock.");
  return { runtime, configuration: resolvedConfiguration, fontRecord };
}

export async function renderTitleLogo({ person, runtime, configuration, fontRecord } = {}) {
  const { preset } = configuration;
  const plan = linePlan(person, preset, configuration, runtime, fontRecord);
  assert(plan.canonicalLines.join(" ") === person.canonicalName, `${person.stableKey}: title-logo lines changed the canonical name.`);
  assert(plan.presentationLines.join(" ") === plan.presentationName, `${person.stableKey}: uppercase title-logo lines changed the canonical name.`);
  assert(plan.presentationLines.length <= preset.typography.maximumLines, `${person.stableKey}: title-logo exceeds the maximum line count.`);
  const chosen = fitLines(plan, preset, runtime, fontRecord);
  const canvas = new runtime.Canvas(preset.canvas.width, preset.canvas.height);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, preset.canvas.width, preset.canvas.height);
  context.fillStyle = preset.typography.colour;
  context.font = `${fontRecord.weight} ${chosen.fontSize}px "${fontRecord.registrationAlias}"`;
  context.letterSpacing = `${preset.typography.letterSpacing}px`;
  context.textBaseline = "alphabetic";
  const region = preset.typography.region;
  const top = region.y + (region.height - chosen.height) / 2;
  const lineBounds = chosen.measures.map((measure, index) => {
    const x = region.x + (region.width - measure.width) / 2;
    const baseline = top + chosen.maxAscent + index * preset.typography.lineHeight;
    context.fillText(plan.presentationLines[index], x, baseline);
    return { x: round(x), y: round(baseline - measure.ascent), width: round(measure.width), height: round(measure.ascent + measure.descent), baseline: round(baseline) };
  });
  context.save();
  context.globalAlpha = preset.divider.opacity;
  context.fillStyle = preset.divider.colour;
  context.fillRect(preset.divider.x, preset.divider.y, preset.divider.width, preset.divider.height);
  context.restore();
  context.fillStyle = preset.subtitle.colour;
  context.font = `${fontRecord.weight} ${preset.subtitle.fontSize}px "${fontRecord.registrationAlias}"`;
  context.textBaseline = "alphabetic";
  const subtitleBounds = drawTrackedText(context, preset.subtitle.text, preset.canvas.width / 2, preset.subtitle.baselineY, preset.subtitle.tracking, runtime, fontRecord, preset.subtitle.fontSize);
  const output = await canvas.toBuffer("png");
  const decoded = await runtime.sharp(output, { failOn: "error" }).metadata();
  assert(decoded.format === "png" && decoded.width === 1863 && decoded.height === 673 && decoded.hasAlpha === true && decoded.channels === 4, `${person.stableKey}: title-logo output is not exact 1863x673 RGBA PNG.`);
  const minX = Math.min(...lineBounds.map((bound) => bound.x));
  const minY = Math.min(...lineBounds.map((bound) => bound.y));
  const maxX = Math.max(...lineBounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...lineBounds.map((bound) => bound.y + bound.height));
  const textBounds = { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
  const safeMargins = {
    left: round(minX),
    right: round(preset.canvas.width - maxX),
    top: round(minY),
    bottom: round(preset.canvas.height - maxY),
  };
  assert(Object.values(safeMargins).every((value) => value >= preset.typography.minimumCanvasMargin), `${person.stableKey}: title-logo text violates the minimum canvas margin.`);
  return {
    output,
    record: {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationName: plan.presentationName,
      categories: [...person.categoryMembership],
      lineBreakSource: plan.source,
      manualOverrideId: plan.override?.stableKey || null,
      canonicalNameLines: plan.canonicalLines,
      presentationLines: plan.presentationLines,
      requestedFontSize: preset.typography.requestedFontSize,
      finalFontSize: chosen.fontSize,
      lineHeight: preset.typography.lineHeight,
      lineBounds,
      textBounds,
      safeMargins,
      minimumCanvasMargin: preset.typography.minimumCanvasMargin,
      dividerGeometry: { x: preset.divider.x, y: preset.divider.y, width: preset.divider.width, height: preset.divider.height },
      subtitle: preset.subtitle.text,
      subtitleTracking: preset.subtitle.tracking,
      subtitleBounds,
      rendererVersion: PEOPLE_TITLE_LOGO_RENDERER_VERSION,
      presetId: preset.id,
      presetHash: configuration.presetHash,
      fontFamily: fontRecord.family,
      fontWeight: fontRecord.weight,
      fontHash: fontRecord.fontHash,
      fontLockHash: configuration.fontLockHash,
      licenceHash: fontRecord.licenceHash,
      canvasWidth: preset.canvas.width,
      canvasHeight: preset.canvas.height,
      colourSpace: "srgb",
      alphaTransparent: true,
      futureRepositoryPath: `${PEOPLE_TITLE_LOGO_PUBLIC_ROOT}/${person.tmdbPersonId}.png`,
      proofFileName: `${person.tmdbPersonId}.png`,
      outputHash: sha256(output),
      byteCount: output.length,
      ownerReviewStatus: "pending",
    },
  };
}

function titleLogoMetadataFingerprint(metadata) {
  const { metadataFingerprint: _metadataFingerprint, ...payload } = metadata;
  return sha256(stableStringify(payload));
}

export function validateTitleLogoMetadata(metadata, expectedPeople = null) {
  const errors = [];
  if (metadata?.version !== "people-title-logo-render-metadata-v1") errors.push("title-logo metadata version mismatch");
  if (metadata?.rendererVersion !== PEOPLE_TITLE_LOGO_RENDERER_VERSION) errors.push("title-logo renderer version mismatch");
  if (metadata?.recordCount !== metadata?.records?.length) errors.push("title-logo metadata recordCount mismatch");
  const ids = new Set();
  for (const record of (Array.isArray(metadata?.records) ? metadata.records : [])) {
    if (ids.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate title-logo metadata identity`);
    ids.add(record.tmdbPersonId);
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: title-logo metadata identity mismatch`);
    if (record.canonicalNameLines?.join(" ") !== record.canonicalName) errors.push(`${record.stableKey}: title-logo canonical lines changed the name`);
    if (record.presentationLines?.join(" ") !== record.presentationName) errors.push(`${record.stableKey}: title-logo presentation lines changed the name`);
    if (record.presentationName !== record.canonicalName.toLocaleUpperCase("en-US")) errors.push(`${record.stableKey}: title-logo uppercase presentation mismatch`);
    if (record.canvasWidth !== 1863 || record.canvasHeight !== 673 || record.alphaTransparent !== true) errors.push(`${record.stableKey}: title-logo format mismatch`);
    if (!/^[a-f0-9]{64}$/u.test(record.outputHash || "") || !Number.isInteger(record.byteCount) || record.byteCount <= 0) errors.push(`${record.stableKey}: title-logo output evidence is incomplete`);
    if (Object.values(record.safeMargins || {}).some((value) => value < record.minimumCanvasMargin)) errors.push(`${record.stableKey}: title-logo safe margin is below the preset minimum`);
  }
  if (expectedPeople) {
    const expected = expectedPeople.map((person) => [person.tmdbPersonId, person.canonicalName]);
    const actual = metadata.records.map((record) => [record.tmdbPersonId, record.canonicalName]);
    if (stableStringify(actual) !== stableStringify(expected)) errors.push("title-logo metadata identities differ from the exact requested proof set");
  }
  if (metadata?.metadataFingerprint !== titleLogoMetadataFingerprint(metadata)) errors.push("title-logo metadata fingerprint mismatch");
  return errors;
}

export async function renderTitleLogoSet({ people, outputDir, generatedAt, fontDirectory = null, prepared = null } = {}) {
  const resolvedOutput = assertPeopleV3ProofPath(outputDir);
  const preparedRenderer = prepared || await prepareTitleLogoRenderer({ people, fontDirectory });
  const records = [];
  for (const person of people) {
    const rendered = await renderTitleLogo({ person, ...preparedRenderer });
    await atomicWrite(path.join(resolvedOutput, "individual", rendered.record.proofFileName), rendered.output);
    records.push(rendered.record);
  }
  const metadata = {
    version: "people-title-logo-render-metadata-v1",
    rendererVersion: PEOPLE_TITLE_LOGO_RENDERER_VERSION,
    generatedAt,
    ordering: "proof-specification-order",
    presetId: preparedRenderer.configuration.preset.id,
    presetHash: preparedRenderer.configuration.presetHash,
    overrideConfigHash: preparedRenderer.configuration.overrideHash,
    fontLockHash: preparedRenderer.configuration.fontLockHash,
    fontHash: preparedRenderer.fontRecord.fontHash,
    recordCount: records.length,
    records,
    metadataFingerprint: null,
  };
  metadata.metadataFingerprint = titleLogoMetadataFingerprint(metadata);
  const errors = validateTitleLogoMetadata(metadata, people);
  if (errors.length) throw new Error(`Title-logo metadata failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  const metadataPath = path.join(resolvedOutput, "renderer-metadata.json");
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { metadata, metadataPath, outputDir: resolvedOutput, prepared: preparedRenderer };
}

export function compareTitleLogoReplay(first, second) {
  const firstRecords = first.metadata.records.map(({ outputHash, byteCount, ...record }) => ({ ...record, outputHash, byteCount }));
  const secondRecords = second.metadata.records.map(({ outputHash, byteCount, ...record }) => ({ ...record, outputHash, byteCount }));
  return {
    byteIdentical: stableStringify(firstRecords.map((record) => [record.tmdbPersonId, record.outputHash, record.byteCount])) === stableStringify(secondRecords.map((record) => [record.tmdbPersonId, record.outputHash, record.byteCount])),
    metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata),
    comparisons: first.metadata.records.map((record, index) => ({
      tmdbPersonId: record.tmdbPersonId,
      canonicalName: record.canonicalName,
      firstHash: record.outputHash,
      secondHash: second.metadata.records[index]?.outputHash || null,
      byteIdentical: record.outputHash === second.metadata.records[index]?.outputHash && record.byteCount === second.metadata.records[index]?.byteCount,
    })),
  };
}

export function selectTitleLogoProofPeople({ registry, actors, directors } = {}) {
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const actorIds = new Set(actors.records.map((record) => record.tmdbPersonId));
  const directorIds = new Set(directors.records.map((record) => record.tmdbPersonId));
  return TITLE_LOGO_PROOF_IDENTITIES.map(([tmdbPersonId, canonicalName]) => {
    const record = registryById.get(tmdbPersonId);
    assert(record && record.canonicalName === canonicalName && record.stableKey === `person:${tmdbPersonId}`, `Title-logo proof identity differs from tracked data: ${tmdbPersonId}/${canonicalName}`);
    return {
      stableKey: record.stableKey,
      tmdbPersonId,
      canonicalName,
      profilePath: record.profilePath,
      categoryMembership: [
        ...(actorIds.has(tmdbPersonId) ? ["actor"] : []),
        ...(directorIds.has(tmdbPersonId) ? ["director"] : []),
      ],
    };
  });
}

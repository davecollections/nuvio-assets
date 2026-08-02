import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "../people-publication.mjs";
import { validateAgainstSchema } from "../schema-validator.mjs";
import { runFamilies, verifyFont } from "./font.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

export const PEOPLE_TITLE_LOGO_RENDERER_VERSION = "people-title-logo-renderer-v2";
export const PEOPLE_TITLE_LOGO_PRESET_ID = "people-title-logo-nuvio-variants-v2";
export const PEOPLE_TITLE_LOGO_PRESET_PATH = "tools/people-seed/presets/people-title-logo-nuvio-variants-v2.json";
export const PEOPLE_TITLE_LOGO_SECONDARY_FONTS_PATH = "tools/people-seed/config/people-title-logo-secondary-fonts.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_PATH = "data/people/title-logo-line-break-overrides.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH = "schemas/people-title-logo-line-break-overrides.schema.json";
export const PEOPLE_TITLE_LOGO_PUBLIC_ROOT = "assets/collection_covers/people/title-logo";
export const TITLE_LOGO_VARIANT_IDS = Object.freeze([
  "variant-a-name-only",
  "variant-b-nuvio-accent",
  "variant-c-nuvio-accent-collection",
]);

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
const ALPHA_CANONICALIZATION = "pango-exact-name-accent-coverage-64-open-1-blur-0.3-v7";

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

function validatePreset(preset) {
  assert(preset.id === PEOPLE_TITLE_LOGO_PRESET_ID && preset.rendererVersion === PEOPLE_TITLE_LOGO_RENDERER_VERSION, "Title-logo preset identity or renderer version changed.");
  assert(preset.canvas.width === 1863 && preset.canvas.height === 673 && preset.output.alpha === true, "Title-logo preset must remain 1863x673 transparent PNG.");
  assert(stableStringify(preset.variants.map((variant) => variant.id)) === stableStringify(TITLE_LOGO_VARIANT_IDS), "Title-logo proof variants differ from A/B/C.");
  assert(!Object.hasOwn(preset, "divider") && !Object.hasOwn(preset, "subtitle"), "Rejected divider/subtitle composition must not be present in the v2 title-logo preset.");
  const rejectedLegacySubtitle = ["CINEMATIC", "COLLECTION"].join(" ");
  assert(!JSON.stringify(preset).includes(rejectedLegacySubtitle), "Rejected legacy subtitle copy must not be present in the v2 title-logo preset.");
  assert(preset.accents.options.length === 2, "Exactly two original Nuvio accent prototypes are permitted in this proof.");
  assert(preset.collection.text === "COLLECTION", "Variant C may contain only the single word COLLECTION below the name.");
  assert(stableStringify({ sharp: preset.renderer.sharp, libvips: preset.renderer.libvips, pango: preset.renderer.pango, skiaCanvas: preset.renderer.skiaCanvas }) === stableStringify({ sharp: "0.35.3", libvips: "8.18.3", pango: "1.57.1", skiaCanvas: "3.0.8" }), "Title-logo renderer dependency lock changed.");
}

export async function loadTitleLogoConfiguration({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const presetPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_PRESET_PATH);
  const overridePath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_PATH);
  const overrideSchemaPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH);
  const fontLockPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "config", "cormorant-garamond-700.json");
  const secondaryFontsPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_SECONDARY_FONTS_PATH);
  const [presetBuffer, overrideBuffer, schemaBuffer, fontLockBuffer, secondaryFontsBuffer] = await Promise.all([
    fs.readFile(presetPath),
    fs.readFile(overridePath),
    fs.readFile(overrideSchemaPath),
    fs.readFile(fontLockPath),
    fs.readFile(secondaryFontsPath),
  ]);
  const preset = JSON.parse(presetBuffer);
  const overrides = JSON.parse(overrideBuffer);
  const overrideSchema = JSON.parse(schemaBuffer);
  const secondaryFonts = JSON.parse(secondaryFontsBuffer);
  const errors = validateTitleLogoOverrides(overrides, overrideSchema, { registry });
  if (errors.length) throw new Error(`Title-logo overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  validatePreset(preset);
  assert(secondaryFonts.status === "proof-only" && secondaryFonts.publicationAuthorised === false, "Secondary title-logo fonts must remain proof-only.");
  assert(secondaryFonts.options.length === 2, "Variant C must test exactly two secondary font options.");
  assert(secondaryFonts.options.some((record) => record.id === secondaryFonts.selectedProofOptionId), "Selected proof-only secondary font is unavailable.");
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
    secondaryFonts,
    secondaryFontsPath,
    secondaryFontsHash: sha256(secondaryFontsBuffer),
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

async function verifySecondaryFont({ runtime, repoRoot, lock }) {
  const fontPath = path.join(repoRoot, lock.fontPath);
  const licencePath = path.join(repoRoot, lock.licencePath);
  assert(await exists(fontPath) && await exists(licencePath), `${lock.id}: exact proof-only secondary font cache is unavailable.`);
  const [fontBuffer, licenceBuffer] = await Promise.all([fs.readFile(fontPath), fs.readFile(licencePath)]);
  assert(sha256(fontBuffer) === lock.fontSha256, `${lock.id}: font hash mismatch.`);
  assert(sha256(licenceBuffer) === lock.licenceSha256, `${lock.id}: licence hash mismatch.`);
  const loaded = runtime.FontLibrary.use(lock.registrationAlias, fontPath);
  assert(runtime.FontLibrary.has(lock.registrationAlias), `${lock.id}: exact secondary font registration failed.`);
  const fontRecord = {
    id: lock.id,
    family: lock.family,
    registrationAlias: lock.registrationAlias,
    weight: lock.weight,
    fontHash: lock.fontSha256,
    licenceHash: lock.licenceSha256,
    licence: lock.licence,
    fontPath,
    licencePath,
    loaded,
  };
  measureText("COLLECTION", runtime, fontRecord, 42, 8);
  return fontRecord;
}

export async function prepareTitleLogoRenderer({ people, configuration = null, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const resolvedConfiguration = configuration || await loadTitleLogoConfiguration();
  const rendererVersions = { ...runtime.versions, pango: runtime.sharp.versions.pango };
  for (const dependency of ["sharp", "libvips", "pango", "skiaCanvas"]) assert(rendererVersions[dependency] === resolvedConfiguration.preset.renderer[dependency], `Title-logo ${dependency} runtime must be ${resolvedConfiguration.preset.renderer[dependency]}.`);
  const glyphTexts = people.map((person) => person.canonicalName.toLocaleUpperCase("en-US"));
  const fontRecord = await verifyFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: glyphTexts, fontDirectory });
  assert(fontRecord.fontHash === resolvedConfiguration.preset.typography.fontHash, "Title-logo preset name-font hash differs from the locked People cover font.");
  const secondaryFontRecords = new Map();
  for (const lock of resolvedConfiguration.secondaryFonts.options) {
    secondaryFontRecords.set(lock.id, await verifySecondaryFont({ runtime, repoRoot: PEOPLE_ARTWORK_REPO_ROOT, lock }));
  }
  return { runtime, configuration: resolvedConfiguration, fontRecord, secondaryFontRecords, rendererVersions };
}

function variantById(preset, variantId) {
  const variant = preset.variants.find((record) => record.id === variantId);
  assert(variant, `Unknown title-logo proof variant: ${variantId}`);
  return variant;
}

function accentById(preset, accentId) {
  const accent = preset.accents.options.find((record) => record.id === accentId);
  assert(accent, `Unknown title-logo accent prototype: ${accentId}`);
  return accent;
}

function drawAccent(context, preset, accent) {
  const centerX = preset.canvas.width / 2;
  const centerY = preset.accents.centerY;
  context.save();
  context.fillStyle = preset.accents.colour;
  context.globalAlpha = preset.accents.opacity;
  if (accent.geometry === "split-rise-tapers") {
    const halfGap = accent.gap / 2;
    const outer = accent.width / 2;
    const thickness = accent.thickness;
    context.beginPath();
    context.moveTo(centerX - outer, centerY + thickness);
    context.lineTo(centerX - halfGap, centerY);
    context.lineTo(centerX - halfGap, centerY + thickness);
    context.lineTo(centerX - outer, centerY + thickness * 2);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(centerX + halfGap, centerY - thickness);
    context.lineTo(centerX + outer, centerY);
    context.lineTo(centerX + outer, centerY + thickness);
    context.lineTo(centerX + halfGap, centerY);
    context.closePath();
    context.fill();
    context.restore();
    return { x: round(centerX - outer), y: round(centerY - thickness), width: accent.width, height: thickness * 3 };
  }
  const unit = accent.unit;
  const positions = [-1.5, -0.5, 0.5, 1.5];
  for (const [index, position] of positions.entries()) {
    const x = centerX + position * (unit + accent.gap) - unit / 2;
    const y = centerY + (index % 2 === 0 ? -accent.rise : accent.rise) - unit / 2;
    context.beginPath();
    context.moveTo(x + unit / 2, y);
    context.lineTo(x + unit, y + unit / 2);
    context.lineTo(x + unit / 2, y + unit);
    context.lineTo(x, y + unit / 2);
    context.closePath();
    context.fill();
  }
  context.restore();
  const width = unit * 4 + accent.gap * 3;
  return { x: round(centerX - width / 2), y: round(centerY - accent.rise - unit / 2), width: round(width), height: round(unit + accent.rise * 2) };
}

function unionBounds(bounds) {
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
}

async function renderCollectionLayer(runtime, preset, secondaryFont) {
  const tracking = Math.round(preset.collection.tracking * 1024);
  const size = Math.round(preset.collection.fontSize * 1024);
  const markup = `<span foreground="${preset.collection.colour}" font_family="${secondaryFont.family}" font_weight="${secondaryFont.weight}" size="${size}" letter_spacing="${tracking}">${preset.collection.text}</span>`;
  const buffer = await runtime.sharp({
    text: {
      text: markup,
      font: `${secondaryFont.family} ${preset.collection.fontSize}`,
      fontfile: secondaryFont.fontPath,
      rgba: true,
      dpi: 72,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const metadata = await runtime.sharp(buffer).metadata();
  assert(metadata.format === "png" && metadata.hasAlpha === true && metadata.width > 0 && metadata.height > 0, "Variant C Pango collection label did not render as transparent PNG.");
  const left = Math.round((preset.canvas.width - metadata.width) / 2);
  return {
    buffer,
    bounds: { x: left, y: preset.collection.topY, width: metadata.width, height: metadata.height },
  };
}

function escapePangoMarkup(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function renderNameLayers(runtime, preset, plan, chosen, measuredBounds, fontRecord) {
  const tracking = Math.round(preset.typography.letterSpacing * 1024);
  const size = Math.round(chosen.fontSize * 1024);
  const layers = [];
  for (const [index, line] of plan.presentationLines.entries()) {
    const markup = `<span foreground="${preset.typography.colour}" font_family="${fontRecord.family}" font_weight="${fontRecord.weight}" size="${size}" letter_spacing="${tracking}">${escapePangoMarkup(line)}</span>`;
    const buffer = await runtime.sharp({
      text: {
        text: markup,
        font: `${fontRecord.family} ${chosen.fontSize}`,
        fontfile: fontRecord.fontPath,
        rgba: true,
        dpi: 72,
      },
    }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
    const metadata = await runtime.sharp(buffer).metadata();
    assert(metadata.format === "png" && metadata.hasAlpha === true && metadata.width > 0 && metadata.height > 0, "Locked People name font did not render as a transparent Pango layer.");
    const measured = measuredBounds[index];
    const bounds = {
      x: Math.round(preset.canvas.width / 2 - metadata.width / 2),
      y: Math.round(measured.y + measured.height / 2 - metadata.height / 2),
      width: metadata.width,
      height: metadata.height,
      baseline: measured.baseline,
    };
    assert(bounds.x >= preset.typography.minimumCanvasMargin && bounds.x + bounds.width <= preset.canvas.width - preset.typography.minimumCanvasMargin, "Locked People name Pango layer exceeds the horizontal safe region.");
    layers.push({ buffer, bounds });
  }
  return layers;
}

function resetExactTitleFontState(runtime, configuration, fontRecord, secondaryFontRecords) {
  runtime.FontLibrary.reset();
  runtime.FontLibrary.use(fontRecord.registrationAlias, fontRecord.fontPath);
  assert(runtime.FontLibrary.has(fontRecord.registrationAlias), "Locked People name font registration was lost before title rendering.");
  for (const option of configuration.secondaryFonts.options) {
    const record = secondaryFontRecords.get(option.id);
    runtime.FontLibrary.use(record.registrationAlias, record.fontPath);
    assert(runtime.FontLibrary.has(record.registrationAlias), `${option.id}: secondary font registration was lost before title rendering.`);
  }
}

export async function renderTitleLogo({ person, variantId, accentId = null, secondaryFontId = null, runtime, configuration, fontRecord, secondaryFontRecords } = {}) {
  assert(variantId, "An explicit A/B/C title-logo proof variant is required; no permanent variant is selected.");
  resetExactTitleFontState(runtime, configuration, fontRecord, secondaryFontRecords);
  const { preset } = configuration;
  const variant = variantById(preset, variantId);
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
  const region = variant.nameRegion;
  const top = region.y + (region.height - chosen.height) / 2;
  const measuredLineBounds = chosen.measures.map((measure, index) => {
    const x = Math.round(region.x + (region.width - measure.width) / 2);
    const baseline = Math.round(top + chosen.maxAscent + index * preset.typography.lineHeight);
    return { x: round(x), y: round(baseline - measure.ascent), width: round(measure.width), height: round(measure.ascent + measure.descent), baseline: round(baseline) };
  });
  const nameLayers = await renderNameLayers(runtime, preset, plan, chosen, measuredLineBounds, fontRecord);
  const lineBounds = nameLayers.map((layer) => layer.bounds);
  const resolvedAccentId = variant.accent ? accentId || preset.accents.selectedProofOptionId : null;
  const accentBounds = variant.accent ? drawAccent(context, preset, accentById(preset, resolvedAccentId)) : null;
  const resolvedSecondaryFontId = variant.collection ? secondaryFontId || configuration.secondaryFonts.selectedProofOptionId : null;
  const secondaryFont = variant.collection ? secondaryFontRecords.get(resolvedSecondaryFontId) : null;
  assert(!variant.collection || secondaryFont, `${variantId}: selected Variant C secondary font is unavailable.`);
  const collectionLayer = variant.collection ? await renderCollectionLayer(runtime, preset, secondaryFont) : null;
  const collectionBounds = collectionLayer?.bounds || null;
  const allBounds = [...lineBounds, ...(accentBounds ? [accentBounds] : []), ...(collectionBounds ? [collectionBounds] : [])];
  const contentBounds = unionBounds(allBounds);
  const safeMargins = {
    left: round(contentBounds.x),
    right: round(preset.canvas.width - contentBounds.x - contentBounds.width),
    top: round(contentBounds.y),
    bottom: round(preset.canvas.height - contentBounds.y - contentBounds.height),
  };
  assert(Object.values(safeMargins).every((value) => value >= preset.typography.minimumCanvasMargin), `${person.stableKey}/${variantId}: title-logo content violates the minimum canvas margin.`);
  const canvasOutput = await canvas.toBuffer("png");
  const { data: renderedPixels, info: renderedInfo } = await runtime.sharp(canvasOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const supportMask = Buffer.alloc(renderedInfo.width * renderedInfo.height);
  for (let pixel = 0; pixel < supportMask.length; pixel += 1) supportMask[pixel] = renderedPixels[pixel * 4 + 3] >= 64 ? 255 : 0;
  const { data: stableAlpha, info: stableAlphaInfo } = await runtime.sharp(supportMask, { raw: { width: renderedInfo.width, height: renderedInfo.height, channels: 1 } }).erode(1).dilate(1).blur(0.3).raw().toBuffer({ resolveWithObject: true });
  const canonicalPixels = Buffer.alloc(renderedInfo.width * renderedInfo.height * 4, 255);
  for (let pixel = 0; pixel < renderedInfo.width * renderedInfo.height; pixel += 1) canonicalPixels[pixel * 4 + 3] = stableAlpha[pixel * stableAlphaInfo.channels];
  const canonicalBase = runtime.sharp(canonicalPixels, { raw: { width: renderedInfo.width, height: renderedInfo.height, channels: 4 } });
  const overlays = [
    ...nameLayers.map((layer) => ({ input: layer.buffer, left: layer.bounds.x, top: layer.bounds.y })),
    ...(collectionLayer ? [{ input: collectionLayer.buffer, left: collectionLayer.bounds.x, top: collectionLayer.bounds.y }] : []),
  ];
  const output = await canonicalBase.composite(overlays).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const decoded = await runtime.sharp(output, { failOn: "error" }).metadata();
  assert(decoded.format === "png" && decoded.width === 1863 && decoded.height === 673 && decoded.hasAlpha === true && decoded.channels === 4, `${person.stableKey}/${variantId}: title-logo output is not exact 1863x673 RGBA PNG.`);
  return {
    output,
    record: {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationName: plan.presentationName,
      categories: [...person.categoryMembership],
      variantId,
      variantLabel: variant.label,
      permanentSelection: false,
      lineBreakSource: plan.source,
      manualOverrideId: plan.override?.stableKey || null,
      canonicalNameLines: plan.canonicalLines,
      presentationLines: plan.presentationLines,
      requestedFontSize: preset.typography.requestedFontSize,
      finalFontSize: chosen.fontSize,
      lineHeight: preset.typography.lineHeight,
      lineBounds,
      contentBounds,
      safeMargins,
      minimumCanvasMargin: preset.typography.minimumCanvasMargin,
      accentId: resolvedAccentId,
      accentBounds,
      collectionText: variant.collection ? preset.collection.text : null,
      collectionBounds,
      secondaryFontId: resolvedSecondaryFontId,
      secondaryFontFamily: secondaryFont?.family || null,
      secondaryFontWeight: secondaryFont?.weight || null,
      secondaryFontHash: secondaryFont?.fontHash || null,
      secondaryLicenceHash: secondaryFont?.licenceHash || null,
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
      alphaCanonicalization: ALPHA_CANONICALIZATION,
      futureRepositoryPath: null,
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
  if (metadata?.version !== "people-title-logo-render-metadata-v2") errors.push("title-logo metadata version mismatch");
  if (metadata?.rendererVersion !== PEOPLE_TITLE_LOGO_RENDERER_VERSION) errors.push("title-logo renderer version mismatch");
  if (stableStringify(metadata?.rendererVersions) !== stableStringify({ sharp: "0.35.3", libvips: "8.18.3", skiaCanvas: "3.0.8", pango: "1.57.1" })) errors.push("title-logo renderer dependency versions mismatch");
  if (metadata?.designDecisionStatus !== "unselected") errors.push("title-logo proof must not select a permanent design variant");
  if (metadata?.recordCount !== metadata?.records?.length) errors.push("title-logo metadata recordCount mismatch");
  if (metadata?.personCount * metadata?.variantCount !== metadata?.recordCount) errors.push("title-logo person/variant counts do not reconcile");
  const keys = new Set();
  for (const record of (Array.isArray(metadata?.records) ? metadata.records : [])) {
    const key = `${record.variantId}:${record.tmdbPersonId}`;
    if (keys.has(key)) errors.push(`${key}: duplicate title-logo metadata identity/variant`);
    keys.add(key);
    if (!TITLE_LOGO_VARIANT_IDS.includes(record.variantId)) errors.push(`${key}: unknown A/B/C variant`);
    if (record.permanentSelection !== false) errors.push(`${key}: proof record selects a permanent design`);
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: title-logo metadata identity mismatch`);
    if (record.canonicalNameLines?.join(" ") !== record.canonicalName) errors.push(`${record.stableKey}: title-logo canonical lines changed the name`);
    if (record.presentationLines?.join(" ") !== record.presentationName) errors.push(`${record.stableKey}: title-logo presentation lines changed the name`);
    if (record.presentationName !== record.canonicalName.toLocaleUpperCase("en-US")) errors.push(`${record.stableKey}: title-logo uppercase presentation mismatch`);
    if (record.canvasWidth !== 1863 || record.canvasHeight !== 673 || record.alphaTransparent !== true) errors.push(`${key}: title-logo format mismatch`);
    if (!/^[a-f0-9]{64}$/u.test(record.outputHash || "") || !Number.isInteger(record.byteCount) || record.byteCount <= 0) errors.push(`${key}: title-logo output evidence is incomplete`);
    if (Object.values(record.safeMargins || {}).some((value) => value < record.minimumCanvasMargin)) errors.push(`${key}: title-logo safe margin is below the preset minimum`);
    if (record.variantId === "variant-a-name-only" && (record.accentId !== null || record.collectionText !== null)) errors.push(`${key}: Variant A contains more than the name`);
    if (record.variantId === "variant-b-nuvio-accent" && (!record.accentId || record.collectionText !== null)) errors.push(`${key}: Variant B must contain only name and accent`);
    if (record.variantId === "variant-c-nuvio-accent-collection" && (!record.accentId || record.collectionText !== "COLLECTION" || !record.secondaryFontHash || !record.secondaryLicenceHash)) errors.push(`${key}: Variant C evidence is incomplete`);
  }
  if (expectedPeople) {
    const expected = TITLE_LOGO_VARIANT_IDS.flatMap((variantId) => expectedPeople.map((person) => [variantId, person.tmdbPersonId, person.canonicalName]));
    const actual = metadata.records.map((record) => [record.variantId, record.tmdbPersonId, record.canonicalName]);
    if (stableStringify(actual) !== stableStringify(expected)) errors.push("title-logo metadata identities differ from the exact A/B/C proof set");
  }
  if (metadata?.metadataFingerprint !== titleLogoMetadataFingerprint(metadata)) errors.push("title-logo metadata fingerprint mismatch");
  return errors;
}

export async function renderTitleLogoSet({ people, outputDir, generatedAt, fontDirectory = null, prepared = null } = {}) {
  const resolvedOutput = assertPeopleV3ProofPath(outputDir);
  const preparedRenderer = prepared || await prepareTitleLogoRenderer({ people, fontDirectory });
  const records = [];
  for (const variantId of TITLE_LOGO_VARIANT_IDS) {
    for (const person of people) {
      const rendered = await renderTitleLogo({ person, variantId, ...preparedRenderer });
      await atomicWrite(path.join(resolvedOutput, variantId, "individual", rendered.record.proofFileName), rendered.output);
      records.push(rendered.record);
    }
  }
  const metadata = {
    version: "people-title-logo-render-metadata-v2",
    rendererVersion: PEOPLE_TITLE_LOGO_RENDERER_VERSION,
    rendererVersions: preparedRenderer.rendererVersions,
    generatedAt,
    ordering: "variant-a-b-c-then-proof-specification-order",
    designDecisionStatus: "unselected",
    permanentVariantSelected: false,
    personCount: people.length,
    variantCount: TITLE_LOGO_VARIANT_IDS.length,
    recordCount: records.length,
    presetId: preparedRenderer.configuration.preset.id,
    presetHash: preparedRenderer.configuration.presetHash,
    overrideConfigHash: preparedRenderer.configuration.overrideHash,
    fontLockHash: preparedRenderer.configuration.fontLockHash,
    fontHash: preparedRenderer.fontRecord.fontHash,
    secondaryFontsHash: preparedRenderer.configuration.secondaryFontsHash,
    testedSecondaryFontOptionIds: preparedRenderer.configuration.secondaryFonts.options.map((record) => record.id),
    testedAccentOptionIds: preparedRenderer.configuration.preset.accents.options.map((record) => record.id),
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
  return {
    byteIdentical: stableStringify(first.metadata.records.map((record) => [record.variantId, record.tmdbPersonId, record.outputHash, record.byteCount])) === stableStringify(second.metadata.records.map((record) => [record.variantId, record.tmdbPersonId, record.outputHash, record.byteCount])),
    metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata),
    comparisons: first.metadata.records.map((record, index) => ({
      variantId: record.variantId,
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

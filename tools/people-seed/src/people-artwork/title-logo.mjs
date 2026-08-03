import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { stableStringify } from "../people-publication.mjs";
import { validateAgainstSchema } from "../schema-validator.mjs";
import { runFamilies, verifyFont, verifyLimelightFont } from "./font.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

export const PEOPLE_TITLE_LOGO_RENDERER_VERSION = "people-title-logo-renderer-v3";
export const PEOPLE_TITLE_LOGO_PRESET_ID = "people-title-logo-collection-options-v3";
export const PEOPLE_TITLE_LOGO_PRESET_PATH = "tools/people-seed/presets/people-title-logo-collection-options-v3.json";
export const PEOPLE_TITLE_LOGO_LIMELIGHT_LOCK_PATH = "tools/people-seed/config/limelight-400.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_PATH = "data/people/title-logo-line-break-overrides.json";
export const PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH = "schemas/people-title-logo-line-break-overrides.schema.json";
export const PEOPLE_TITLE_LOGO_PUBLIC_ROOT = "assets/collection_covers/people/title-logo";
export const TITLE_LOGO_OPTION_IDS = Object.freeze([
  "option-d1-subtle",
  "option-d2-hollywood",
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
const ALPHA_CANONICALIZATION = "explicit-exact-pango-fontfiles-white-rgba-v1";

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

function validatePreset(preset) {
  assert(preset.id === PEOPLE_TITLE_LOGO_PRESET_ID && preset.rendererVersion === PEOPLE_TITLE_LOGO_RENDERER_VERSION, "Title-logo preset identity or renderer version changed.");
  assert(preset.canvas.width === 1863 && preset.canvas.height === 673 && preset.output.alpha === true, "Title-logo preset must remain 1863x673 transparent PNG.");
  assert(stableStringify(Object.keys(preset)) === stableStringify(["id", "version", "status", "publicationAuthorised", "rendererVersion", "renderer", "canvas", "typography", "collection", "options", "output"]), "Title-logo preset contains an unsupported top-level design field.");
  assert(stableStringify(preset.options.map((option) => option.id)) === stableStringify(TITLE_LOGO_OPTION_IDS), "Title-logo proof options differ from D1/D2.");
  assert(preset.options.every((option) => stableStringify(Object.keys(option)) === stableStringify(["id", "label", "nameRegion", "collectionStyle"])), "Title-logo options may contain only name and COLLECTION layout fields.");
  assert(preset.collection.text === "COLLECTION" && preset.collection.family === "Limelight" && preset.collection.weight === 400, "The fixed COLLECTION treatment must use Limelight 400.");
  const [d1, d2] = preset.options;
  assert(d2.collectionStyle.fontSize > d1.collectionStyle.fontSize, "D2 COLLECTION must be larger than D1.");
  assert(d2.collectionStyle.tracking < d1.collectionStyle.tracking, "D2 COLLECTION tracking must be tighter than D1.");
  assert(d2.collectionStyle.topY < d1.collectionStyle.topY, "D2 COLLECTION must sit closer to the Person name than D1.");
  assert(stableStringify({ sharp: preset.renderer.sharp, libvips: preset.renderer.libvips, pango: preset.renderer.pango, skiaCanvas: preset.renderer.skiaCanvas }) === stableStringify({ sharp: "0.35.3", libvips: "8.18.3", pango: "1.57.1", skiaCanvas: "3.0.8" }), "Title-logo renderer dependency lock changed.");
}

export async function loadTitleLogoConfiguration({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const presetPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_PRESET_PATH);
  const overridePath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_PATH);
  const overrideSchemaPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_OVERRIDE_SCHEMA_PATH);
  const fontLockPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "config", "cormorant-garamond-700.json");
  const limelightLockPath = path.join(repoRoot, PEOPLE_TITLE_LOGO_LIMELIGHT_LOCK_PATH);
  const [presetBuffer, overrideBuffer, schemaBuffer, fontLockBuffer, limelightLockBuffer] = await Promise.all([
    fs.readFile(presetPath),
    fs.readFile(overridePath),
    fs.readFile(overrideSchemaPath),
    fs.readFile(fontLockPath),
    fs.readFile(limelightLockPath),
  ]);
  const preset = JSON.parse(presetBuffer);
  const overrides = JSON.parse(overrideBuffer);
  const overrideSchema = JSON.parse(schemaBuffer);
  const limelightLock = JSON.parse(limelightLockBuffer);
  const errors = validateTitleLogoOverrides(overrides, overrideSchema, { registry });
  if (errors.length) throw new Error(`Title-logo overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  validatePreset(preset);
  assert(limelightLock.version === "people-limelight-400-lock-v1" && limelightLock.publicationAuthorised === false && limelightLock.fontModified === false, "Limelight must remain an unmodified proof font lock.");
  assert(limelightLock.family === preset.collection.family && limelightLock.weight === preset.collection.weight && limelightLock.fontSha256 === preset.collection.fontHash && limelightLock.licenceSha256 === preset.collection.licenceHash, "Title-logo preset differs from the exact Limelight lock.");
  assert(limelightLock.usageBinding.rendererVersion === PEOPLE_TITLE_LOGO_RENDERER_VERSION && limelightLock.usageBinding.text === "COLLECTION" && limelightLock.usageBinding.personNameUsePermitted === false, "Limelight usage is not bound exclusively to COLLECTION.");
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
    limelightLock,
    limelightLockPath,
    limelightLockHash: sha256(limelightLockBuffer),
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

export async function prepareTitleLogoRenderer({ people, configuration = null, runtime: providedRuntime = null, fontDirectory = null } = {}) {
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const resolvedConfiguration = configuration || await loadTitleLogoConfiguration();
  const rendererVersions = { ...runtime.versions, pango: runtime.sharp.versions.pango };
  for (const dependency of ["sharp", "libvips", "pango", "skiaCanvas"]) assert(rendererVersions[dependency] === resolvedConfiguration.preset.renderer[dependency], `Title-logo ${dependency} runtime must be ${resolvedConfiguration.preset.renderer[dependency]}.`);
  const glyphTexts = people.map((person) => person.canonicalName.toLocaleUpperCase("en-US"));
  const fontRecord = await verifyFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: glyphTexts, fontDirectory });
  assert(fontRecord.fontHash === resolvedConfiguration.preset.typography.fontHash, "Title-logo preset name-font hash differs from the locked People cover font.");
  const limelightRecord = await verifyLimelightFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: [resolvedConfiguration.preset.collection.text] });
  assert(limelightRecord.fontHash === resolvedConfiguration.preset.collection.fontHash && limelightRecord.licenceHash === resolvedConfiguration.preset.collection.licenceHash, "Title-logo COLLECTION font differs from the exact Limelight lock.");
  return { runtime, configuration: resolvedConfiguration, fontRecord, limelightRecord, rendererVersions };
}

function optionById(preset, optionId) {
  const option = preset.options.find((record) => record.id === optionId);
  assert(option, `Unknown title-logo proof option: ${optionId}`);
  return option;
}

function unionBounds(bounds) {
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
}

async function renderCollectionLayer(runtime, preset, option, limelightRecord) {
  const style = option.collectionStyle;
  const tracking = Math.round(style.tracking * 1024);
  const size = Math.round(style.fontSize * 1024);
  const markup = `<span foreground="${preset.collection.colour}" font_family="${limelightRecord.family}" font_weight="${limelightRecord.weight}" size="${size}" letter_spacing="${tracking}">${preset.collection.text}</span>`;
  const buffer = await runtime.sharp({
    text: {
      text: markup,
      font: `${limelightRecord.family} ${style.fontSize}`,
      fontfile: limelightRecord.fontPath,
      rgba: true,
      dpi: 72,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const metadata = await runtime.sharp(buffer).metadata();
  assert(metadata.format === "png" && metadata.hasAlpha === true && metadata.width > 0 && metadata.height > 0, "Locked Limelight COLLECTION label did not render as transparent PNG.");
  const left = Math.round((preset.canvas.width - metadata.width) / 2);
  return {
    buffer,
    bounds: { x: left, y: style.topY, width: metadata.width, height: metadata.height },
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

function resetExactTitleFontState(runtime, fontRecord, limelightRecord) {
  runtime.FontLibrary.reset();
  runtime.FontLibrary.use(fontRecord.registrationAlias, fontRecord.fontPath);
  assert(runtime.FontLibrary.has(fontRecord.registrationAlias), "Locked People name font registration was lost before title rendering.");
  runtime.FontLibrary.use(limelightRecord.registrationAlias, limelightRecord.fontPath);
  assert(runtime.FontLibrary.has(limelightRecord.registrationAlias), "Locked Limelight registration was lost before title rendering.");
}

export async function renderTitleLogo({ person, optionId, runtime, configuration, fontRecord, limelightRecord } = {}) {
  assert(optionId, "An explicit D1/D2 title-logo proof option is required; no permanent option is selected.");
  resetExactTitleFontState(runtime, fontRecord, limelightRecord);
  const { preset } = configuration;
  const option = optionById(preset, optionId);
  const plan = linePlan(person, preset, configuration, runtime, fontRecord);
  assert(plan.canonicalLines.join(" ") === person.canonicalName, `${person.stableKey}: title-logo lines changed the canonical name.`);
  assert(plan.presentationLines.join(" ") === plan.presentationName, `${person.stableKey}: uppercase title-logo lines changed the canonical name.`);
  assert(plan.presentationLines.length <= preset.typography.maximumLines, `${person.stableKey}: title-logo exceeds the maximum line count.`);
  const chosen = fitLines(plan, preset, runtime, fontRecord);
  const region = option.nameRegion;
  const top = region.y + (region.height - chosen.height) / 2;
  const measuredLineBounds = chosen.measures.map((measure, index) => {
    const x = Math.round(region.x + (region.width - measure.width) / 2);
    const baseline = Math.round(top + chosen.maxAscent + index * preset.typography.lineHeight);
    return { x: round(x), y: round(baseline - measure.ascent), width: round(measure.width), height: round(measure.ascent + measure.descent), baseline: round(baseline) };
  });
  const nameLayers = await renderNameLayers(runtime, preset, plan, chosen, measuredLineBounds, fontRecord);
  const lineBounds = nameLayers.map((layer) => layer.bounds);
  const collectionLayer = await renderCollectionLayer(runtime, preset, option, limelightRecord);
  const collectionBounds = collectionLayer.bounds;
  const allBounds = [...lineBounds, collectionBounds];
  const contentBounds = unionBounds(allBounds);
  const nameBottom = Math.max(...lineBounds.map((bound) => bound.y + bound.height));
  const verticalGap = round(collectionBounds.y - nameBottom);
  assert(verticalGap > 0, `${person.stableKey}/${optionId}: COLLECTION must remain below the Person name.`);
  const safeMargins = {
    left: round(contentBounds.x),
    right: round(preset.canvas.width - contentBounds.x - contentBounds.width),
    top: round(contentBounds.y),
    bottom: round(preset.canvas.height - contentBounds.y - contentBounds.height),
  };
  assert(Object.values(safeMargins).every((value) => value >= preset.typography.minimumCanvasMargin), `${person.stableKey}/${optionId}: title-logo content violates the minimum canvas margin.`);
  const canonicalBase = runtime.sharp({ create: { width: preset.canvas.width, height: preset.canvas.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } });
  const overlays = [
    ...nameLayers.map((layer) => ({ input: layer.buffer, left: layer.bounds.x, top: layer.bounds.y })),
    { input: collectionLayer.buffer, left: collectionLayer.bounds.x, top: collectionLayer.bounds.y },
  ];
  const output = await canonicalBase.composite(overlays).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const decoded = await runtime.sharp(output, { failOn: "error" }).metadata();
  assert(decoded.format === "png" && decoded.width === 1863 && decoded.height === 673 && decoded.hasAlpha === true && decoded.channels === 4, `${person.stableKey}/${optionId}: title-logo output is not exact 1863x673 RGBA PNG.`);
  return {
    output,
    record: {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      presentationName: plan.presentationName,
      categories: [...person.categoryMembership],
      optionId,
      optionLabel: option.label,
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
      collectionText: preset.collection.text,
      collectionBounds,
      collectionFontSize: option.collectionStyle.fontSize,
      collectionTracking: option.collectionStyle.tracking,
      collectionTopY: option.collectionStyle.topY,
      verticalGap,
      collectionFontFamily: limelightRecord.family,
      collectionFontWeight: limelightRecord.weight,
      collectionFontHash: limelightRecord.fontHash,
      collectionFontLockHash: configuration.limelightLockHash,
      collectionLicence: limelightRecord.licence,
      collectionLicenceHash: limelightRecord.licenceHash,
      collectionMetadataHash: limelightRecord.metadataHash,
      collectionSourceRevision: limelightRecord.fontSourceRevision,
      collectionRendererBinding: limelightRecord.rendererBinding,
      graphicElementCount: 0,
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
  if (metadata?.version !== "people-title-logo-render-metadata-v3") errors.push("title-logo metadata version mismatch");
  if (metadata?.rendererVersion !== PEOPLE_TITLE_LOGO_RENDERER_VERSION) errors.push("title-logo renderer version mismatch");
  if (stableStringify(metadata?.rendererVersions) !== stableStringify({ sharp: "0.35.3", libvips: "8.18.3", skiaCanvas: "3.0.8", pango: "1.57.1" })) errors.push("title-logo renderer dependency versions mismatch");
  if (metadata?.designDecisionStatus !== "unselected") errors.push("title-logo proof must not select a permanent design option");
  if (metadata?.recordCount !== metadata?.records?.length) errors.push("title-logo metadata recordCount mismatch");
  if (metadata?.personCount * metadata?.optionCount !== metadata?.recordCount) errors.push("title-logo person/option counts do not reconcile");
  const keys = new Set();
  for (const record of (Array.isArray(metadata?.records) ? metadata.records : [])) {
    const key = `${record.optionId}:${record.tmdbPersonId}`;
    if (keys.has(key)) errors.push(`${key}: duplicate title-logo metadata identity/option`);
    keys.add(key);
    if (!TITLE_LOGO_OPTION_IDS.includes(record.optionId)) errors.push(`${key}: unknown D1/D2 option`);
    if (record.permanentSelection !== false) errors.push(`${key}: proof record selects a permanent design`);
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: title-logo metadata identity mismatch`);
    if (record.canonicalNameLines?.join(" ") !== record.canonicalName) errors.push(`${record.stableKey}: title-logo canonical lines changed the name`);
    if (record.presentationLines?.join(" ") !== record.presentationName) errors.push(`${record.stableKey}: title-logo presentation lines changed the name`);
    if (record.presentationName !== record.canonicalName.toLocaleUpperCase("en-US")) errors.push(`${record.stableKey}: title-logo uppercase presentation mismatch`);
    if (record.canvasWidth !== 1863 || record.canvasHeight !== 673 || record.alphaTransparent !== true) errors.push(`${key}: title-logo format mismatch`);
    if (!/^[a-f0-9]{64}$/u.test(record.outputHash || "") || !Number.isInteger(record.byteCount) || record.byteCount <= 0) errors.push(`${key}: title-logo output evidence is incomplete`);
    if (Object.values(record.safeMargins || {}).some((value) => value < record.minimumCanvasMargin)) errors.push(`${key}: title-logo safe margin is below the preset minimum`);
    if (record.collectionText !== "COLLECTION" || record.collectionFontFamily !== "Limelight" || record.collectionFontWeight !== 400) errors.push(`${key}: fixed COLLECTION evidence is incomplete`);
    if (!/^[a-f0-9]{64}$/u.test(record.collectionFontHash || "") || !/^[a-f0-9]{64}$/u.test(record.collectionLicenceHash || "") || !/^[a-f0-9]{64}$/u.test(record.collectionFontLockHash || "")) errors.push(`${key}: Limelight lock evidence is incomplete`);
    if (record.graphicElementCount !== 0) errors.push(`${key}: title-logo contains an unsupported graphic element`);
    if (!(record.verticalGap > 0)) errors.push(`${key}: COLLECTION does not remain below the Person name`);
  }
  if (expectedPeople) {
    const expected = TITLE_LOGO_OPTION_IDS.flatMap((optionId) => expectedPeople.map((person) => [optionId, person.tmdbPersonId, person.canonicalName]));
    const actual = metadata.records.map((record) => [record.optionId, record.tmdbPersonId, record.canonicalName]);
    if (stableStringify(actual) !== stableStringify(expected)) errors.push("title-logo metadata identities differ from the exact D1/D2 proof set");
  }
  if (metadata?.metadataFingerprint !== titleLogoMetadataFingerprint(metadata)) errors.push("title-logo metadata fingerprint mismatch");
  return errors;
}

export async function renderTitleLogoSet({ people, outputDir, generatedAt, fontDirectory = null, prepared = null } = {}) {
  const resolvedOutput = assertPeopleV3ProofPath(outputDir);
  const preparedRenderer = prepared || await prepareTitleLogoRenderer({ people, fontDirectory });
  const records = [];
  for (const optionId of TITLE_LOGO_OPTION_IDS) {
    for (const person of people) {
      const rendered = await renderTitleLogo({ person, optionId, ...preparedRenderer });
      await atomicWrite(path.join(resolvedOutput, optionId, "individual", rendered.record.proofFileName), rendered.output);
      records.push(rendered.record);
    }
  }
  const metadata = {
    version: "people-title-logo-render-metadata-v3",
    rendererVersion: PEOPLE_TITLE_LOGO_RENDERER_VERSION,
    rendererVersions: preparedRenderer.rendererVersions,
    generatedAt,
    ordering: "option-d1-d2-then-proof-specification-order",
    designDecisionStatus: "unselected",
    permanentOptionSelected: false,
    personCount: people.length,
    optionCount: TITLE_LOGO_OPTION_IDS.length,
    recordCount: records.length,
    presetId: preparedRenderer.configuration.preset.id,
    presetHash: preparedRenderer.configuration.presetHash,
    overrideConfigHash: preparedRenderer.configuration.overrideHash,
    fontLockHash: preparedRenderer.configuration.fontLockHash,
    fontHash: preparedRenderer.fontRecord.fontHash,
    collectionFontLockHash: preparedRenderer.configuration.limelightLockHash,
    collectionFontHash: preparedRenderer.limelightRecord.fontHash,
    collectionLicenceHash: preparedRenderer.limelightRecord.licenceHash,
    collectionMetadataHash: preparedRenderer.limelightRecord.metadataHash,
    testedOptionIds: TITLE_LOGO_OPTION_IDS,
    graphicElementCount: 0,
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
    byteIdentical: stableStringify(first.metadata.records.map((record) => [record.optionId, record.tmdbPersonId, record.outputHash, record.byteCount])) === stableStringify(second.metadata.records.map((record) => [record.optionId, record.tmdbPersonId, record.outputHash, record.byteCount])),
    metadataIdentical: stableStringify(first.metadata) === stableStringify(second.metadata),
    comparisons: first.metadata.records.map((record, index) => ({
      optionId: record.optionId,
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

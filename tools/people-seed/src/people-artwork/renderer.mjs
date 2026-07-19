import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { runFamilies, verifyFont } from "./font.mjs";
import { loadLandscapeCropOverrides, resolveLandscapeCropOverride } from "./landscape-crop-overrides.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";
import { resolvePortraitSource } from "./source-resolution.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const round = (value, places = 4) => Number(value.toFixed(places));
const codePointLength = (value) => [...value].length;
const FORMAT_ORDER = ["landscape", "poster"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readPreset(fileName) {
  const presetPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "presets", fileName);
  const buffer = await fs.readFile(presetPath);
  return { presetPath, presetHash: sha256(buffer), preset: JSON.parse(buffer) };
}

export async function loadPeopleArtworkPresets() {
  const [portraitLandscape, portraitPoster, fallbackLandscape, fallbackPoster] = await Promise.all([
    readPreset("people-landscape-cormorant-v1.json"),
    readPreset("people-poster-cormorant-v1.json"),
    readPreset("people-text-fallback-landscape-v2.json"),
    readPreset("people-text-fallback-poster-v1.json"),
  ]);
  return {
    portrait: { landscape: portraitLandscape, poster: portraitPoster },
    fallback: { landscape: fallbackLandscape, poster: fallbackPoster },
  };
}

function validateRuntimeAgainstPreset(runtime, preset) {
  for (const [name, value] of Object.entries({ sharp: runtime.versions.sharp, libvips: runtime.versions.libvips, skiaCanvas: runtime.versions.skiaCanvas })) {
    if (preset.renderer[name] !== value) throw new Error(`${preset.id}: renderer ${name} must be ${preset.renderer[name]}, found ${value}.`);
  }
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}

export function grainBuffer(width, height, seed, amount) {
  let state = seed || 1;
  const alpha = Math.round(255 * amount);
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const value = state & 255;
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = alpha;
  }
  return data;
}

function orientedDimensions(source) {
  return [5, 6, 7, 8].includes(source.exifOrientation)
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height };
}

export function cropFor(source, preset, formatId) {
  const oriented = orientedDimensions(source);
  const ratio = formatId === "landscape"
    ? preset.portraitRegion.width / preset.portraitRegion.height
    : preset.canvas.width / preset.canvas.height;
  let left = 0;
  const top = 0;
  let width = oriented.width;
  let height = oriented.height;
  if (oriented.width / oriented.height < ratio) {
    height = Math.max(1, Math.min(oriented.height, Math.round(oriented.width / ratio)));
  } else {
    width = Math.max(1, Math.min(oriented.width, Math.round(oriented.height * ratio)));
    left = Math.floor((oriented.width - width) / 2);
  }
  return {
    left,
    top,
    width,
    height,
    orientedSourceWidth: oriented.width,
    orientedSourceHeight: oriented.height,
    retainedAreaFraction: round(width * height / (oriented.width * oriented.height)),
  };
}

function cropCore(crop) {
  return { left: crop.left, top: crop.top, width: crop.width, height: crop.height };
}

function landscapeOverlay(preset) {
  const fade = preset.background.horizontalPortraitFade.map(([offset, opacity]) => `<stop offset="${offset * 100}%" stop-color="${preset.background.base}" stop-opacity="${opacity}"/>`).join("");
  const bottom = preset.background.bottomGradient;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.canvas.width}" height="${preset.canvas.height}"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="0">${fade}</linearGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="${bottom.startsAtCanvasPercent}%" stop-color="${bottom.colour}" stop-opacity="0"/><stop offset="100%" stop-color="${bottom.colour}" stop-opacity="${bottom.maximumOpacity}"/></linearGradient><radialGradient id="v"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${preset.tonal.vignetteOpacity}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#h)"/><rect width="100%" height="100%" fill="url(#b)"/><rect width="100%" height="100%" fill="url(#v)"/></svg>`);
}

function posterOverlay(preset) {
  const gradient = preset.background.bottomGradient;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.canvas.width}" height="${preset.canvas.height}"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="${gradient.transparentUntilCanvasPercent}%" stop-color="${gradient.bottomColour}" stop-opacity="0"/><stop offset="${gradient.transitionAtCanvasPercent}%" stop-color="${gradient.bottomColour}" stop-opacity="0.35"/><stop offset="100%" stop-color="${gradient.bottomColour}" stop-opacity="${gradient.maximumOpacity}"/></linearGradient><radialGradient id="v"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${preset.tonal.vignetteOpacity}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#b)"/><rect width="100%" height="100%" fill="url(#v)"/></svg>`);
}

async function buildPortraitBase(source, preset, formatId, sharp, cropOverride = null) {
  const oriented = orientedDimensions(source);
  const crop = cropOverride?.used
    ? {
        ...cropOverride.record.cropRectangle,
        orientedSourceWidth: oriented.width,
        orientedSourceHeight: oriented.height,
        retainedAreaFraction: round(cropOverride.record.cropRectangle.width * cropOverride.record.cropRectangle.height / (oriented.width * oriented.height)),
      }
    : cropFor(source, preset, formatId);
  assert(crop.left + crop.width <= oriented.width && crop.top + crop.height <= oriented.height, `${source.stableKey ?? "portrait source"}: crop rectangle exceeds the oriented source.`);
  const target = cropOverride?.used
    ? {
        x: cropOverride.record.cropOffsetX,
        y: cropOverride.record.cropOffsetY,
        width: Math.round(crop.width * cropOverride.record.cropScale.x),
        height: Math.round(crop.height * cropOverride.record.cropScale.y),
      }
    : formatId === "landscape"
      ? preset.portraitRegion
      : { x: 0, y: 0, width: preset.canvas.width, height: preset.canvas.height };
  assert(target.x + target.width <= preset.canvas.width && target.y + target.height <= preset.canvas.height, "Effective portrait bounds exceed the canvas.");
  const scaleX = target.width / crop.width;
  const scaleY = target.height / crop.height;
  const upscaleFactor = round(Math.max(scaleX, scaleY));
  const lowResolution = source.width < 600 || source.height < 800 || upscaleFactor > 2;
  const grainAmount = lowResolution ? preset.grain.lowResolutionAmount : preset.grain.amount;
  const seedPrefix = formatId === "landscape" ? "B" : "poster";
  const grainSeed = parseInt(sha256(`${seedPrefix}:${source.sourceHash}:people-grain-v1`).slice(0, 8), 16) >>> 0;
  const intercept = 128 - 128 * preset.tonal.contrast;
  const portrait = await sharp(source.sourcePath)
    .rotate()
    .extract(cropCore(crop))
    .resize(target.width, target.height, { fit: "fill", kernel: sharp.kernel.cubic })
    .toColorspace("srgb")
    .grayscale()
    .tint(preset.tonal.tint)
    .modulate({ brightness: preset.tonal.brightness })
    .linear(preset.tonal.contrast, intercept)
    .png()
    .toBuffer();
  const composites = [
    { input: portrait, left: target.x, top: target.y },
    { input: formatId === "landscape" ? landscapeOverlay(preset) : posterOverlay(preset), left: 0, top: 0 },
  ];
  if (grainAmount > 0) {
    composites.push({
      input: grainBuffer(preset.canvas.width, preset.canvas.height, grainSeed, grainAmount),
      raw: { width: preset.canvas.width, height: preset.canvas.height, channels: 4 },
      left: 0,
      top: 0,
      blend: preset.grain.blend,
    });
  }
  const buffer = await sharp({ create: { width: preset.canvas.width, height: preset.canvas.height, channels: 3, background: hexToRgb(preset.background.base) } })
    .composite(composites)
    .png()
    .toBuffer();
  return {
    buffer,
    crop,
    target,
    resizeScale: cropOverride?.used ? cropOverride.record.cropScale : { x: round(scaleX), y: round(scaleY) },
    upscaleFactor,
    grainAmount,
    grainSeed,
    cropOverride,
  };
}

function typographyLayout(preset, fallback) {
  const typography = preset.typography;
  return {
    region: typography.region,
    alignment: fallback ? typography.horizontalAlignment : typography.alignment,
    opticalCenterCanvas: fallback,
    requested: typography.requestedFontSize,
    minimum: typography.minimumFontSize,
    step: typography.fontSizeStep,
    lineHeight: typography.lineHeight,
    oneLineMaximumUnicodeCodePoints: typography.oneLineMaximumUnicodeCodePoints,
    colour: typography.colour,
    maximumWidth: typography.maximumWidth ?? typography.region.width,
    maximumHeight: typography.maximumHeight ?? typography.region.height,
  };
}

function textContext(fontSize, runtime, fontRecord) {
  const canvas = new runtime.Canvas(3200, 800);
  const context = canvas.getContext("2d");
  context.font = `${fontRecord.weight} ${fontSize}px "${fontRecord.registrationAlias}"`;
  context.letterSpacing = "0px";
  context.textBaseline = "alphabetic";
  return context;
}

function measureLine(text, fontSize, runtime, fontRecord) {
  const metrics = textContext(fontSize, runtime, fontRecord).measureText(text);
  const families = runFamilies(metrics);
  assert(families.length > 0 && families.every((family) => family === fontRecord.family), `Glyph fallback while fitting ${text}`);
  return { text, width: metrics.width, ascent: Math.max(1, metrics.actualBoundingBoxAscent), descent: Math.max(1, metrics.actualBoundingBoxDescent) };
}

export function balancedWrap(name, fontSize, runtime, fontRecord) {
  const words = name.trim().split(/\s+/u);
  if (words.length < 2) return [name];
  const candidates = [];
  for (let split = 1; split < words.length; split += 1) {
    const lines = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    const widths = lines.map((line) => measureLine(line, fontSize, runtime, fontRecord).width);
    candidates.push({ split, lines, difference: Math.abs(widths[0] - widths[1]), maxWidth: Math.max(...widths) });
  }
  candidates.sort((left, right) => left.difference - right.difference || left.maxWidth - right.maxWidth || left.split - right.split);
  return candidates[0].lines;
}

export async function fitTypography(name, preset, runtime, fontRecord, { fallback = false } = {}) {
  const layout = typographyLayout(preset, fallback);
  let lines = codePointLength(name) <= layout.oneLineMaximumUnicodeCodePoints ? [name] : balancedWrap(name, layout.requested, runtime, fontRecord);
  if (lines.length === 1 && measureLine(name, layout.requested, runtime, fontRecord).width > layout.maximumWidth) {
    lines = balancedWrap(name, layout.requested, runtime, fontRecord);
  }
  let chosen = null;
  for (let fontSize = layout.requested; fontSize >= layout.minimum; fontSize -= layout.step) {
    const measures = lines.map((line) => measureLine(line, fontSize, runtime, fontRecord));
    const maxAscent = Math.max(...measures.map((item) => item.ascent));
    const maxDescent = Math.max(...measures.map((item) => item.descent));
    const width = Math.max(...measures.map((item) => item.width));
    const height = maxAscent + maxDescent + (lines.length - 1) * layout.lineHeight;
    chosen = { fontSize, measures, maxAscent, maxDescent, width, height };
    if (width <= layout.maximumWidth && height <= layout.maximumHeight) break;
  }
  assert(chosen.width <= layout.maximumWidth + 0.5 && chosen.height <= layout.maximumHeight + 0.5, `Typography cannot fit ${name}`);
  const blockY = layout.region.y + (layout.region.height - chosen.height) / 2;
  const pending = lines.map((line, index) => {
    const measure = chosen.measures[index];
    return {
      text: line,
      measure,
      x: layout.alignment === "center" ? layout.region.x + (layout.region.width - measure.width) / 2 : layout.region.x,
      baseline: blockY + chosen.maxAscent + index * layout.lineHeight,
    };
  });
  const initialMinY = Math.min(...pending.map((item) => item.baseline - item.measure.ascent));
  const initialMaxY = Math.max(...pending.map((item) => item.baseline + item.measure.descent));
  const verticalShift = layout.opticalCenterCanvas ? preset.canvas.height / 2 - (initialMinY + initialMaxY) / 2 : 0;
  const canvas = new runtime.Canvas(preset.canvas.width, preset.canvas.height);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, preset.canvas.width, preset.canvas.height);
  context.fillStyle = layout.colour;
  context.font = `${fontRecord.weight} ${chosen.fontSize}px "${fontRecord.registrationAlias}"`;
  context.letterSpacing = "0px";
  context.textBaseline = "alphabetic";
  const lineBounds = pending.map((item) => {
    const baseline = item.baseline + verticalShift;
    context.fillText(item.text, item.x, baseline);
    return { x: round(item.x), y: round(baseline - item.measure.ascent), width: round(item.measure.width), height: round(item.measure.ascent + item.measure.descent), baseline: round(baseline) };
  });
  const buffer = await canvas.toBuffer("png");
  const minX = Math.min(...lineBounds.map((item) => item.x));
  const minY = Math.min(...lineBounds.map((item) => item.y));
  const maxX = Math.max(...lineBounds.map((item) => item.x + item.width));
  const maxY = Math.max(...lineBounds.map((item) => item.y + item.height));
  const safeMargins = {
    left: round(minX - layout.region.x),
    right: round(layout.region.x + layout.region.width - maxX),
    top: round(minY - layout.region.y),
    bottom: round(layout.region.y + layout.region.height - maxY),
  };
  return {
    buffer,
    requestedFontSize: layout.requested,
    finalFontSize: chosen.fontSize,
    lines,
    lineCount: lines.length,
    lineHeight: layout.lineHeight,
    textBounds: { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) },
    lineBounds,
    safeMargins,
    clipping: Object.values(safeMargins).some((value) => value < -0.5),
  };
}

async function renderPortrait({ person, source, formatId, presetRecord, runtime, fontRecord, cropOverride = null }) {
  const { preset, presetHash } = presetRecord;
  if (cropOverride?.used) {
    assert(cropOverride.record.basePresetId === preset.id, `${person.stableKey}: crop override preset ID mismatch.`);
    assert(cropOverride.record.basePresetHash === presetHash, `${person.stableKey}: crop override preset hash mismatch.`);
  }
  const base = await buildPortraitBase(source, preset, formatId, runtime.sharp, cropOverride);
  const typography = await fitTypography(person.canonicalName, preset, runtime, fontRecord);
  assert(!typography.clipping && typography.lineCount <= 2 && typography.lines.join(" ") === person.canonicalName, `${person.stableKey}/${formatId}: typography validation failed.`);
  const output = await runtime.sharp(base.buffer).composite([{ input: typography.buffer, left: 0, top: 0 }]).webp(preset.output).toBuffer();
  const gradientBounds = formatId === "landscape"
    ? { x: 0, y: Math.round(preset.canvas.height * preset.background.bottomGradient.startsAtCanvasPercent / 100), width: preset.canvas.width, height: preset.canvas.height - Math.round(preset.canvas.height * preset.background.bottomGradient.startsAtCanvasPercent / 100) }
    : { x: 0, y: Math.round(preset.canvas.height * preset.background.bottomGradient.transparentUntilCanvasPercent / 100), width: preset.canvas.width, height: preset.canvas.height - Math.round(preset.canvas.height * preset.background.bottomGradient.transparentUntilCanvasPercent / 100) };
  return { output, preset, presetHash, typography, base, gradientBounds };
}

async function renderFallback({ person, source, formatId, presetRecord, runtime, fontRecord }) {
  const { preset, presetHash } = presetRecord;
  const typography = await fitTypography(person.canonicalName, preset, runtime, fontRecord, { fallback: true });
  assert(!typography.clipping && typography.lineCount <= 2 && typography.lines.join(" ") === person.canonicalName, `${person.stableKey}/${formatId}: fallback typography validation failed.`);
  const grainSeed = parseInt(sha256(`people-text-fallback-v1|${formatId}|${person.stableKey}|${person.canonicalName}`).slice(0, 8), 16) >>> 0;
  const base = await runtime.sharp({ create: { width: preset.canvas.width, height: preset.canvas.height, channels: 3, background: hexToRgb(preset.background.base) } })
    .composite([{ input: grainBuffer(preset.canvas.width, preset.canvas.height, grainSeed, preset.grain.amount), raw: { width: preset.canvas.width, height: preset.canvas.height, channels: 4 }, left: 0, top: 0, blend: preset.grain.blend }])
    .png()
    .toBuffer();
  const output = await runtime.sharp(base).composite([{ input: typography.buffer, left: 0, top: 0 }]).webp(preset.output).toBuffer();
  return { output, preset, presetHash, typography, grainSeed, grainAmount: preset.grain.amount, source };
}

async function atomicWrite(filePath, buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath);
}

export function assertSafeOutputDirectory(outputDir) {
  const resolved = path.resolve(outputDir);
  const relative = path.relative(PEOPLE_ARTWORK_REPO_ROOT, resolved).replaceAll("\\", "/");
  const protectedPrefixes = [
    "assets/collection_covers/people",
    "assets/collection_covers/companies",
    "assets/collection_covers/networks",
    "tools/studio-network-batch",
  ];
  if (relative === "assets/collection_covers" || protectedPrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
    throw new Error(`People renderer refuses protected or permanent output directory: ${resolved}`);
  }
  return resolved;
}

function metadataRow({ person, source, formatId, rendered, presetRecord, fontRecord, outputRelativePath, outputHash, byteCount, fallbackUsed, cropOverride = null }) {
  const { preset, presetHash } = presetRecord;
  const typography = rendered.typography;
  const base = fallbackUsed ? null : rendered.base;
  return {
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName,
    categoryMembership: person.categoryMembership,
    categoryNeutralReuse: true,
    formatId,
    fallbackUsed,
    fallbackReason: fallbackUsed ? source.fallbackReason : null,
    profilePathAttempted: source.profilePathAttempted,
    sourceStatus: source.sourceStatus,
    sourceDecision: source.sourceDecision,
    sourcePath: fallbackUsed ? null : source.cacheEntry.sourceFile.replaceAll("\\", "/"),
    sourceHash: fallbackUsed ? null : source.sourceHash,
    sourceWidth: fallbackUsed ? null : source.width,
    sourceHeight: fallbackUsed ? null : source.height,
    independentlyGeneratedFromOriginalSource: !fallbackUsed,
    derivedFromOtherFormat: false,
    presetId: preset.id,
    presetHash,
    fontFamily: fontRecord.family,
    fontWeight: fontRecord.weight,
    fontHash: fontRecord.fontHash,
    requestedFontSize: typography.requestedFontSize,
    finalFontSize: typography.finalFontSize,
    nameLines: typography.lines,
    lineCount: typography.lineCount,
    lineHeight: typography.lineHeight,
    textBounds: typography.textBounds,
    safeMargins: typography.safeMargins,
    cropMethod: fallbackUsed ? null : cropOverride?.used ? cropOverride.record.cropStrategy : preset.crop.strategy,
    cropRectangle: fallbackUsed ? null : cropCore(base.crop),
    cropRetainedAreaFraction: fallbackUsed ? null : base.crop.retainedAreaFraction,
    resizeScale: fallbackUsed ? null : base.resizeScale,
    upscaleFactor: fallbackUsed ? null : base.upscaleFactor,
    portraitBounds: fallbackUsed ? null : base.target,
    gradientBounds: fallbackUsed ? null : rendered.gradientBounds,
    grainSeed: fallbackUsed ? rendered.grainSeed : base.grainSeed,
    grainAmount: fallbackUsed ? rendered.grainAmount : base.grainAmount,
    canvasWidth: preset.canvas.width,
    canvasHeight: preset.canvas.height,
    outputPath: outputRelativePath,
    outputHash,
    byteCount,
    ...(cropOverride?.used ? {
      cropOverrideUsed: true,
      cropOverrideId: cropOverride.id,
      cropOverrideConfigHash: cropOverride.configHash,
      cropOverrideSourceHash: cropOverride.record.sourceHash,
      cropOverrideStatus: cropOverride.status,
      effectiveCropRectangle: cropCore(base.crop),
      effectiveCropScale: cropOverride.record.cropScale,
      effectiveCropOffset: { x: cropOverride.record.cropOffsetX, y: cropOverride.record.cropOffsetY },
    } : {}),
  };
}

export async function renderPeopleArtwork({
  people,
  decisions,
  sourceCache,
  outputDir,
  format = "both",
  offline = true,
  fontDirectory = null,
  dryRun = false,
  fetchImpl = fetch,
  retryDelay,
  runtime: providedRuntime = null,
  landscapeCropOverrides = null,
} = {}) {
  const runtime = providedRuntime || loadPeopleArtworkRuntime();
  const presets = await loadPeopleArtworkPresets();
  for (const group of Object.values(presets)) for (const item of Object.values(group)) validateRuntimeAgainstPreset(runtime, item.preset);
  const fontRecord = await verifyFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: people.map((person) => person.canonicalName), fontDirectory });
  const formats = format === "both" ? FORMAT_ORDER : [format];
  const overrideConfiguration = formats.includes("landscape")
    ? landscapeCropOverrides || await loadLandscapeCropOverrides()
    : null;
  const resolvedOutput = dryRun ? null : assertSafeOutputDirectory(outputDir);
  const records = [];
  const resolutions = [];
  const networkAttempts = [];
  for (const person of people) {
    const source = await resolvePortraitSource({ person, decisions, sourceCache, offline, sharp: runtime.sharp, fetchImpl, retryDelay });
    networkAttempts.push(...source.attempts);
    resolutions.push({
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      sourceDecision: source.sourceDecision,
      resolvedProfilePath: source.profilePathAttempted,
      sourceStatus: source.sourceStatus,
      fallbackReason: source.fallbackReason,
      sourceHash: source.available ? source.sourceHash : null,
      sourceWidth: source.available ? source.width : null,
      sourceHeight: source.available ? source.height : null,
      cacheHit: source.sourceStatus === "validated-cache-hit",
    });
    if (dryRun) continue;
    for (const formatId of formats) {
      const cropOverride = formatId === "landscape"
        ? resolveLandscapeCropOverride({ person, source, formatId, overrideConfiguration })
        : null;
      const fallbackUsed = !source.available;
      const presetRecord = fallbackUsed ? presets.fallback[formatId] : presets.portrait[formatId];
      const rendered = fallbackUsed
        ? await renderFallback({ person, source, formatId, presetRecord, runtime, fontRecord })
        : await renderPortrait({ person, source, formatId, presetRecord, runtime, fontRecord, cropOverride });
      const outputRelativePath = `${formatId}/${person.tmdbPersonId}.webp`;
      const outputPath = path.join(resolvedOutput, outputRelativePath);
      await atomicWrite(outputPath, rendered.output);
      const decoded = await runtime.sharp(rendered.output, { failOn: "error" }).metadata();
      assert(decoded.format === "webp" && decoded.width === rendered.preset.canvas.width && decoded.height === rendered.preset.canvas.height, `${person.stableKey}/${formatId}: output decode failed.`);
      records.push(metadataRow({ person, source, formatId, rendered, presetRecord, fontRecord, outputRelativePath, outputHash: sha256(rendered.output), byteCount: rendered.output.length, fallbackUsed, cropOverride }));
    }
  }
  return {
    metadata: { version: "people-artwork-render-metadata-v1", ordering: "selection-order-then-landscape-poster", recordCount: records.length, records },
    resolutions,
    fontRecord,
    presetRecords: presets,
    networkAccounting: {
      profileImageDownloads: networkAttempts.filter((item) => item.outcome === "response-received").length,
      tmdbMetadataRequests: 0,
      personImagesRequests: 0,
      imageCdnRequests: networkAttempts.length,
      fontDownloads: 0,
      sourceCacheHits: resolutions.filter((item) => item.cacheHit).length,
      generalWebRequests: 0,
      unauthorisedRequests: 0,
      attemptedRequests: networkAttempts,
    },
    dryRun,
    offline,
  };
}

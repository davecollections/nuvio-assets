import path from "node:path";

import sharp from "sharp";

import { atomicWrite } from "./atomic.mjs";
import {
  assertProductionFallbackFont,
  checkInterAvailability,
  NON_PRODUCTION_FONT_STACK,
} from "./font-check.mjs";

export function calculateFit(visibleWidth, visibleHeight, canvas, logoConfig) {
  if (!(visibleWidth > 0) || !(visibleHeight > 0)) throw new Error("Visible logo dimensions must be positive.");
  const maximumWidth = Math.floor(canvas.width * logoConfig.maximumVisibleWidthPercent / 100);
  const maximumHeight = Math.floor(canvas.height * logoConfig.maximumVisibleHeightPercent / 100);
  const scale = Math.min(maximumWidth / visibleWidth, maximumHeight / visibleHeight);
  let width = Math.max(1, Math.floor(visibleWidth * scale));
  let height = Math.max(1, Math.floor(visibleHeight * scale));
  if (width > maximumWidth) width = maximumWidth;
  if (height > maximumHeight) height = maximumHeight;
  return {
    maximumWidth,
    maximumHeight,
    width,
    height,
    scale: Math.min(width / visibleWidth, height / visibleHeight),
    upscaleFactor: Math.max(width / visibleWidth, height / visibleHeight),
    resizeDirection: scale > 1 ? "enlarged" : scale < 1 ? "reduced" : "unchanged",
    left: Math.floor((canvas.width - width) / 2),
    top: Math.floor((canvas.height - height) / 2),
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function gradientSvg(width, height, start, end) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`);
}

function backgroundInput(preset, selectedBackground, style, sharpImpl) {
  const { width, height } = preset.canvas;
  if (style === "subtle-gradient") {
    const start = selectedBackground === "dark"
      ? preset.backgrounds.darkGradientStart
      : preset.backgrounds.lightGradientStart;
    const end = selectedBackground === "dark"
      ? preset.backgrounds.darkGradientEnd
      : preset.backgrounds.lightGradientEnd;
    return sharpImpl(gradientSvg(width, height, start, end));
  }
  return sharpImpl({
    create: {
      width,
      height,
      channels: 4,
      background: selectedBackground === "dark" ? preset.backgrounds.dark : preset.backgrounds.light,
    },
  });
}

function webpOptions(preset) {
  return {
    quality: preset.output.quality,
    effort: preset.output.effort,
    smartSubsample: preset.output.smartSubsample,
  };
}

export async function renderLogoCover(analysis, preset, {
  backgroundStyle = preset.backgrounds.primaryStyle,
  selectedBackground = analysis.selectedBackground,
  sharpImpl = sharp,
} = {}) {
  const fit = calculateFit(analysis.visibleWidth, analysis.visibleHeight, preset.canvas, preset.logo);
  const visibleLogo = await sharpImpl(analysis.normalisedBuffer, {
    raw: { width: analysis.sourceWidth, height: analysis.sourceHeight, channels: 4 },
  })
    .extract(analysis.visibleBounds)
    .resize({ width: fit.width, height: fit.height, fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const buffer = await backgroundInput(preset, selectedBackground, backgroundStyle, sharpImpl)
    .composite([{ input: visibleLogo, left: fit.left, top: fit.top }])
    .webp(webpOptions(preset))
    .toBuffer();
  const reviewReasons = [...analysis.reviewReasons];
  if (fit.upscaleFactor > preset.logo.highUpscaleReviewThreshold) {
    reviewReasons.push("high-upscale-factor");
  }
  return {
    buffer,
    fit,
    selectedBackground,
    backgroundPreset: `${selectedBackground}-${backgroundStyle}`,
    reviewReasons: [...new Set(reviewReasons)],
  };
}

function estimatedTextWidth(value, fontSize) {
  let units = 0;
  for (const character of value) {
    if (character === " ") units += 0.33;
    else if (/[ilI1|.,'`]/.test(character)) units += 0.3;
    else if (/[MW@%&]/.test(character)) units += 0.9;
    else if (/[A-Z0-9]/.test(character)) units += 0.67;
    else units += 0.55;
  }
  return units * fontSize;
}

function bestWordWrap(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let best = null;
  for (let index = 1; index < words.length; index += 1) {
    const lines = [words.slice(0, index).join(" "), words.slice(index).join(" ")];
    const widths = lines.map((line) => estimatedTextWidth(line, 1));
    const score = Math.max(...widths) + Math.abs(widths[0] - widths[1]) * 0.12;
    if (!best || score < best.score) best = { lines, score };
  }
  return best.lines;
}

function unavoidableCharacterWrap(name) {
  const compact = name.trim();
  const midpoint = Math.ceil(compact.length / 2);
  return [compact.slice(0, midpoint), compact.slice(midpoint)];
}

export function layoutFallbackText(name, preset) {
  const safeWidth = Math.floor(preset.canvas.width * preset.logo.maximumVisibleWidthPercent / 100);
  const safeHeight = Math.floor(preset.canvas.height * preset.logo.maximumVisibleHeightPercent / 100);
  const config = preset.fallbackText ?? {};
  const fontFamily = config.requireConfirmedFont
    ? config.requiredFontFamily ?? "Inter"
    : config.fontFamily ?? NON_PRODUCTION_FONT_STACK;
  const maximumFontSize = config.maximumFontSize ?? 96;
  const minimumFontSize = config.minimumFontSize ?? 28;
  const lineHeightMultiplier = config.lineHeightMultiplier ?? 1.18;
  const cleanName = name.trim();
  const wrapped = bestWordWrap(cleanName);
  for (let fontSize = maximumFontSize; fontSize >= minimumFontSize; fontSize -= 2) {
    const lineHeight = Math.round(fontSize * lineHeightMultiplier);
    if (estimatedTextWidth(cleanName, fontSize) <= safeWidth && lineHeight <= safeHeight) {
      return { lines: [cleanName], wrappedTextLines: [cleanName], lineCount: 1, fontFamily, fontSize, lineHeight, safeWidth, safeHeight };
    }
    if (wrapped && wrapped.every((line) => estimatedTextWidth(line, fontSize) <= safeWidth) && 2 * lineHeight <= safeHeight) {
      return { lines: wrapped, wrappedTextLines: wrapped, lineCount: 2, fontFamily, fontSize, lineHeight, safeWidth, safeHeight };
    }
  }
  for (let fontSize = minimumFontSize - 1; fontSize >= 18; fontSize -= 1) {
    const lineHeight = Math.round(fontSize * lineHeightMultiplier);
    const lines = wrapped ?? unavoidableCharacterWrap(cleanName);
    if (lines.every((line) => estimatedTextWidth(line, fontSize) <= safeWidth) && 2 * lineHeight <= safeHeight) {
      return { lines, wrappedTextLines: lines, lineCount: lines.length, fontFamily, fontSize, lineHeight, safeWidth, safeHeight };
    }
  }
  const lines = wrapped ?? unavoidableCharacterWrap(cleanName);
  return { lines, wrappedTextLines: lines, lineCount: lines.length, fontFamily, fontSize: 18, lineHeight: 21, safeWidth, safeHeight };
}

export async function renderFallbackCover(entity, preset, { sharpImpl = sharp, fontCheckResult = null } = {}) {
  if (preset.fallbackText?.requireConfirmedFont) {
    const result = fontCheckResult ?? await checkInterAvailability({
      requestedFamily: preset.fallbackText.requiredFontFamily ?? "Inter",
    });
    assertProductionFallbackFont(preset, result);
  }
  const layout = layoutFallbackText(entity.name, preset);
  const selectedBackground = preset.fallbackText?.selectedBackground ?? "dark";
  const backgroundColour = preset.backgrounds[selectedBackground];
  const textColour = selectedBackground === "dark" ? preset.backgrounds.light : preset.backgrounds.dark;
  const centreY = preset.canvas.height / 2;
  const firstBaseline = centreY - ((layout.lines.length - 1) * layout.lineHeight) / 2 + layout.fontSize * 0.35;
  const text = layout.lines.map((line, index) =>
    `<text x="${preset.canvas.width / 2}" y="${firstBaseline + index * layout.lineHeight}" text-anchor="middle">${escapeXml(line)}</text>`,
  ).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.canvas.width}" height="${preset.canvas.height}">
    <rect width="100%" height="100%" fill="${backgroundColour}"/>
    <g fill="${textColour}" font-family="${escapeXml(layout.fontFamily)}" font-size="${layout.fontSize}" font-weight="${preset.fallbackText?.fontWeight ?? 600}">${text}</g>
  </svg>`);
  const buffer = await sharpImpl(svg).webp(webpOptions(preset)).toBuffer();
  return {
    buffer,
    layout: { ...layout, selectedBackground, textColour },
    selectedBackground,
    backgroundPreset: `${selectedBackground}-flat`,
    reviewReasons: ["missing-logo-text-fallback"],
  };
}

export function stagedOutputPath(packageRoot, presetVersion, entity, variantName = "primary") {
  const entityFolder = entity.entityType === "company" ? "companies" : "networks";
  if (variantName === "primary") {
    if (presetVersion === "production-v1") {
      return path.join(packageRoot, ".work", "staging", presetVersion, entityFolder, `${entity.tmdbId}.webp`);
    }
    return path.join(packageRoot, ".work", "staging", presetVersion, "primary", entityFolder, `${entity.tmdbId}.webp`);
  }
  return path.join(packageRoot, ".work", "staging", presetVersion, "variants", variantName, entityFolder, `${entity.tmdbId}.webp`);
}

export async function writeRenderedOutput(filePath, buffer) {
  await atomicWrite(filePath, buffer);
}

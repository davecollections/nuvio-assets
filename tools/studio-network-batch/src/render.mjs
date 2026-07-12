import path from "node:path";

import sharp from "sharp";

import { atomicWrite } from "./atomic.mjs";

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

function wrapText(name, maximumCharacters) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maximumCharacters) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function layoutFallbackText(name, preset) {
  const safeWidth = Math.floor(preset.canvas.width * preset.logo.maximumVisibleWidthPercent / 100);
  const safeHeight = Math.floor(preset.canvas.height * preset.logo.maximumVisibleHeightPercent / 100);
  for (let fontSize = 96; fontSize >= 28; fontSize -= 2) {
    const approximateCharacters = Math.max(4, Math.floor(safeWidth / (fontSize * 0.58)));
    const lines = wrapText(name, approximateCharacters);
    const lineHeight = Math.round(fontSize * 1.18);
    if (lines.length * lineHeight <= safeHeight && lines.every((line) => line.length <= approximateCharacters)) {
      return { lines, fontSize, lineHeight, safeWidth, safeHeight };
    }
  }
  return { lines: wrapText(name, 42), fontSize: 28, lineHeight: 34, safeWidth, safeHeight };
}

export async function renderFallbackCover(entity, preset, { sharpImpl = sharp } = {}) {
  const layout = layoutFallbackText(entity.name, preset);
  const centreY = preset.canvas.height / 2;
  const firstBaseline = centreY - ((layout.lines.length - 1) * layout.lineHeight) / 2 + layout.fontSize * 0.35;
  const text = layout.lines.map((line, index) =>
    `<text x="${preset.canvas.width / 2}" y="${firstBaseline + index * layout.lineHeight}" text-anchor="middle">${escapeXml(line)}</text>`,
  ).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.canvas.width}" height="${preset.canvas.height}">
    <rect width="100%" height="100%" fill="${preset.backgrounds.dark}"/>
    <g fill="${preset.backgrounds.light}" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${layout.fontSize}" font-weight="600">${text}</g>
  </svg>`);
  const buffer = await sharpImpl(svg).webp(webpOptions(preset)).toBuffer();
  return {
    buffer,
    layout,
    selectedBackground: "dark",
    backgroundPreset: "dark-flat",
    reviewReasons: ["missing-logo-text-fallback"],
  };
}

export function stagedOutputPath(packageRoot, presetVersion, entity, variantName = "primary") {
  const entityFolder = entity.entityType === "company" ? "companies" : "networks";
  if (variantName === "primary") {
    return path.join(packageRoot, ".work", "staging", presetVersion, "primary", entityFolder, `${entity.tmdbId}.webp`);
  }
  return path.join(packageRoot, ".work", "staging", presetVersion, "variants", variantName, entityFolder, `${entity.tmdbId}.webp`);
}

export async function writeRenderedOutput(filePath, buffer) {
  await atomicWrite(filePath, buffer);
}

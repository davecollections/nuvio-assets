import sharp from "sharp";

import { bufferFingerprint } from "./fingerprints.mjs";
import { PipelineError } from "./pipeline-error.mjs";

export function parseHexColour(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`Invalid six-digit hex colour: ${value}`);
  const number = Number.parseInt(match[1], 16);
  return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

function contrastRatio(left, right) {
  const high = Math.max(left, right);
  const low = Math.min(left, right);
  return (high + 0.05) / (low + 0.05);
}

function weightedQuantile(samples, quantile) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = totalWeight * quantile;
  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.weight;
    if (cumulative >= target) return sample.value;
  }
  return sorted.at(-1).value;
}

function scoreAgainstBackground(pixels, background, config) {
  const backgroundLuminance = relativeLuminance(background);
  const samples = [];
  let usefulWeight = 0;
  let strongWeight = 0;
  let totalWeight = 0;

  for (const pixel of pixels) {
    const alpha = pixel.a / 255;
    const composited = {
      r: pixel.r * alpha + background.r * (1 - alpha),
      g: pixel.g * alpha + background.g * (1 - alpha),
      b: pixel.b * alpha + background.b * (1 - alpha),
    };
    const ratio = contrastRatio(relativeLuminance(composited), backgroundLuminance);
    samples.push({ value: ratio, weight: alpha });
    totalWeight += alpha;
    if (ratio >= config.usefulRatio) usefulWeight += alpha;
    if (ratio >= config.strongRatio) strongWeight += alpha;
  }

  const lowerPercentile = weightedQuantile(samples, 0.1);
  const median = weightedQuantile(samples, 0.5);
  const usefulProportion = totalWeight ? usefulWeight / totalWeight : 0;
  const strongProportion = totalWeight ? strongWeight / totalWeight : 0;
  const robustScore =
    lowerPercentile * 0.45 +
    median * 0.35 +
    usefulProportion * 1.25 +
    strongProportion * 0.75;
  return { robustScore, lowerPercentile, median, usefulProportion, strongProportion };
}

export function chooseBackground(visiblePixels, backgrounds, config) {
  const dark = scoreAgainstBackground(visiblePixels, parseHexColour(backgrounds.dark), config);
  const light = scoreAgainstBackground(visiblePixels, parseHexColour(backgrounds.light), config);
  const selected = dark.robustScore >= light.robustScore ? "dark" : "light";
  const confidence = Math.abs(dark.robustScore - light.robustScore);
  const best = Math.max(dark.robustScore, light.robustScore);
  const reviewReasons = [];
  if (best < config.minimumRobustScore) reviewReasons.push("low-robust-contrast");
  if (confidence < config.closeScoreDifference) reviewReasons.push("close-background-scores");
  return {
    selected,
    dark,
    light,
    confidence,
    reviewReasons,
  };
}

export async function analyseLogo(input, preset, { sharpImpl = sharp } = {}) {
  let result;
  try {
    result = await sharpImpl(input, { failOn: "error" })
      .rotate()
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new PipelineError("decode_failed", `Could not normalise logo pixels: ${error.message}`, { cause: error });
  }
  const { width, height, channels } = result.info;
  if (!width || !height || channels !== 4) {
    throw new PipelineError("zero_size_image", "Normalised logo has invalid RGBA dimensions.");
  }

  const threshold = preset.logo.visibleAlphaThreshold;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let visiblePixelCount = 0;
  let alphaSum = 0;
  let luminanceWeightedSum = 0;
  const visiblePixels = [];

  for (let index = 0, pixelIndex = 0; index < result.data.length; index += 4, pixelIndex += 1) {
    const r = result.data[index];
    const g = result.data[index + 1];
    const b = result.data[index + 2];
    const a = result.data[index + 3];
    if (a < threshold) continue;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    visiblePixelCount += 1;
    alphaSum += a;
    luminanceWeightedSum += relativeLuminance({ r, g, b }) * (a / 255);
    visiblePixels.push({ r, g, b, a });
  }

  if (!visiblePixelCount) {
    throw new PipelineError("no_visible_pixels", `Logo has no pixels at or above alpha threshold ${threshold}.`);
  }

  const visibleBounds = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const transparentPadding = {
    left,
    top,
    right: width - right - 1,
    bottom: height - bottom - 1,
  };
  const alphaCoverage = alphaSum / (255 * width * height);
  const visibleAreaProportion = (visibleBounds.width * visibleBounds.height) / (width * height);
  const edgePixelCount = width * 2 + Math.max(0, height - 2) * 2;
  let opaqueEdgePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const alpha = result.data[(y * width + x) * 4 + 3];
      if (alpha >= 250) opaqueEdgePixels += 1;
    }
  }
  const opaqueEdgeProportion = edgePixelCount ? opaqueEdgePixels / edgePixelCount : 0;
  const unexpectedlyOpaqueBackground =
    visibleBounds.width === width && visibleBounds.height === height && opaqueEdgeProportion > 0.9;

  const contrast = chooseBackground(visiblePixels, preset.backgrounds, preset.contrast);
  const reviewReasons = [...contrast.reviewReasons];
  if (width > preset.logo.extremeDimension || height > preset.logo.extremeDimension) {
    reviewReasons.push("extreme-source-dimensions");
  }
  if (
    visibleBounds.width < preset.logo.lowResolutionMinimumWidth ||
    visibleBounds.height < preset.logo.lowResolutionMinimumHeight
  ) {
    reviewReasons.push("likely-low-resolution-source");
  }
  if (unexpectedlyOpaqueBackground) reviewReasons.push("unexpectedly-opaque-source-background");

  const header = Buffer.from(`${width}x${height}x4:`);
  return {
    normalisedBuffer: result.data,
    normalisedPixelHash: bufferFingerprint(Buffer.concat([header, result.data])),
    sourceWidth: width,
    sourceHeight: height,
    visibleBounds,
    visibleWidth: visibleBounds.width,
    visibleHeight: visibleBounds.height,
    transparentPadding,
    visibleAreaProportion,
    visiblePixelCount,
    alphaCoverage,
    opaqueEdgeProportion,
    unexpectedlyOpaqueBackground,
    meanVisibleLuminance: alphaSum ? luminanceWeightedSum / (alphaSum / 255) : 0,
    selectedBackground: contrast.selected,
    darkContrastScore: contrast.dark.robustScore,
    lightContrastScore: contrast.light.robustScore,
    contrastConfidence: contrast.confidence,
    contrastDetails: { dark: contrast.dark, light: contrast.light },
    reviewReasons: [...new Set(reviewReasons)],
  };
}

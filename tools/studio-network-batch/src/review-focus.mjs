import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { compareEntities } from "./constants.mjs";
import { createContactSheet } from "./contact-sheet.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";
import { analyseLogo, parseHexColour } from "./image-analysis.mjs";
import { renderLogoCover } from "./render.mjs";
import { snapshotProductionDirectory } from "./staging-snapshot.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CONTRAST_DEFINITIONS = [
  { requestedName: "Marvel Studios", names: ["Marvel Studios"], category: "clear", expected: "single", recommendation: "switch-light", rationale: "The black STUDIOS wording disappears on dark; the light comparison restores the full wordmark." },
  { requestedName: "Automat Pictures", names: ["Automat Pictures"], category: "clear", expected: "single", recommendation: "switch-light", rationale: "The dark PICTURES wording is lost on dark and becomes legible on light." },
  { requestedName: "Universal 1440 Entertainment", names: ["Universal 1440 Entertainment"], category: "clear", expected: "single", recommendation: "retain-current", rationale: "The white wordmark and globe remain cohesive and clear on the current dark background; light makes the outlined lettering harsher." },
  { requestedName: "Wanda Pictures", names: ["Wanda Pictures"], category: "clear", expected: "single", recommendation: "retain-current", rationale: "The current dark background preserves the intended gold/red balance with comparable readability." },
  { requestedName: "discovery+", names: ["discovery+"], category: "clear", expected: "all-new", caseInsensitive: true, recommendation: "switch-light", rationale: "The grey discovery+ wordmark has materially stronger readability on light." },
  { requestedName: "M2 Entertainment", names: ["M2 Entertainment", "MM2 Entertainment"], category: "borderline", expected: "single", recommendation: "retain-current", rationale: "The blue, grey and white mark remains fully legible on the current dark background." },
  { requestedName: "La Poudrière", names: ["La Poudrière"], category: "borderline", expected: "single", recommendation: "switch-light", rationale: "Black lettering merges into the current dark background and is restored by light." },
  { requestedName: "Recorded Picture Company", names: ["Recorded Picture Company"], category: "borderline", expected: "single", recommendation: "retain-current", rationale: "The current light background keeps the small black wording visible; dark hides it." },
];
const RESOLUTION_VISUAL_FINDINGS = new Map([
  ["company:164", "The distressed texture is intentional and remains readable at final cover size."],
  ["company:494", "The geometric wordmark retains clean edges at final cover size."],
  ["company:3528", "The short high-contrast wordmark remains crisp despite its 45-pixel visible source height."],
  ["company:4667", "The thin high-contrast lettering remains clean despite its 38-pixel source height."],
  ["company:5240", "The enlarged mark remains clean and fully readable."],
  ["company:10950", "The symbol and wordmark remain clean and fully readable."],
  ["company:12037", "The rough letterforms are intentional artwork and remain readable."],
  ["company:14185", "The compact symbol and subtitle remain clean at final cover size."],
  ["company:28205", "The serif lettering remains readable without visible damaging artifacts."],
]);
const CONTRAST_VARIANTS = ["current", "forced-light", "forced-dark"];
const ACTION_GROUPS = [
  "safe-fallback-batch-approval",
  "safe-opaque-batch-approval",
  "contrast-switch-candidates",
  "contrast-retain-candidates",
  "upscale-acceptable",
  "needs-better-source",
  "manual-review",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertReviewFocusOutputPath(filePath, packageRoot) {
  const root = path.join(packageRoot, ".work", "review-focus", "eligibility-50");
  if (!isWithin(filePath, root)) throw new Error(`Focused review output must remain under ${root}: ${filePath}`);
  return filePath;
}

function stateRecords(state) {
  return Object.values(state.entries ?? {})
    .filter((record) => record.variantName === "primary")
    .sort(compareEntities);
}

function stableKeyOrder(left, right) {
  return compareEntities(left, right);
}

function normalisedName(value) {
  return String(value).normalize("NFC").trim().toLocaleLowerCase("en");
}

export function resolveContrastCandidates(records, newStableKeys, definitions = CONTRAST_DEFINITIONS) {
  const newKeys = new Set(newStableKeys);
  const resolved = [];
  for (const [definitionIndex, definition] of definitions.entries()) {
    const expectedNames = definition.names.map((name) => definition.caseInsensitive ? normalisedName(name) : name);
    const matches = records.filter((record) => {
      const candidate = definition.caseInsensitive ? normalisedName(record.name) : record.name;
      return expectedNames.includes(candidate) && (definition.expected !== "all-new" || newKeys.has(record.stableKey));
    }).sort(stableKeyOrder);
    if (!matches.length) throw new Error(`Could not resolve focused contrast candidate ${definition.requestedName}.`);
    if (definition.expected === "single" && matches.length !== 1) {
      throw new Error(`Expected one ${definition.requestedName} record, found ${matches.map((item) => item.stableKey).join(", ")}.`);
    }
    for (const record of matches) {
      const exact = record.name === definition.requestedName;
      resolved.push({
        ...record,
        requestedName: definition.requestedName,
        contrastCategory: definition.category,
        resolutionKind: exact ? "exact-name" : definition.caseInsensitive && normalisedName(record.name) === normalisedName(definition.requestedName)
          ? "case-insensitive-exact-name"
          : "canonical-alias",
        definitionIndex,
        isEligibility50New: newKeys.has(record.stableKey),
        recommendation: definition.recommendation,
        recommendationRationale: definition.rationale,
      });
    }
  }
  const seen = new Set();
  for (const record of resolved) {
    if (seen.has(record.stableKey)) throw new Error(`Contrast candidate ${record.stableKey} resolved more than once.`);
    seen.add(record.stableKey);
  }
  return resolved;
}

export function orderFocusedItems(items, variantOrder = CONTRAST_VARIANTS) {
  const variantIndex = new Map(variantOrder.map((variant, index) => [variant, index]));
  return [...items].sort((left, right) =>
    (left.focusOrder ?? 0) - (right.focusOrder ?? 0) ||
    stableKeyOrder(left, right) ||
    (variantIndex.get(left.variantName) ?? Number.MAX_SAFE_INTEGER) - (variantIndex.get(right.variantName) ?? Number.MAX_SAFE_INTEGER) ||
    String(left.variantName ?? "").localeCompare(String(right.variantName ?? "")),
  );
}

function rounded(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function contrastRecommendation(record) {
  return record.recommendation ?? "manual-review";
}

function contrastCandidateJson(record) {
  return {
    requestedName: record.requestedName,
    resolutionKind: record.resolutionKind,
    isEligibility50New: record.isEligibility50New,
    stableKey: record.stableKey,
    entityType: record.entityType,
    tmdbId: record.tmdbId,
    canonicalName: record.name,
    currentBackground: record.selectedBackground,
    sourceLogoPath: record.logoPath,
    sourceLogoHash: record.sourceHash,
    currentOutputHash: record.outputHash,
    currentReviewReasons: record.reviewReasons ?? [],
    contrastMetrics: record.mixedContrastMetrics ?? {
      dark: record.contrastDetails?.dark ?? null,
      light: record.contrastDetails?.light ?? null,
    },
    contrastConfidence: record.contrastConfidence,
    hashBoundManualDecision: record.manualBackgroundDecision?.status === "applied"
      ? {
          background: record.manualBackgroundDecision.configuredBackground,
          sourceLogoHash: record.manualBackgroundDecision.configuredSourceLogoHash,
        }
      : null,
    recommendation: contrastRecommendation(record),
    recommendationRationale: record.recommendationRationale,
  };
}

function metricLabel(record, background) {
  const metric = record.mixedContrastMetrics?.[background];
  if (!metric) return `${background} metrics unavailable`;
  return `${background} agg ${metric.aggregateScore.toFixed(2)} · p10 ${metric.p10.toFixed(2)} · >=3 ${Math.round(metric.atOrAbove3 * 100)}%`;
}

async function prepareContrastComparisons(candidates, preset, focusRoot) {
  const items = [];
  const variantRoot = path.join(focusRoot, "variants", "contrast");
  for (const record of candidates) {
    if (!record.sourcePath) throw new Error(`Missing cached source path for ${record.stableKey}.`);
    const sourceBuffer = await fs.readFile(record.sourcePath);
    if (bufferFingerprint(sourceBuffer) !== record.sourceHash) throw new Error(`Cached source hash changed for ${record.stableKey}.`);
    const analysis = await analyseLogo(record.sourcePath, preset);
    if (analysis.normalisedPixelHash !== record.normalisedPixelHash) throw new Error(`Cached source pixels changed for ${record.stableKey}.`);
    for (const variantName of CONTRAST_VARIANTS) {
      const background = variantName === "current" ? record.selectedBackground : variantName === "forced-light" ? "light" : "dark";
      const safeKey = record.stableKey.replace(":", "-");
      const outputPath = assertReviewFocusOutputPath(path.join(variantRoot, `${safeKey}-${variantName}.webp`), path.dirname(path.dirname(path.dirname(focusRoot))));
      let buffer;
      if (variantName === "current") {
        buffer = await fs.readFile(record.outputPath);
        if (bufferFingerprint(buffer) !== record.outputHash) throw new Error(`Current staged hash changed for ${record.stableKey}.`);
      } else {
        buffer = (await renderLogoCover(analysis, preset, { selectedBackground: background })).buffer;
      }
      await atomicWrite(outputPath, buffer);
      items.push({
        ...record,
        focusOrder: record.definitionIndex,
        variantName,
        outputPath,
        backgroundPreset: `${background}-flat`,
        renderStatus: "experimental",
        contactSheetLabelLines: [
          record.name,
          `${record.stableKey} · current ${record.selectedBackground} · variant ${background}`,
          metricLabel(record, background),
          `Reasons: ${(record.reviewReasons ?? []).join(", ") || "none"}`,
          `Recommendation: ${contrastRecommendation(record)}`,
        ],
      });
    }
  }
  const outputPath = path.join(focusRoot, "contrast-comparisons.png");
  const sheet = await createContactSheet(orderFocusedItems(items), outputPath, {
    columns: 3,
    thumbnailWidth: 360,
    thumbnailHeight: 203,
    labelHeight: 112,
    gap: 16,
    margin: 40,
  });
  return { sheet, items };
}

function contrastMarkdown(candidates) {
  const rows = candidates.map((record) => {
    const manual = record.hashBoundManualDecision ? `${record.hashBoundManualDecision.background} (${record.hashBoundManualDecision.sourceLogoHash})` : "no";
    const reasons = record.currentReviewReasons.join(", ") || "none";
    const dark = record.contrastMetrics.dark;
    const light = record.contrastMetrics.light;
    return `| ${record.canonicalName} | \`${record.stableKey}\` | ${record.currentBackground} | ${rounded(dark?.aggregateScore, 3)} / ${rounded(dark?.p10, 3)} | ${rounded(light?.aggregateScore, 3)} / ${rounded(light?.p10, 3)} | ${reasons} | ${manual} | **${record.recommendation}** — ${record.recommendationRationale} |`;
  }).join("\n");
  return `# Eligibility-50 contrast candidates\n\nThese are offline comparisons only. No production background decision was changed.\n\n| Canonical name | Stable key | Current | Dark aggregate / p10 | Light aggregate / p10 | Current reasons | Hash-bound manual decision | Recommendation |\n|---|---|---:|---:|---:|---|---|---|\n${rows}\n`;
}

function rgbHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function rgbDistance(left, right) {
  return Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2);
}

export function classifyOpaqueMetrics(metrics) {
  const uniformEdge = metrics.edgeColourStandardDeviation <= 22;
  const blends = uniformEdge && metrics.edgeToCoverBackgroundDistance <= 30;
  const tinyArtwork = uniformEdge && metrics.foregroundPixelProportion <= 0.12 && metrics.foregroundBoundsAreaProportion <= 0.30;
  if (blends) return "opaque-blends-with-background";
  if (tinyArtwork && metrics.edgeToCoverBackgroundDistance > 30) return "tiny-logo-inside-opaque-canvas";
  if (uniformEdge && metrics.edgeToCoverBackgroundDistance > 30) return "opaque-sticker-effect";
  if (metrics.edgeColourStandardDeviation >= 32 || metrics.foregroundPixelProportion >= 0.28) return "opaque-suitable";
  return "manual-review";
}

export async function calculateOpaqueMetrics(record, preset) {
  const result = await sharp(record.sourcePath, { failOn: "error" }).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = result.info;
  if (channels !== 4) throw new Error(`Expected RGBA source for ${record.stableKey}.`);
  const edgePixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const index = (y * width + x) * 4;
      if (result.data[index + 3] < 250) continue;
      edgePixels.push({ r: result.data[index], g: result.data[index + 1], b: result.data[index + 2] });
    }
  }
  if (!edgePixels.length) throw new Error(`Opaque record ${record.stableKey} has no opaque edge pixels.`);
  const edgeMean = edgePixels.reduce((sum, pixel) => ({ r: sum.r + pixel.r, g: sum.g + pixel.g, b: sum.b + pixel.b }), { r: 0, g: 0, b: 0 });
  edgeMean.r /= edgePixels.length;
  edgeMean.g /= edgePixels.length;
  edgeMean.b /= edgePixels.length;
  const edgeVariance = edgePixels.reduce((sum, pixel) => sum + rgbDistance(pixel, edgeMean) ** 2, 0) / edgePixels.length;
  const edgeColourStandardDeviation = Math.sqrt(edgeVariance);
  const foregroundThreshold = Math.max(30, edgeColourStandardDeviation * 2.5);
  let foregroundPixels = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (result.data[index + 3] < preset.logo.visibleAlphaThreshold) continue;
      const pixel = { r: result.data[index], g: result.data[index + 1], b: result.data[index + 2] };
      if (rgbDistance(pixel, edgeMean) <= foregroundThreshold) continue;
      foregroundPixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const foregroundBoundsArea = right >= left && bottom >= top ? (right - left + 1) * (bottom - top + 1) : 0;
  const background = parseHexColour(preset.backgrounds[record.selectedBackground]);
  const metrics = {
    outerEdgeColour: rgbHex(edgeMean),
    edgeColourStandardDeviation: rounded(edgeColourStandardDeviation, 3),
    edgeToCoverBackgroundDistance: rounded(rgbDistance(edgeMean, background), 3),
    edgeOpaqueProportion: rounded(record.opaqueEdgeProportion, 6),
    visibleArtworkProportion: rounded(record.visibleAreaProportion, 6),
    foregroundPixelProportion: rounded(foregroundPixels / (width * height), 6),
    foregroundBoundsAreaProportion: rounded(foregroundBoundsArea / (width * height), 6),
    foregroundDifferenceThreshold: rounded(foregroundThreshold, 3),
  };
  return { ...metrics, classification: classifyOpaqueMetrics(metrics) };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function opaqueCsv(records) {
  const fields = [
    "stableKey", "entityType", "tmdbId", "name", "classification", "selectedBackground", "outerEdgeColour",
    "edgeColourStandardDeviation", "edgeToCoverBackgroundDistance", "edgeOpaqueProportion", "visibleArtworkProportion",
    "foregroundPixelProportion", "foregroundBoundsAreaProportion", "sourceWidth", "sourceHeight", "visibleLeft", "visibleTop",
    "visibleWidth", "visibleHeight", "sourceLogoHash", "outputHash", "reviewReasons",
  ];
  const rows = records.map((record) => ({
    ...record,
    visibleLeft: record.visibleBounds.left,
    visibleTop: record.visibleBounds.top,
    reviewReasons: record.currentReviewReasons,
  }));
  return `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")).join("\n")}\n`;
}

async function prepareOpaqueReview(records, preset, focusRoot) {
  const classified = [];
  for (const record of records) {
    const sourceBuffer = await fs.readFile(record.sourcePath);
    if (bufferFingerprint(sourceBuffer) !== record.sourceHash) throw new Error(`Cached source hash changed for ${record.stableKey}.`);
    const metrics = await calculateOpaqueMetrics(record, preset);
    classified.push({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.name,
      selectedBackground: record.selectedBackground,
      sourceWidth: record.sourceWidth,
      sourceHeight: record.sourceHeight,
      visibleBounds: record.visibleBounds,
      sourceLogoPath: record.logoPath,
      sourceLogoHash: record.sourceHash,
      outputHash: record.outputHash,
      outputPath: record.outputPath,
      currentReviewReasons: record.reviewReasons ?? [],
      ...metrics,
    });
  }
  classified.sort(stableKeyOrder);
  const counts = Object.fromEntries(["opaque-suitable", "opaque-blends-with-background", "opaque-sticker-effect", "tiny-logo-inside-opaque-canvas", "manual-review"]
    .map((classification) => [classification, classified.filter((record) => record.classification === classification).length]));
  const summary = {
    version: "eligibility-50-opaque-summary-v1",
    population: classified.length,
    counts,
    thresholds: {
      uniformEdgeStandardDeviationMaximum: 22,
      blendsWithBackgroundDistanceMaximum: 30,
      tinyForegroundPixelProportionMaximum: 0.12,
      tinyForegroundBoundsAreaProportionMaximum: 0.30,
      suitableEdgeStandardDeviationMinimum: 32,
      suitableForegroundPixelProportionMinimum: 0.28,
    },
    records: classified,
  };
  const problem = classified.filter((record) => ["opaque-sticker-effect", "tiny-logo-inside-opaque-canvas", "manual-review"].includes(record.classification));
  const sheetItems = problem.map((record) => ({
    ...record,
    renderStatus: "inspection",
    backgroundPreset: `${record.selectedBackground}-flat`,
    contactSheetLabelLines: [
      record.name,
      `${record.stableKey} · ${record.classification}`,
      `edge ${record.outerEdgeColour} · σ ${record.edgeColourStandardDeviation} · Δbg ${record.edgeToCoverBackgroundDistance}`,
      `foreground ${Math.round(record.foregroundPixelProportion * 100)}% · bounds ${Math.round(record.foregroundBoundsAreaProportion * 100)}%`,
    ],
  }));
  const sheetPath = path.join(focusRoot, "opaque-problem-candidates.png");
  const sheet = await createContactSheet(sheetItems, sheetPath, {
    columns: 4,
    thumbnailWidth: 300,
    thumbnailHeight: 169,
    labelHeight: 96,
    gap: 16,
    margin: 40,
  });
  await Promise.all([
    atomicWriteJson(path.join(focusRoot, "opaque-summary.json"), summary),
    atomicWrite(path.join(focusRoot, "opaque-summary.csv"), opaqueCsv(classified)),
  ]);
  return { summary, classified, problem, sheet };
}

function sampleCategory(record) {
  const categories = [];
  const layout = record.fallbackTextLayout ?? {};
  if (layout.lineCount === 1) categories.push("one-line");
  if (layout.lineCount === 2) categories.push("two-line");
  if (/[^\u0000-\u007f]/u.test(record.name)) categories.push("accented-characters");
  if (/[^\p{L}\p{N}\s]/u.test(record.name)) categories.push("punctuation");
  if (/\b(university|universidad|université|universita|uniwersytet|institute|instituto|association|society|department|division|foundation|academy|commission|ministry|corporation|office|agency|council|museum|centre|center|education)\b/iu.test(record.name)) categories.push("institutional-name");
  return categories;
}

export function selectFallbackRepresentatives(records, target = 22) {
  if (!Number.isSafeInteger(target) || target < 1) throw new Error("Fallback sample target must be a positive integer.");
  const ordered = [...records].sort(stableKeyOrder);
  const selected = new Map();
  const add = (record, reason) => {
    if (!record) return;
    const existing = selected.get(record.stableKey) ?? { ...record, sampleReasons: [] };
    if (!existing.sampleReasons.includes(reason)) existing.sampleReasons.push(reason);
    selected.set(record.stableKey, existing);
  };
  const take = (items, count, reason) => items.slice(0, count).forEach((record) => add(record, reason));
  take([...ordered].sort((a, b) => a.name.length - b.name.length || stableKeyOrder(a, b)), 3, "shortest-name");
  take([...ordered].sort((a, b) => b.name.length - a.name.length || stableKeyOrder(a, b)), 4, "longest-name");
  take(ordered.filter((record) => record.fallbackTextLayout?.lineCount === 1), 3, "one-line-layout");
  take(ordered.filter((record) => record.fallbackTextLayout?.lineCount === 2), 4, "two-line-layout");
  take(ordered.filter((record) => /[^\u0000-\u007f]/u.test(record.name)), 3, "accented-characters");
  take(ordered.filter((record) => /[^\p{L}\p{N}\s]/u.test(record.name)), 3, "punctuation");
  take(ordered.filter((record) => sampleCategory(record).includes("institutional-name")), 3, "institutional-name");
  take([...ordered].sort((a, b) => (a.fallbackFontSize ?? 999) - (b.fallbackFontSize ?? 999) || b.name.length - a.name.length || stableKeyOrder(a, b)), 4, "near-minimum-font-size");
  take(ordered.filter((record) => record.entityType === "network"), 1, "network-record-where-available");
  for (const record of ordered) {
    if (selected.size >= target) break;
    add(record, "deterministic-coverage-fill");
  }
  return [...selected.values()].sort(stableKeyOrder).slice(0, target).map((record) => ({
    ...record,
    sampleCategories: [...new Set([...record.sampleReasons, ...sampleCategory(record)])].sort(),
  }));
}

async function prepareFallbackReview(records, focusRoot) {
  const allInter = records.every((record) => record.fallbackTextLayout?.fontFamily === "Inter");
  const allOneOrTwoLines = records.every((record) => [1, 2].includes(record.fallbackTextLayout?.lineCount));
  if (!allInter) throw new Error("At least one eligibility-50 fallback does not report Inter.");
  if (!allOneOrTwoLines) throw new Error("At least one eligibility-50 fallback is not one or two lines.");
  const selected = selectFallbackRepresentatives(records, 22);
  const sheetItems = selected.map((record) => ({
    ...record,
    contactSheetLabelLines: [
      record.name,
      record.stableKey,
      `${record.fallbackTextLayout.fontFamily} · ${record.fallbackTextLayout.fontSize}px · ${record.fallbackTextLayout.lineCount} line(s)`,
      `Lines: ${record.fallbackTextLayout.wrappedTextLines.join(" / ")}`,
      `Sample: ${record.sampleCategories.join(", ")}`,
    ],
  }));
  const sheetPath = path.join(focusRoot, "fallback-spot-check.png");
  const sheet = await createContactSheet(sheetItems, sheetPath, {
    columns: 4,
    thumbnailWidth: 320,
    thumbnailHeight: 180,
    labelHeight: 116,
    gap: 16,
    margin: 40,
  });
  const summary = {
    version: "eligibility-50-fallback-spot-check-v1",
    population: records.length,
    selectedCount: selected.length,
    allReportConfirmedInter: allInter,
    allOneOrTwoLines,
    networksAvailable: records.some((record) => record.entityType === "network"),
    minimumFontSizeObserved: Math.min(...records.map((record) => record.fallbackTextLayout.fontSize)),
    recommendation: "safe-for-reason-level-batch-approval-subject-to-owner-spot-check",
    selected: selected.map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      name: record.name,
      outputHash: record.outputHash,
      fontFamily: record.fallbackTextLayout.fontFamily,
      fontSize: record.fallbackTextLayout.fontSize,
      lineCount: record.fallbackTextLayout.lineCount,
      wrappedLines: record.fallbackTextLayout.wrappedTextLines,
      sampleCategories: record.sampleCategories,
    })),
  };
  await atomicWriteJson(path.join(focusRoot, "fallback-spot-check.json"), summary);
  return { summary, selected, sheet };
}

function resolutionRecommendation(record) {
  if (RESOLUTION_VISUAL_FINDINGS.has(record.stableKey)) return "acceptable-as-is";
  if (record.reviewReasons?.includes("likely-low-resolution-source")) return "needs-better-source";
  if (record.upscaleFactor <= 2.25) return "acceptable-as-is";
  return "manual-review";
}

async function prepareResolutionReview(records, preset, focusRoot) {
  const items = [];
  const detailRoot = path.join(focusRoot, "variants", "resolution-detail");
  for (const record of records) {
    const label = [
      record.name,
      `${record.stableKey} · source ${record.sourceWidth}×${record.sourceHeight} · visible ${record.visibleWidth}×${record.visibleHeight}`,
      `upscale ${record.upscaleFactor.toFixed(2)}× · output ${record.outputBytes} bytes · ${record.renderedVisibleWidth}×${record.renderedVisibleHeight}`,
      `Reasons: ${(record.reviewReasons ?? []).join(", ")}`,
      `Recommendation: ${resolutionRecommendation(record)}`,
    ];
    items.push({ ...record, variantName: "final-cover", focusOrder: record.tmdbId, contactSheetLabelLines: [...label.slice(0, 2), "final staged cover", ...label.slice(2)] });
    const analysis = await analyseLogo(record.sourcePath, preset);
    const detailPreset = {
      ...preset,
      logo: { ...preset.logo, maximumVisibleWidthPercent: 92, maximumVisibleHeightPercent: 84 },
    };
    const detail = await renderLogoCover(analysis, detailPreset, { selectedBackground: record.selectedBackground });
    const outputPath = path.join(detailRoot, `${record.stableKey.replace(":", "-")}-detail.webp`);
    await atomicWrite(outputPath, detail.buffer);
    items.push({
      ...record,
      variantName: "source-detail",
      focusOrder: record.tmdbId,
      outputPath,
      contactSheetLabelLines: [...label.slice(0, 2), "enlarged visible-logo detail", ...label.slice(2)],
    });
  }
  const ordered = orderFocusedItems(items, ["final-cover", "source-detail"]);
  const sheetPath = path.join(focusRoot, "upscale-and-resolution.png");
  const sheet = await createContactSheet(ordered, sheetPath, {
    columns: 2,
    thumbnailWidth: 480,
    thumbnailHeight: 270,
    labelHeight: 124,
    gap: 18,
    margin: 40,
  });
  const findings = records.map((record) => ({
    stableKey: record.stableKey,
    name: record.name,
    sourceDimensions: { width: record.sourceWidth, height: record.sourceHeight },
    visibleDimensions: { width: record.visibleWidth, height: record.visibleHeight },
    upscaleFactor: record.upscaleFactor,
    outputBytes: record.outputBytes,
    reviewReasons: record.reviewReasons ?? [],
    recommendation: resolutionRecommendation(record),
    recommendationRationale: RESOLUTION_VISUAL_FINDINGS.get(record.stableKey) ?? null,
    outputHash: record.outputHash,
  }));
  await atomicWriteJson(path.join(focusRoot, "upscale-and-resolution.json"), { records: findings });
  return { findings, sheet };
}

function reasonAction(record, reviewReason, action, extra = {}) {
  if (!HASH_PATTERN.test(record.outputHash ?? "")) throw new Error(`Invalid output hash for proposed action ${record.stableKey}.`);
  const currentReviewReasons = [...new Set(record.reviewReasons ?? record.currentReviewReasons ?? [])].sort();
  return {
    stableKey: record.stableKey,
    entityType: record.entityType,
    tmdbId: record.tmdbId,
    name: record.name,
    action,
    scope: "reason-level",
    reviewReason,
    outputHash: record.outputHash,
    currentReviewReasons,
    unresolvedAfterProposedAction: currentReviewReasons.filter((reason) => reason !== reviewReason),
    ...extra,
  };
}

function mergeManualActions(actions) {
  const byKey = new Map();
  for (const action of actions) {
    const existing = byKey.get(action.stableKey);
    if (!existing) {
      byKey.set(action.stableKey, { ...action, concerns: [action.concern] });
      continue;
    }
    if (!existing.concerns.includes(action.concern)) existing.concerns.push(action.concern);
    existing.currentReviewReasons = [...new Set([...existing.currentReviewReasons, ...action.currentReviewReasons])].sort();
  }
  return [...byKey.values()].sort(stableKeyOrder).map(({ concern: _concern, ...action }) => action);
}

export function buildProposedReviewActions({ fallbacks, opaque, contrast, resolution }) {
  const groups = Object.fromEntries(ACTION_GROUPS.map((group) => [group, []]));
  groups["safe-fallback-batch-approval"] = fallbacks.map((record) => reasonAction(
    record,
    "missing-logo-text-fallback",
    "approve-current-reason",
    { invalidatesWhen: "output-hash-changes" },
  )).sort(stableKeyOrder);
  groups["safe-opaque-batch-approval"] = opaque
    .filter((record) => ["opaque-suitable", "opaque-blends-with-background"].includes(record.classification))
    .map((record) => reasonAction(record, "unexpectedly-opaque-source-background", "approve-current-reason", {
      sourceLogoHash: record.sourceLogoHash,
      classification: record.classification,
      invalidatesWhen: "output-hash-or-source-logo-hash-changes",
    })).sort(stableKeyOrder);
  groups["contrast-switch-candidates"] = contrast
    .filter((record) => record.recommendation === "switch-light")
    .map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.canonicalName,
      action: "propose-background-light",
      scope: "background-decision-only",
      proposedBackground: "light",
      currentBackground: record.currentBackground,
      outputHash: record.currentOutputHash,
      sourceLogoHash: record.sourceLogoHash,
      currentReviewReasons: record.currentReviewReasons,
      unresolvedAfterProposedAction: record.currentReviewReasons,
      invalidatesWhen: "source-logo-hash-changes",
    })).sort(stableKeyOrder);
  groups["contrast-retain-candidates"] = contrast
    .filter((record) => record.recommendation === "retain-current")
    .map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.canonicalName,
      action: "retain-current-background",
      scope: "background-decision-only",
      currentBackground: record.currentBackground,
      outputHash: record.currentOutputHash,
      sourceLogoHash: record.sourceLogoHash,
      currentReviewReasons: record.currentReviewReasons,
      unresolvedAfterProposedAction: record.currentReviewReasons,
      invalidatesWhen: "source-logo-hash-changes",
    })).sort(stableKeyOrder);
  groups["upscale-acceptable"] = resolution
    .filter((record) => record.recommendation === "acceptable-as-is")
    .map((record) => reasonAction(
      record,
      record.reviewReasons?.includes("high-upscale-factor") ? "high-upscale-factor" : "likely-low-resolution-source",
      "approve-current-reason",
      { invalidatesWhen: "output-hash-changes", rationale: record.recommendationRationale },
    ))
    .sort(stableKeyOrder);
  groups["needs-better-source"] = resolution
    .filter((record) => record.recommendation === "needs-better-source")
    .map((record) => reasonAction(record, "likely-low-resolution-source", "seek-better-source", { invalidatesWhen: "source-logo-hash-changes" }))
    .sort(stableKeyOrder);
  const manual = [
    ...contrast.filter((record) => record.recommendation === "manual-review").map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.canonicalName,
      action: "manual-review",
      scope: "no-approval-proposed",
      concern: "contrast",
      outputHash: record.currentOutputHash,
      sourceLogoHash: record.sourceLogoHash,
      currentReviewReasons: record.currentReviewReasons,
      unresolvedAfterProposedAction: record.currentReviewReasons,
    })),
    ...opaque.filter((record) => ["opaque-sticker-effect", "tiny-logo-inside-opaque-canvas", "manual-review"].includes(record.classification)).map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.name,
      action: "manual-review",
      scope: "no-approval-proposed",
      concern: record.classification,
      outputHash: record.outputHash,
      sourceLogoHash: record.sourceLogoHash,
      currentReviewReasons: record.currentReviewReasons,
      unresolvedAfterProposedAction: record.currentReviewReasons,
    })),
    ...resolution.filter((record) => record.recommendation === "manual-review").map((record) => ({
      stableKey: record.stableKey,
      entityType: record.entityType,
      tmdbId: record.tmdbId,
      name: record.name,
      action: "manual-review",
      scope: "no-approval-proposed",
      concern: "upscale-quality",
      outputHash: record.outputHash,
      sourceLogoHash: record.sourceHash,
      currentReviewReasons: record.reviewReasons,
      unresolvedAfterProposedAction: record.reviewReasons,
    })),
  ];
  groups["manual-review"] = mergeManualActions(manual);
  for (const entries of Object.values(groups)) {
    for (const entry of entries) {
      if (!HASH_PATTERN.test(entry.outputHash ?? "")) throw new Error(`Proposed action for ${entry.stableKey} is not output-hash-bound.`);
    }
  }
  return {
    version: "eligibility-50-proposed-review-actions-v1",
    status: "proposal-only",
    approvalStateModified: false,
    bindingPolicy: {
      everyProposalBindsCurrentOutputHash: true,
      backgroundAndOpaqueProposalsAlsoBindSourceLogoHash: true,
      fallbackApprovalInvalidatesOnOutputHashChange: true,
      sourceLogoChangeInvalidatesBackgroundAndOpaqueResolution: true,
      independentReasonsRemainUnresolvedUnlessNamedByAReasonLevelAction: true,
    },
    counts: Object.fromEntries(Object.entries(groups).map(([group, entries]) => [group, entries.length])),
    groups,
  };
}

function actionsMarkdown(actions) {
  const sections = ACTION_GROUPS.map((group) => {
    const entries = actions.groups[group];
    return `## ${group} (${entries.length})\n\n${entries.length ? entries.map((entry) => `- \`${entry.stableKey}\` — ${entry.name}; ${entry.action}; output \`${entry.outputHash}\`${entry.sourceLogoHash ? `; source \`${entry.sourceLogoHash}\`` : ""}${entry.unresolvedAfterProposedAction?.length ? `; remains: ${entry.unresolvedAfterProposedAction.join(", ")}` : ""}`).join("\n") : "None."}`;
  }).join("\n\n");
  return `# Proposed eligibility-50 review actions\n\nProposal only. No review state was modified. Every action is bound to the current staged output hash; source-sensitive actions also bind the current source-logo hash.\n\n${sections}\n`;
}

async function protectedState(packageRoot, presetVersion) {
  const stagingRoot = path.join(packageRoot, ".work", "staging", presetVersion);
  const draftPath = path.join(packageRoot, ".work", "reviews", presetVersion, "review-state-draft.json");
  const checklistPath = path.join(packageRoot, ".work", "reviews", presetVersion, "review-checklist.csv");
  const [staging, reviewStateDraftHash, reviewChecklistHash] = await Promise.all([
    snapshotProductionDirectory(stagingRoot),
    hashFile(draftPath),
    hashFile(checklistPath),
  ]);
  return {
    stagedFileCount: staging.count,
    stagedContentFingerprint: staging.combinedFingerprint,
    stagedModificationTimeFingerprint: staging.mtimeFingerprint,
    reviewStateDraftHash,
    reviewChecklistHash,
  };
}

function equalProtectedState(before, after) {
  return Object.keys(before).every((key) => before[key] === after[key]);
}

export async function runEligibility50ReviewFocus({ packageRoot, presetName = "production-v1" } = {}) {
  if (!packageRoot) throw new Error("packageRoot is required.");
  const focusRoot = path.join(packageRoot, ".work", "review-focus", "eligibility-50");
  assertReviewFocusOutputPath(focusRoot, packageRoot);
  const paths = {
    preset: path.join(packageRoot, "presets", `${presetName}.json`),
    state: path.join(packageRoot, ".work", "reports", presetName, "run-state.json"),
    newKeys: path.join(packageRoot, ".work", "plans", "eligibility-50", "new-all.json"),
  };
  const [preset, state, newKeys] = await Promise.all(Object.values(paths).map((filePath) => fs.readFile(filePath, "utf8").then(JSON.parse)));
  const before = await protectedState(packageRoot, presetName);
  const records = stateRecords(state);
  const newKeySet = new Set(newKeys);
  if (records.length !== before.stagedFileCount) throw new Error(`State/staging mismatch: ${records.length} records vs ${before.stagedFileCount} files.`);
  const contrastRecords = resolveContrastCandidates(records, newKeys);
  const newRecords = records.filter((record) => newKeySet.has(record.stableKey));
  const fallbacks = newRecords.filter((record) => (record.renderStatus ?? record.status) === "missing-logo");
  const opaqueRecords = newRecords.filter((record) => record.reviewReasons?.includes("unexpectedly-opaque-source-background"));
  const resolutionRecords = newRecords.filter((record) => record.upscaleFactor > preset.logo.highUpscaleReviewThreshold || record.reviewReasons?.includes("likely-low-resolution-source"));
  if (fallbacks.length !== 332 || opaqueRecords.length !== 99 || resolutionRecords.filter((record) => record.upscaleFactor > preset.logo.highUpscaleReviewThreshold).length !== 7 || resolutionRecords.filter((record) => record.reviewReasons?.includes("likely-low-resolution-source")).length !== 2) {
    throw new Error(`Unexpected eligibility-50 focus counts: fallbacks=${fallbacks.length}, opaque=${opaqueRecords.length}, upscale=${resolutionRecords.filter((record) => record.upscaleFactor > preset.logo.highUpscaleReviewThreshold).length}, lowResolution=${resolutionRecords.filter((record) => record.reviewReasons?.includes("likely-low-resolution-source")).length}.`);
  }
  const contrastJson = contrastRecords.map(contrastCandidateJson);
  const [contrastResult, fallbackResult, opaqueResult, resolutionResult] = await Promise.all([
    prepareContrastComparisons(contrastRecords, preset, focusRoot),
    prepareFallbackReview(fallbacks, focusRoot),
    prepareOpaqueReview(opaqueRecords, preset, focusRoot),
    prepareResolutionReview(resolutionRecords, preset, focusRoot),
  ]);
  const actions = buildProposedReviewActions({
    fallbacks,
    opaque: opaqueResult.classified,
    contrast: contrastJson,
    resolution: resolutionResult.findings.map((finding) => ({ ...records.find((record) => record.stableKey === finding.stableKey), ...finding })),
  });
  await Promise.all([
    atomicWriteJson(path.join(focusRoot, "contrast-candidates.json"), { version: "eligibility-50-contrast-candidates-v1", records: contrastJson }),
    atomicWrite(path.join(focusRoot, "contrast-candidates.md"), contrastMarkdown(contrastJson)),
    atomicWriteJson(path.join(focusRoot, "proposed-review-actions.json"), actions),
    atomicWrite(path.join(focusRoot, "proposed-review-actions.md"), actionsMarkdown(actions)),
  ]);
  const after = await protectedState(packageRoot, presetName);
  if (!equalProtectedState(before, after)) throw new Error("Production staging or review state changed during focused review preparation.");
  const preservation = {
    version: "eligibility-50-review-focus-preservation-v1",
    before,
    after,
    unchanged: true,
    productionCoversRegenerated: 0,
    stagedOutputsOverwritten: 0,
    reviewEntriesApproved: 0,
    networkRequestsMade: 0,
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
  };
  await atomicWriteJson(path.join(focusRoot, "preservation-verification.json"), preservation);
  return {
    focusRoot,
    contrastCandidates: contrastJson,
    contrastSheet: contrastResult.sheet,
    fallback: fallbackResult,
    opaque: opaqueResult.summary,
    opaqueSheet: opaqueResult.sheet,
    resolution: resolutionResult,
    actions,
    preservation,
  };
}

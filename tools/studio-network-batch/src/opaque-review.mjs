import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { compareEntities } from "./constants.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";
import { calculateOpaqueMetrics } from "./review-focus.mjs";
import { snapshotProductionDirectory } from "./staging-snapshot.mjs";

export const OPAQUE_REVIEW_REASON = "unexpectedly-opaque-source-background";
export const OPAQUE_CLASSIFICATION_ORDER = [
  "tiny-logo-inside-opaque-canvas",
  "opaque-sticker-effect",
  "manual-review",
  "opaque-blends-with-background",
  "opaque-suitable",
];

const PAGE_COLUMNS = 4;
const PAGE_ROWS = 4;
const PAGE_SIZE = PAGE_COLUMNS * PAGE_ROWS;
const TILE_WIDTH = 520;
const COVER_HEIGHT = 293;
const DETAIL_HEIGHT = 220;
const TILE_HEIGHT = COVER_HEIGHT + DETAIL_HEIGHT;
const PAGE_GAP = 18;
const PAGE_MARGIN = 32;
const VERY_SMALL_FOREGROUND_PROPORTION = 0.12;
const CLOSE_EDGE_DISTANCE = 30;

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertOpaqueReviewOutputPath(filePath, packageRoot) {
  const root = path.join(packageRoot, ".work", "review-focus", "opaque-final");
  if (!isWithin(filePath, root)) {
    throw new Error("Opaque review output must remain under " + root + ": " + filePath);
  }
  return filePath;
}

function classificationRank(value) {
  const index = OPAQUE_CLASSIFICATION_ORDER.indexOf(value);
  return index === -1 ? OPAQUE_CLASSIFICATION_ORDER.length : index;
}

export function selectUnresolvedOpaqueRecords(records) {
  const selected = records.filter((record) =>
    record.variantName === "primary" && record.reviewReasons?.includes(OPAQUE_REVIEW_REASON),
  );
  const seen = new Set();
  for (const record of selected) {
    if (seen.has(record.stableKey)) throw new Error("Duplicate unresolved opaque stable key: " + record.stableKey);
    seen.add(record.stableKey);
  }
  return selected.sort(compareEntities);
}

export function orderOpaqueReviewRecords(records) {
  return [...records].sort((left, right) =>
    classificationRank(left.classification) - classificationRank(right.classification)
    || compareEntities(left, right),
  );
}

export function paginateOpaqueReviewRecords(records, { pageSize = PAGE_SIZE } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Opaque review page size must be a positive integer.");
  }
  const ordered = orderOpaqueReviewRecords(records);
  const pages = [];
  for (let index = 0; index < ordered.length; index += pageSize) {
    pages.push(ordered.slice(index, index + pageSize));
  }
  return pages;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function opaqueReviewTemplateCsv(records) {
  const fields = [
    "stable_key",
    "name",
    "classification",
    "current_background",
    "output_hash",
    "other_unresolved_reasons",
    "owner_decision",
    "owner_note",
  ];
  const rows = orderOpaqueReviewRecords(records).map((record) => [
    record.stableKey,
    record.name,
    record.classification,
    record.currentBackground,
    record.outputHash,
    record.otherUnresolvedReasons,
    "",
    "",
  ]);
  return [fields, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(value, maximum) {
  const text = String(value);
  return text.length <= maximum ? text : text.slice(0, maximum - 1) + "…";
}

function percentage(value, digits = 1) {
  return Number.isFinite(value) ? (value * 100).toFixed(digits) + "%" : "n/a";
}

export function sourceEdgeDescription(record) {
  const variation = record.edgeColourStandardDeviation <= 22
    ? "uniform"
    : record.edgeColourStandardDeviation >= 32
      ? "varied"
      : "moderately varied";
  const match = record.edgeToCoverBackgroundDistance <= CLOSE_EDGE_DISTANCE
    ? "closely matches"
    : "differs from";
  return variation + " " + record.outerEdgeColour + " edge; " + match + " "
    + record.currentBackground + " cover (distance " + record.edgeToCoverBackgroundDistance + ")";
}

function detailTextSvg(record) {
  const other = record.otherUnresolvedReasons.length ? record.otherUnresolvedReasons.join(", ") : "none";
  const lines = [
    { text: truncate(record.name, 54), y: 26, size: 18, colour: "#FFFFFF", weight: 650 },
    { text: record.stableKey + " · " + record.entityType + " · TMDB " + record.tmdbId, y: 50, size: 13, colour: "#DDE2E6" },
    { text: record.currentBackground + " background · " + record.classification, y: 72, size: 11, colour: "#DDE2E6" },
    { text: "Source " + record.sourceWidth + "×" + record.sourceHeight + " · visible "
      + record.visibleArtworkWidth + "×" + record.visibleArtworkHeight, y: 98, size: 11, colour: "#C5CDD2" },
    { text: "Visible area " + percentage(record.visibleArtworkAreaProportion)
      + " · foreground pixels " + percentage(record.foregroundPixelProportion), y: 120, size: 11, colour: "#C5CDD2" },
    { text: "Foreground bounds " + percentage(record.foregroundBoundsAreaProportion)
      + " · edge " + record.outerEdgeColour + " (" + (record.edgeColourStandardDeviation <= 22 ? "uniform" : "varied") + ")",
      y: 142, size: 11, colour: "#C5CDD2" },
    { text: (record.edgeToCoverBackgroundDistance <= CLOSE_EDGE_DISTANCE ? "Edge closely matches " : "Edge differs from ")
      + record.currentBackground + " · distance " + record.edgeToCoverBackgroundDistance,
      y: 164, size: 11, colour: "#C5CDD2" },
    { text: "Other unresolved: " + truncate(other, 43), y: 198, size: 12, colour: "#FFD38A" },
  ];
  const text = lines.map((line) =>
    '<text x="12" y="' + line.y + '" fill="' + line.colour
      + '" font-family="Segoe UI,Arial,sans-serif" font-size="' + line.size
      + '" font-weight="' + (line.weight ?? 400) + '">' + escapeXml(line.text) + "</text>",
  ).join("");
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + TILE_WIDTH + '" height="' + DETAIL_HEIGHT + '">'
      + '<rect width="100%" height="100%" fill="#2E3439"/>'
      + '<rect x="350" y="54" width="158" height="112" rx="4" fill="#1C2227" stroke="#707980"/>'
      + '<text x="429" y="181" text-anchor="middle" fill="#AEB7BD" font-family="Segoe UI,Arial,sans-serif" font-size="11">complete source inset</text>'
      + text
      + "</svg>",
  );
}

async function createOpaqueTile(record) {
  const [coverBuffer, sourceBuffer] = await Promise.all([
    fs.readFile(record.outputPath),
    fs.readFile(record.sourcePath),
  ]);
  if (bufferFingerprint(coverBuffer) !== record.outputHash) {
    throw new Error("Current staged output hash changed for " + record.stableKey + ".");
  }
  if (bufferFingerprint(sourceBuffer) !== record.sourceLogoHash) {
    throw new Error("Cached source hash changed for " + record.stableKey + ".");
  }
  const [cover, inset] = await Promise.all([
    sharp(coverBuffer).resize(TILE_WIDTH, COVER_HEIGHT, { fit: "fill" }).png().toBuffer(),
    sharp(sourceBuffer, { failOn: "error" })
      .rotate()
      .resize(150, 104, { fit: "contain", background: "#20262B" })
      .png()
      .toBuffer(),
  ]);
  return sharp({
    create: { width: TILE_WIDTH, height: TILE_HEIGHT, channels: 4, background: "#2E3439" },
  }).composite([
    { input: cover, left: 0, top: 0 },
    { input: detailTextSvg(record), left: 0, top: COVER_HEIGHT },
    { input: inset, left: 354, top: COVER_HEIGHT + 58 },
  ]).png({ compressionLevel: 9 }).toBuffer();
}

async function createOpaquePage(records, outputPath) {
  const width = PAGE_MARGIN * 2 + PAGE_COLUMNS * TILE_WIDTH + (PAGE_COLUMNS - 1) * PAGE_GAP;
  const height = PAGE_MARGIN * 2 + PAGE_ROWS * TILE_HEIGHT + (PAGE_ROWS - 1) * PAGE_GAP;
  const tiles = await Promise.all(records.map(createOpaqueTile));
  const composites = tiles.map((input, index) => ({
    input,
    left: PAGE_MARGIN + (index % PAGE_COLUMNS) * (TILE_WIDTH + PAGE_GAP),
    top: PAGE_MARGIN + Math.floor(index / PAGE_COLUMNS) * (TILE_HEIGHT + PAGE_GAP),
  }));
  const buffer = await sharp({
    create: { width, height, channels: 4, background: "#555B60" },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await atomicWrite(outputPath, buffer);
  return { width, height, bytes: buffer.length };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function stateRecords(state) {
  if (!state?.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    throw new Error("Invalid production run state.");
  }
  return Object.values(state.entries).filter((record) => record.variantName === "primary").sort(compareEntities);
}

async function classifyRecord(record, preset, stagingRoot) {
  if (!record.outputPath || !isWithin(record.outputPath, stagingRoot)) {
    throw new Error("Opaque review output is missing or outside production staging: " + record.stableKey);
  }
  if (!record.sourcePath || !record.sourceHash) {
    throw new Error("Opaque review record is missing its cached source binding: " + record.stableKey);
  }
  const metrics = await calculateOpaqueMetrics(record, preset);
  const otherUnresolvedReasons = [...new Set(record.reviewReasons ?? [])]
    .filter((reason) => reason !== OPAQUE_REVIEW_REASON)
    .sort();
  const result = {
    stableKey: record.stableKey,
    entityType: record.entityType,
    tmdbId: record.tmdbId,
    name: record.name,
    classification: metrics.classification,
    currentBackground: record.selectedBackground,
    outputHash: record.outputHash,
    outputPath: record.outputPath,
    sourcePath: record.sourcePath,
    sourceLogoHash: record.sourceHash,
    sourceLogoPath: record.logoPath,
    sourceWidth: record.sourceWidth,
    sourceHeight: record.sourceHeight,
    visibleArtworkWidth: record.visibleWidth,
    visibleArtworkHeight: record.visibleHeight,
    visibleArtworkAreaProportion: record.visibleAreaProportion,
    visibleArtworkBounds: record.visibleBounds,
    visiblePixelCount: record.visiblePixelCount,
    otherUnresolvedReasons,
    ...metrics,
  };
  result.sourceEdgeDescription = sourceEdgeDescription(result);
  return result;
}

async function protectedState(packageRoot, presetVersion) {
  const stagingRoot = path.join(packageRoot, ".work", "staging", presetVersion);
  const draftPath = path.join(packageRoot, ".work", "reviews", presetVersion, "review-state-draft.json");
  const checklistPath = path.join(packageRoot, ".work", "reviews", presetVersion, "review-checklist.csv");
  const [staging, draft, checklist] = await Promise.all([
    snapshotProductionDirectory(stagingRoot),
    fs.readFile(draftPath),
    fs.readFile(checklistPath),
  ]);
  return {
    stagedFileCount: staging.count,
    stagedContentFingerprint: staging.combinedFingerprint,
    stagedMtimeFingerprint: staging.mtimeFingerprint,
    reviewStateDraftHash: bufferFingerprint(draft),
    reviewChecklistHash: bufferFingerprint(checklist),
  };
}

function sameProtectedState(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function classificationCounts(records) {
  return Object.fromEntries(OPAQUE_CLASSIFICATION_ORDER.map((classification) => [
    classification,
    records.filter((record) => record.classification === classification).length,
  ]));
}

function summaryFor(records, pageCount) {
  const additional = records.filter((record) => record.otherUnresolvedReasons.length);
  const verySmall = records.filter((record) =>
    record.foregroundPixelProportion <= VERY_SMALL_FOREGROUND_PROPORTION,
  );
  const closeEdge = records.filter((record) =>
    record.edgeToCoverBackgroundDistance <= CLOSE_EDGE_DISTANCE,
  );
  return {
    version: "opaque-final-summary-v1",
    totalUnresolvedOpaqueRecords: records.length,
    classificationCounts: classificationCounts(records),
    pageCount,
    recordsWithAdditionalReviewReasons: {
      count: additional.length,
      records: additional.map((record) => ({
        stableKey: record.stableKey,
        reasons: record.otherUnresolvedReasons,
      })),
    },
    recordsWithVerySmallVisibleArtwork: {
      definition: "estimated foreground pixel proportion <= 12%",
      count: verySmall.length,
      stableKeys: verySmall.map((record) => record.stableKey),
    },
    recordsWhoseOpaqueEdgeCloselyMatchesSelectedBackground: {
      definition: "edge-to-selected-background RGB distance <= 30",
      count: closeEdge.length,
      stableKeys: closeEdge.map((record) => record.stableKey),
    },
    recommendedVisualReviewOrder: [...OPAQUE_CLASSIFICATION_ORDER],
    ownerDecisionsRecorded: 0,
    reviewReasonsApproved: 0,
    networkRequestsMade: 0,
    productionArtworkModified: false,
    reviewStateModified: false,
    finalAssetsWritten: false,
    canonicalManifestWritten: false,
  };
}

function summaryMarkdown(summary) {
  const counts = Object.entries(summary.classificationCounts)
    .map(([classification, count]) => "- " + classification + ": " + count)
    .join("\n");
  return "# Unresolved opaque-source review summary\n\n"
    + "- Total unresolved opaque records: " + summary.totalUnresolvedOpaqueRecords + "\n"
    + "- Pages: " + summary.pageCount + " (4×4; 16 records per page)\n"
    + "- Records with additional unresolved reasons: " + summary.recordsWithAdditionalReviewReasons.count + "\n"
    + "- Records with very small estimated foreground artwork: " + summary.recordsWithVerySmallVisibleArtwork.count + "\n"
    + "- Records whose opaque edge closely matches the selected background: "
      + summary.recordsWhoseOpaqueEdgeCloselyMatchesSelectedBackground.count + "\n"
    + "- Review reasons approved by this package: 0\n\n"
    + "## Classification counts\n\n" + counts + "\n\n"
    + "## Recommended review order\n\n"
    + summary.recommendedVisualReviewOrder.map((classification, index) =>
      (index + 1) + ". " + classification,
    ).join("\n") + "\n";
}

function indexMarkdown(index) {
  const pages = index.pages.map((page) =>
    "## Page " + String(page.pageNumber).padStart(2, "0") + "\n\n"
      + "- File: [" + page.fileName + "](" + page.fileName + ")\n"
      + "- Records: " + page.records.length + "\n"
      + "- Classifications: " + page.classifications.join(", ") + "\n\n"
      + page.records.map((record) =>
        "- " + record.stableKey + " — " + record.name + " — " + record.classification,
      ).join("\n"),
  ).join("\n\n");
  return "# Final unresolved opaque-source owner review\n\n"
    + "- Layout: 4×4\n"
    + "- Page capacity: 16\n"
    + "- Total records: " + index.totalRecords + "\n"
    + "- Total pages: " + index.pageCount + "\n"
    + "- Decisions in review-template.csv are intentionally blank.\n\n"
    + pages + "\n";
}

export async function runOpaqueFinalReview({ packageRoot, presetName = "production-v1" } = {}) {
  if (!packageRoot) throw new Error("packageRoot is required.");
  const focusRoot = assertOpaqueReviewOutputPath(
    path.join(packageRoot, ".work", "review-focus", "opaque-final"),
    packageRoot,
  );
  const presetPath = path.join(packageRoot, "presets", presetName + ".json");
  const statePath = path.join(packageRoot, ".work", "reports", presetName, "run-state.json");
  const [preset, state, before] = await Promise.all([
    fs.readFile(presetPath, "utf8").then(JSON.parse),
    fs.readFile(statePath, "utf8").then(JSON.parse),
    protectedState(packageRoot, presetName),
  ]);
  const allRecords = stateRecords(state);
  if (allRecords.length !== before.stagedFileCount) {
    throw new Error("State/staging mismatch: " + allRecords.length + " records vs "
      + before.stagedFileCount + " staged files.");
  }
  const unresolved = selectUnresolvedOpaqueRecords(allRecords);
  const stagingRoot = path.join(packageRoot, ".work", "staging", presetName);
  const classified = orderOpaqueReviewRecords(
    await mapConcurrent(unresolved, 4, (record) => classifyRecord(record, preset, stagingRoot)),
  );
  const pages = paginateOpaqueReviewRecords(classified);
  const pageResults = [];
  for (const [index, records] of pages.entries()) {
    const pageNumber = index + 1;
    const fileName = "opaque-final-page-" + String(pageNumber).padStart(2, "0") + ".png";
    const outputPath = assertOpaqueReviewOutputPath(path.join(focusRoot, fileName), packageRoot);
    const image = await createOpaquePage(records, outputPath);
    pageResults.push({
      pageNumber,
      fileName,
      outputPath,
      ...image,
      classifications: [...new Set(records.map((record) => record.classification))],
      records: records.map((record) => ({
        stableKey: record.stableKey,
        name: record.name,
        classification: record.classification,
        outputHash: record.outputHash,
      })),
    });
  }
  const index = {
    version: "opaque-final-index-v1",
    presetVersion: presetName,
    columns: PAGE_COLUMNS,
    rows: PAGE_ROWS,
    pageSize: PAGE_SIZE,
    totalRecords: classified.length,
    pageCount: pageResults.length,
    classificationOrder: [...OPAQUE_CLASSIFICATION_ORDER],
    pages: pageResults,
    records: classified,
  };
  const summary = summaryFor(classified, pageResults.length);
  const paths = {
    indexMarkdown: assertOpaqueReviewOutputPath(path.join(focusRoot, "index.md"), packageRoot),
    indexJson: assertOpaqueReviewOutputPath(path.join(focusRoot, "index.json"), packageRoot),
    reviewTemplate: assertOpaqueReviewOutputPath(path.join(focusRoot, "review-template.csv"), packageRoot),
    summaryMarkdown: assertOpaqueReviewOutputPath(path.join(focusRoot, "summary.md"), packageRoot),
    summaryJson: assertOpaqueReviewOutputPath(path.join(focusRoot, "summary.json"), packageRoot),
  };
  await Promise.all([
    atomicWrite(paths.indexMarkdown, indexMarkdown(index)),
    atomicWriteJson(paths.indexJson, index),
    atomicWrite(paths.reviewTemplate, opaqueReviewTemplateCsv(classified)),
    atomicWrite(paths.summaryMarkdown, summaryMarkdown(summary)),
    atomicWriteJson(paths.summaryJson, summary),
  ]);
  const after = await protectedState(packageRoot, presetName);
  if (!sameProtectedState(before, after)) {
    throw new Error("Production staging or review state changed during opaque review preparation.");
  }
  const preservation = {
    before,
    after,
    unchanged: true,
    stagedOutputsWritten: 0,
    reviewStateWrites: 0,
    networkRequestsMade: 0,
    reviewReasonsApproved: 0,
  };
  return { focusRoot, records: classified, pages: pageResults, index, summary, paths, preservation };
}

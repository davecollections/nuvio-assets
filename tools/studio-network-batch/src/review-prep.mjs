import fs from "node:fs/promises";
import path from "node:path";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { createContactSheet, paginateContactSheetItems } from "./contact-sheet.mjs";
import { compareEntities } from "./constants.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";

const GROUP_DEFINITIONS = [
  { id: "missing-logo", filePrefix: "missing-logo", reason: "missing-logo-text-fallback", matches: (record) => (record.renderStatus ?? record.status) === "missing-logo" },
  { id: "unexpectedly-opaque-source", filePrefix: "opaque-source", reason: "unexpectedly-opaque-source-background", matches: (record) => record.unexpectedlyOpaqueBackground === true || record.reviewReasons?.includes("unexpectedly-opaque-source-background") },
  { id: "close-background-score", filePrefix: "close-background-score", reason: "close-background-scores", matches: (record) => record.reviewReasons?.includes("close-background-scores") },
  { id: "very-close-contrast", filePrefix: "very-close-contrast", reason: "very-close-contrast", matches: (record, preset) => Number.isFinite(record.contrastConfidence) && record.contrastConfidence < (preset.contrast.veryCloseScoreDifference ?? preset.contrast.closeScoreDifference) },
  { id: "upscale-over-2x", filePrefix: "upscale", reason: "high-upscale-factor", matches: (record, preset) => record.upscaleFactor > preset.logo.highUpscaleReviewThreshold },
  { id: "likely-low-resolution", filePrefix: "low-resolution", reason: "likely-low-resolution-source", matches: (record) => record.reviewReasons?.includes("likely-low-resolution-source") },
  { id: "all-needs-review", filePrefix: "all-needs-review", reason: null, matches: (record) => record.reviewStatus === "needs-review" },
];

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function reviewReasons(record, preset) {
  const reasons = new Set(record.reviewReasons ?? []);
  const veryClose = GROUP_DEFINITIONS.find((definition) => definition.id === "very-close-contrast");
  if (veryClose.matches(record, preset)) reasons.add(veryClose.reason);
  return [...reasons].sort();
}

export function deduplicateReviewRecords(records, preset) {
  const byKey = new Map();
  for (const record of [...records].sort(compareEntities)) {
    const existing = byKey.get(record.stableKey);
    if (!existing) {
      byKey.set(record.stableKey, { ...record, reviewReasons: reviewReasons(record, preset) });
      continue;
    }
    existing.reviewReasons = [...new Set([...existing.reviewReasons, ...reviewReasons(record, preset)])].sort();
  }
  return [...byKey.values()].sort(compareEntities);
}

export function buildReviewGroups(records, preset) {
  const needsReview = records.filter((record) => record.reviewStatus === "needs-review");
  return Object.fromEntries(GROUP_DEFINITIONS.map((definition) => {
    const matches = needsReview.filter((record) => definition.matches(record, preset));
    return [definition.id, {
      ...definition,
      records: deduplicateReviewRecords(matches, preset),
    }];
  }));
}

function contactSheetLines(record, group) {
  const background = record.selectedBackground ?? record.backgroundPreset ?? "n/a";
  const reasons = record.reviewReasons?.length ? record.reviewReasons.join(", ") : group.reason ?? "needs-review";
  const lines = [
    record.name,
    `TMDB ${record.tmdbId} · ${record.entityType}`,
    `Background: ${background}`,
    `Reason: ${reasons}`,
  ];
  if (group.id === "upscale-over-2x" || group.id === "likely-low-resolution") {
    lines.push(`Source: ${record.sourceWidth}×${record.sourceHeight}; visible: ${record.visibleWidth}×${record.visibleHeight}`);
  }
  if (group.id === "missing-logo") {
    const lineCount = record.fallbackTextLayout?.lineCount ?? record.fallbackLines?.length ?? "n/a";
    lines.push(`Fallback: ${record.fallbackFontSize ?? "n/a"}px; ${lineCount} line${lineCount === 1 ? "" : "s"}`);
  }
  return lines;
}

function reviewSheetPath(reviewRoot, group, pageNumber) {
  return path.join(reviewRoot, `${group.filePrefix}-page-${String(pageNumber).padStart(2, "0")}.png`);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reviewChecklistCsv(entries, recordsByKey) {
  const header = ["stableKey", "name", "entityType", "tmdbId", "outputHash", "reviewStatus", "reasons", "note", "reviewedAt"];
  const rows = entries.map((entry) => {
    const record = recordsByKey.get(entry.stableKey);
    return [entry.stableKey, record.name, record.entityType, record.tmdbId, entry.outputHash, entry.reviewStatus, entry.reasons.join("; "), entry.note, entry.reviewedAt];
  });
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function reviewIndexMarkdown(index) {
  const sections = index.groups.map((group) => `## ${group.sheetName} (${group.count})

${group.pages.length ? group.pages.map((page) => `### Page ${String(page.pageNumber).padStart(2, "0")}

- File: ${path.basename(page.outputPath)}
- Stable keys: ${page.items.map((item) => item.stableKey).join(", ")}
- Review reasons: ${page.reviewReasons.join(", ")}

${page.items.map((item) => `- ${item.stableKey} — ${(item.reviewReasons ?? []).join(", ")}`).join("\n")}`).join("\n\n") : "No matching entities."}`).join("\n\n");
  return `# Production-v1 focused review contact sheets

- Layout: ${index.columns}×${index.rows}
- Page capacity: ${index.pageSize}
- Total sheets: ${index.totalSheets}
- Unique needs-review entities: ${index.uniqueNeedsReview}

${sections}
`;
}

export async function readReportRecords(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid report JSON on line ${index + 1}: ${error.message}`);
    }
  });
}

export async function readCurrentProductionRecords(reportsRoot) {
  const statePath = path.join(reportsRoot, "run-state.json");
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
      throw new Error(`Invalid production run state: ${statePath}`);
    }
    const records = Object.entries(state.entries)
      .filter(([key]) => key.endsWith("|primary"))
      .map(([, record]) => record);
    if (!records.length) throw new Error(`Production run state has no primary records: ${statePath}`);
    return records;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return readReportRecords(path.join(reportsRoot, "entities.jsonl"));
  }
}

export async function buildHashBoundReviewEntries(records, packageRoot, presetVersion, { existingEntries = [] } = {}) {
  const stagingRoot = path.join(packageRoot, ".work", "staging", presetVersion);
  const existingByKey = new Map(existingEntries.map((entry) => [entry.stableKey, entry]));
  const entries = [];
  for (const record of records) {
    if (!record.outputPath || !isWithin(record.outputPath, stagingRoot)) {
      throw new Error(`Review output is missing or outside ignored staging: ${record.stableKey}`);
    }
    const actualHash = bufferFingerprint(await fs.readFile(record.outputPath));
    if (record.outputHash !== actualHash) {
      throw new Error(`Staged output hash differs from the production report for ${record.stableKey}.`);
    }
    const reasons = [...new Set(record.reviewReasons ?? [])].sort();
    const existing = existingByKey.get(record.stableKey);
    const sameReasons = JSON.stringify(existing?.reasons ?? []) === JSON.stringify(reasons);
    const preserve = existing?.outputHash === actualHash && (existing.reviewStatus === "pending" || sameReasons);
    entries.push({
      stableKey: record.stableKey,
      outputHash: actualHash,
      reviewStatus: preserve ? existing.reviewStatus : "pending",
      reasons,
      note: preserve ? existing.note ?? "" : "",
      reviewedAt: preserve ? existing.reviewedAt ?? null : null,
    });
  }
  return entries;
}

export async function prepareProductionReview({ packageRoot, preset, fontCheckResult = null } = {}) {
  const reportsRoot = path.join(packageRoot, ".work", "reports", preset.version);
  const reviewSheetsRoot = path.join(packageRoot, ".work", "contact-sheets", preset.version, "review");
  const reviewStateRoot = path.join(packageRoot, ".work", "reviews", preset.version);
  const workRoot = path.join(packageRoot, ".work");
  for (const outputRoot of [reviewSheetsRoot, reviewStateRoot]) {
    if (!isWithin(outputRoot, workRoot)) throw new Error(`Review preparation refuses to write outside .work: ${outputRoot}`);
  }
  const records = await readCurrentProductionRecords(reportsRoot);
  const groups = buildReviewGroups(records, preset);
  const uniqueNeedsReview = groups["all-needs-review"].records;
  let existingEntries = [];
  const draftPath = path.join(reviewStateRoot, "review-state-draft.json");
  try {
    const parsed = JSON.parse(await fs.readFile(draftPath, "utf8"));
    if (Array.isArray(parsed)) existingEntries = parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Invalid existing review draft ${draftPath}: ${error.message}`);
  }
  const entries = await buildHashBoundReviewEntries(uniqueNeedsReview, packageRoot, preset.version, { existingEntries });
  const columns = preset.contactSheets?.columns ?? 8;
  const rows = preset.contactSheets?.rows ?? 8;
  const pageSize = columns * rows;
  const indexGroups = [];
  for (const definition of GROUP_DEFINITIONS) {
    const group = groups[definition.id];
    const pages = paginateContactSheetItems(group.records, { pageSize });
    const pageResults = [];
    for (const [index, pageRecords] of pages.entries()) {
      const outputPath = reviewSheetPath(reviewSheetsRoot, group, index + 1);
      const labelled = pageRecords.map((record) => ({ ...record, contactSheetLabelLines: contactSheetLines(record, group) }));
      const result = await createContactSheet(labelled, outputPath, {
        ...preset.contactSheets,
        columns,
        labelHeight: Math.max(108, preset.contactSheets?.labelHeight ?? 0),
      });
      pageResults.push({
        ...result,
        pageNumber: index + 1,
        reviewReasons: [...new Set(pageRecords.flatMap((record) => record.reviewReasons ?? []))].sort(),
        items: pageRecords.map((record) => ({ stableKey: record.stableKey, reviewReasons: record.reviewReasons ?? [] })),
      });
    }
    indexGroups.push({ sheetName: group.id, count: group.records.length, pages: pageResults });
  }
  const index = {
    presetVersion: preset.version,
    columns,
    rows,
    pageSize,
    totalSheets: indexGroups.reduce((sum, group) => sum + group.pages.length, 0),
    uniqueNeedsReview: uniqueNeedsReview.length,
    groups: indexGroups,
  };
  const checklistPath = path.join(reviewStateRoot, "review-checklist.csv");
  const indexPath = path.join(reviewSheetsRoot, "index.md");
  const indexJsonPath = path.join(reviewSheetsRoot, "index.json");
  await atomicWriteJson(draftPath, entries);
  await atomicWrite(checklistPath, reviewChecklistCsv(entries, new Map(uniqueNeedsReview.map((record) => [record.stableKey, record]))));
  await atomicWrite(indexPath, reviewIndexMarkdown(index));
  await atomicWriteJson(indexJsonPath, index);
  let fallbackIdsPath = null;
  if (!fontCheckResult?.confirmed) {
    fallbackIdsPath = path.join(reviewStateRoot, "fallback-ids.json");
    await atomicWriteJson(fallbackIdsPath, groups["missing-logo"].records.map((record) => record.stableKey));
  }
  return {
    reportRecords: records.length,
    uniqueNeedsReview: uniqueNeedsReview.length,
    groupCounts: Object.fromEntries(indexGroups.map((group) => [group.sheetName, group.count])),
    totalSheets: index.totalSheets,
    reviewSheetsRoot,
    indexPath,
    draftPath,
    checklistPath,
    fallbackIdsPath,
    writesFinalAssets: false,
    canonicalManifestCreated: false,
  };
}

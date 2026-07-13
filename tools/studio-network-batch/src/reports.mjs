const DOWNLOAD_ERRORS = new Set([
  "http_failure",
  "download_timeout",
  "download_failed",
  "empty_response",
  "unsupported_content_type",
  "offline_cache_miss",
  "offline_cache_refresh_forbidden",
]);
const DECODE_ERRORS = new Set(["decode_failed", "zero_size_image"]);
const ANALYSIS_ERRORS = new Set(["no_visible_pixels", "analysis_failed"]);

function outputSizes(records) {
  return records
    .filter((record) => Number.isSafeInteger(record.outputBytes))
    .map((record) => record.outputBytes)
    .sort((left, right) => left - right);
}

function median(values) {
  if (!values.length) return 0;
  return values.length % 2
    ? values[Math.floor(values.length / 2)]
    : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2);
}

function duplicatePathStatistics(records) {
  const counts = new Map();
  for (const record of records) {
    if (record.logoPath) counts.set(record.logoPath, (counts.get(record.logoPath) ?? 0) + 1);
  }
  const duplicateGroups = [...counts.values()].filter((count) => count > 1);
  return {
    duplicateLogoPathGroups: duplicateGroups.length,
    duplicateLogoPathOutputs: duplicateGroups.reduce((sum, count) => sum + count, 0),
    duplicateLogoPathReuseOpportunities: duplicateGroups.reduce((sum, count) => sum + count - 1, 0),
  };
}

export function calculateRunStatistics(records, preset) {
  const sizes = outputSizes(records);
  const failed = records.filter((record) => record.status === "failed");
  const totalOutputBytes = sizes.reduce((sum, size) => sum + size, 0);
  const highUpscaleThreshold = preset.logo.highUpscaleReviewThreshold;
  const veryCloseThreshold = preset.contrast.veryCloseScoreDifference ?? preset.contrast.closeScoreDifference;
  const verySmallThreshold = preset.review?.verySmallVisiblePixelCount ?? 4096;
  return {
    totalSelected: records.length,
    generated: records.filter((record) => record.status === "generated").length,
    skipped: records.filter((record) => record.status === "skipped").length,
    missingLogoGenerated: records.filter((record) => record.status === "missing-logo").length,
    fallbackGenerated: records.filter((record) => record.status === "missing-logo").length,
    failedDownload: failed.filter((record) => DOWNLOAD_ERRORS.has(record.errorCode)).length,
    failedDecode: failed.filter((record) => DECODE_ERRORS.has(record.errorCode)).length,
    failedAnalysis: failed.filter((record) => ANALYSIS_ERRORS.has(record.errorCode)).length,
    failedRender: failed.filter((record) =>
      !DOWNLOAD_ERRORS.has(record.errorCode) && !DECODE_ERRORS.has(record.errorCode) && !ANALYSIS_ERRORS.has(record.errorCode),
    ).length,
    needsReview: records.filter((record) => record.reviewStatus === "needs-review").length,
    totalOutputBytes,
    medianOutputBytes: median(sizes),
    averageOutputBytes: sizes.length ? Math.round(totalOutputBytes / sizes.length) : 0,
    minimumOutputBytes: sizes[0] ?? 0,
    maximumOutputBytes: sizes.at(-1) ?? 0,
    backgroundSplit: {
      dark: records.filter((record) => record.selectedBackground === "dark" && record.outputHash).length,
      light: records.filter((record) => record.selectedBackground === "light" && record.outputHash).length,
    },
    downloadReused: records.filter((record) => record.downloadReused).length,
    analysisReused: records.filter((record) => record.analysisReused).length,
    renderingReused: records.filter((record) => record.renderReused).length,
    outputsFlaggedHighUpscale: records.filter((record) => record.upscaleFactor > highUpscaleThreshold).length,
    outputsWithVeryCloseContrast: records.filter((record) =>
      Number.isFinite(record.contrastConfidence) && record.contrastConfidence < veryCloseThreshold,
    ).length,
    outputsWithVerySmallVisibleArea: records.filter((record) =>
      Number.isSafeInteger(record.visiblePixelCount) && record.visiblePixelCount < verySmallThreshold,
    ).length,
    ...duplicatePathStatistics(records),
  };
}

export function groupRecordsByStatus(records) {
  const result = {};
  for (const record of records) {
    const group = record.renderStatus ?? record.status ?? "unknown";
    (result[group] ??= []).push({
      stableKey: record.stableKey,
      name: record.name,
      runStatus: record.status,
      reviewStatus: record.reviewStatus,
      reviewReasons: record.reviewReasons ?? [],
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    });
  }
  return result;
}

function priorityItem(record) {
  return {
    stableKey: record.stableKey,
    entityType: record.entityType,
    tmdbId: record.tmdbId,
    name: record.name,
    status: record.status,
    reviewReasons: record.reviewReasons ?? [],
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    upscaleFactor: record.upscaleFactor,
    contrastConfidence: record.contrastConfidence,
    visiblePixelCount: record.visiblePixelCount,
    outputPath: record.outputPath,
  };
}

export function buildReviewPriority(records, preset) {
  const highUpscaleThreshold = preset.logo.highUpscaleReviewThreshold;
  const veryCloseThreshold = preset.contrast.veryCloseScoreDifference ?? preset.contrast.closeScoreDifference;
  const verySmallThreshold = preset.review?.verySmallVisiblePixelCount ?? 4096;
  const groups = [
    ["missingLogoFallbacks", records.filter((record) => (record.renderStatus ?? record.status) === "missing-logo")],
    ["failedItems", records.filter((record) => record.status === "failed")],
    ["upscaleAboveTwo", records.filter((record) => record.upscaleFactor > highUpscaleThreshold)],
    ["veryCloseContrast", records.filter((record) => Number.isFinite(record.contrastConfidence) && record.contrastConfidence < veryCloseThreshold)],
    ["verySmallVisibleAreas", records.filter((record) => Number.isSafeInteger(record.visiblePixelCount) && record.visiblePixelCount < verySmallThreshold)],
  ];
  return Object.fromEntries(groups.map(([name, entries], index) => [name, {
    priority: index + 1,
    count: entries.length,
    items: entries.map(priorityItem),
  }]));
}

export function generationSummaryMarkdown(summary, reviewPriority) {
  const failed = summary.failedDownload + summary.failedDecode + summary.failedAnalysis + summary.failedRender;
  return `# Nuvio ${summary.presetVersion} generation summary

- Run: ${summary.runId}
- Mode: ${summary.mode}
- Selected: ${summary.totalSelected}
- Generated: ${summary.generated}
- Skipped: ${summary.skipped}
- Missing-logo fallbacks generated: ${summary.missingLogoGenerated}
- Failed: ${failed}
- Needs review: ${summary.needsReview}
- Backgrounds: ${summary.backgroundSplit.dark} dark; ${summary.backgroundSplit.light} light
- Output bytes: ${summary.totalOutputBytes} total; ${summary.averageOutputBytes} average; ${summary.medianOutputBytes} median; ${summary.minimumOutputBytes}–${summary.maximumOutputBytes} range
- Duplicate logo paths: ${summary.duplicateLogoPathGroups} groups; ${summary.duplicateLogoPathReuseOpportunities} reuse opportunities
- Reuse: ${summary.downloadReused} downloads; ${summary.analysisReused} analyses; ${summary.renderingReused} renders
- Runtime: ${summary.runDurationMs} ms

## Review priority

${Object.entries(reviewPriority).map(([name, group]) => `### ${group.priority}. ${name}\n\n${group.count ? group.items.map((item) => `- ${item.stableKey} — ${item.name}`).join("\n") : "None."}`).join("\n\n")}
`;
}

export function statusSummaryMarkdown(statusGroups) {
  return `# Review status groups

${Object.entries(statusGroups).map(([status, records]) => `## ${status} (${records.length})\n\n${records.length ? records.map((record) => `- ${record.stableKey} — ${record.name}${record.errorCode ? ` — ${record.errorCode}` : ""}`).join("\n") : "None."}`).join("\n\n")}
`;
}

export function contactSheetIndexMarkdown(index) {
  return `# Contact-sheet index

- Page capacity: ${index.pageSize}
- Total sheets: ${index.totalSheets}

${Object.entries(index.groups).map(([group, pages]) => `## ${group} (${pages.length})\n\n${pages.length ? pages.map((page) => `- Page ${String(page.pageNumber).padStart(2, "0")}: ${page.stableKeys.join(", ")}`).join("\n") : "None."}`).join("\n\n")}
`;
}

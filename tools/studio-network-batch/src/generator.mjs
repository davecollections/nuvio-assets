import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import {
  createContactSheet,
  createPagedContactSheets,
  primaryContactSheetPath,
  variantContactSheetPath,
} from "./contact-sheet.mjs";
import { RENDERER_VERSION } from "./constants.mjs";
import { assertProductionFallbackFont, checkInterAvailability } from "./font-check.mjs";
import { artworkInputFingerprint, bufferFingerprint } from "./fingerprints.mjs";
import { analyseLogo } from "./image-analysis.mjs";
import { createLogoDownloader } from "./logo-cache.mjs";
import { validateOutput } from "./output-validation.mjs";
import {
  renderFallbackCover,
  renderLogoCover,
  stagedOutputPath,
  writeRenderedOutput,
} from "./render.mjs";
import {
  buildReviewPriority,
  calculateRunStatistics,
  contactSheetIndexMarkdown,
  generationSummaryMarkdown,
  groupRecordsByStatus,
  statusSummaryMarkdown,
} from "./reports.mjs";

function isoRunId(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function stateKey(stableKey, variantName) {
  return `${stableKey}|${variantName}`;
}

function renderInputHash(entity, sourceHash, preset, variantName, renderConfig) {
  const base = artworkInputFingerprint(entity, {
    rendererVersion: RENDERER_VERSION,
    presetVersion: preset.version,
  });
  return bufferFingerprint(Buffer.from(JSON.stringify([
    "nuvio-stage-render-input-v1",
    base,
    sourceHash,
    variantName,
    renderConfig.maximumVisibleWidthPercent,
    renderConfig.maximumVisibleHeightPercent,
    renderConfig.backgroundStyle,
    preset.logo.visibleAlphaThreshold,
    preset.backgrounds,
    preset.contrast,
    entity.logoPath ? null : preset.fallbackText,
    preset.output,
  ])));
}

async function readState(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed.entries === "object" ? parsed : { version: 1, entries: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, entries: {} };
    throw new Error(`Invalid staging run state ${filePath}: ${error.message}`);
  }
}

async function canSkip(previous, current, outputPath, preset) {
  if (!previous) return null;
  for (const key of ["stableKey", "logoPath", "sourceHash", "artworkInputHash", "rendererVersion", "presetVersion"]) {
    if ((previous[key] ?? null) !== (current[key] ?? null)) return null;
  }
  if (previous.outputPath !== outputPath || !previous.outputHash) return null;
  try {
    const valid = await validateOutput(outputPath, preset);
    if (valid.outputHash !== previous.outputHash) return null;
    return valid;
  } catch {
    return null;
  }
}

function presetForVariant(preset, variantName) {
  const result = structuredClone(preset);
  if (variantName === "primary") return result;
  const variant = preset.variants[variantName];
  result.logo.maximumVisibleWidthPercent = variant.maximumVisibleWidthPercent;
  result.logo.maximumVisibleHeightPercent = variant.maximumVisibleHeightPercent;
  result.backgrounds.primaryStyle = variant.backgroundStyle;
  return result;
}

function reportAnalysis(analysis) {
  return {
    sourceWidth: analysis.sourceWidth,
    sourceHeight: analysis.sourceHeight,
    visibleBounds: analysis.visibleBounds,
    visibleWidth: analysis.visibleWidth,
    visibleHeight: analysis.visibleHeight,
    transparentPadding: analysis.transparentPadding,
    visibleAreaProportion: analysis.visibleAreaProportion,
    visiblePixelCount: analysis.visiblePixelCount,
    alphaCoverage: analysis.alphaCoverage,
    opaqueEdgeProportion: analysis.opaqueEdgeProportion,
    unexpectedlyOpaqueBackground: analysis.unexpectedlyOpaqueBackground,
    normalisedPixelHash: analysis.normalisedPixelHash,
    darkContrastScore: analysis.darkContrastScore,
    lightContrastScore: analysis.lightContrastScore,
    contrastConfidence: analysis.contrastConfidence,
    contrastDetails: analysis.contrastDetails,
    meanVisibleLuminance: analysis.meanVisibleLuminance,
  };
}

function errorRecord(base, error) {
  return {
    ...base,
    outputPath: null,
    status: "failed",
    reviewStatus: "needs-review",
    errorCode: error.code ?? "pipeline_failure",
    errorMessage: error.message,
    generatedAt: new Date().toISOString(),
  };
}

const REQUIRED_REPORT_FIELDS = [
  "entityType", "tmdbId", "stableKey", "name", "titleCount", "logoPath", "logoUrl",
  "status", "reviewStatus", "backgroundPreset", "darkContrastScore", "lightContrastScore",
  "contrastConfidence", "sourcePath", "sourceFormat", "sourceWidth", "sourceHeight",
  "visibleBounds", "visibleWidth", "visibleHeight", "transparentPadding", "visiblePixelCount",
  "alphaCoverage", "sourceHash", "normalisedPixelHash", "resizeScale", "upscaleFactor",
  "presetVersion", "rendererVersion", "outputPath", "outputHash", "outputBytes",
  "downloadReused", "analysisReused", "renderReused", "generatedAt", "errorCode",
  "errorMessage", "fallbackTextLayout",
];

function completeReportRecord(record) {
  for (const field of REQUIRED_REPORT_FIELDS) {
    if (!(field in record)) record[field] = null;
  }
  if (!Array.isArray(record.reviewReasons)) record.reviewReasons = [];
  return record;
}

async function hashFile(filePath) {
  return bufferFingerprint(await fs.readFile(filePath));
}

function calculateStatistics(records) {
  const sizes = records
    .filter((record) => Number.isSafeInteger(record.outputBytes))
    .map((record) => record.outputBytes)
    .sort((a, b) => a - b);
  const median = sizes.length
    ? sizes.length % 2
      ? sizes[Math.floor(sizes.length / 2)]
      : Math.round((sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2)
    : 0;
  const failed = records.filter((record) => record.status === "failed");
  return {
    totalSelected: records.length,
    generated: records.filter((record) => record.status === "generated").length,
    skipped: records.filter((record) => record.status === "skipped").length,
    fallbackGenerated: records.filter((record) => record.status === "missing-logo").length,
    downloadReused: records.filter((record) => record.downloadReused).length,
    analysisReused: records.filter((record) => record.analysisReused).length,
    renderingReused: records.filter((record) => record.renderReused).length,
    failedDownload: failed.filter((record) => ["http_failure", "download_timeout", "download_failed", "empty_response", "unsupported_content_type"].includes(record.errorCode)).length,
    failedDecode: failed.filter((record) => ["decode_failed", "zero_size_image", "no_visible_pixels"].includes(record.errorCode)).length,
    failedRender: failed.filter((record) => !["http_failure", "download_timeout", "download_failed", "empty_response", "unsupported_content_type", "decode_failed", "zero_size_image", "no_visible_pixels"].includes(record.errorCode)).length,
    needsReview: records.filter((record) => record.reviewStatus === "needs-review").length,
    totalOutputBytes: sizes.reduce((sum, size) => sum + size, 0),
    medianOutputBytes: median,
    minimumOutputBytes: sizes[0] ?? 0,
    maximumOutputBytes: sizes.at(-1) ?? 0,
  };
}

function markdownSummary(summary, records) {
  const review = records.filter((record) => record.reviewStatus === "needs-review");
  return `# Nuvio ${summary.presetVersion} generation summary

- Run: ${summary.runId}
- Mode: ${summary.mode}
- Selected: ${summary.totalSelected}
- Generated: ${summary.generated}
- Skipped: ${summary.skipped}
- Missing-logo fallbacks: ${summary.fallbackGenerated}
- Failed: ${summary.failedDownload + summary.failedDecode + summary.failedRender}
- Needs review: ${summary.needsReview}
- Output bytes: ${summary.totalOutputBytes} total; ${summary.medianOutputBytes} median; ${summary.minimumOutputBytes}–${summary.maximumOutputBytes} range
- Duration: ${summary.runDurationMs} ms

## Needs review

${review.length ? review.map((record) => `- ${record.stableKey} — ${(record.reviewReasons ?? []).join(", ") || record.errorCode}`).join("\n") : "None."}
`;
}

export async function generateBatch({
  plan,
  preset,
  packageRoot,
  sourceData,
  dryRun = false,
  force = false,
  refreshLogoCache = false,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  fontCheckImpl = checkInterAvailability,
} = {}) {
  const startedAt = now();
  if (dryRun) {
    return {
      runId: isoRunId(startedAt),
      mode: plan.mode,
      dryRun: true,
      presetVersion: preset.version,
      rendererVersion: RENDERER_VERSION,
      totalSelected: plan.selectedCount,
      generated: 0,
      message: "Dry run completed without downloads, cache writes, reports, contact sheets, or staged outputs.",
      issues: plan.issues,
    };
  }

  let productionFontCheck = null;
  if (preset.fallbackText?.requireConfirmedFont && plan.selected.some((entity) => !entity.logoPath)) {
    productionFontCheck = await fontCheckImpl({
      requestedFamily: preset.fallbackText.requiredFontFamily ?? "Inter",
    });
    assertProductionFallbackFont(preset, productionFontCheck);
  }

  const workRoot = path.join(packageRoot, ".work");
  const cacheDirectory = path.join(workRoot, "cache", "logos");
  const reportsDirectory = path.join(workRoot, "reports", preset.version);
  const statePath = path.join(reportsDirectory, "run-state.json");
  const runId = isoRunId(startedAt);
  const runDirectory = path.join(reportsDirectory, "runs", runId);
  const recoveryJsonlPath = path.join(runDirectory, "records.jsonl");
  await fs.mkdir(runDirectory, { recursive: true });
  const state = await readState(statePath);
  const downloader = createLogoDownloader({
    cacheDirectory,
    fetchImpl,
    timeoutMs: preset.download.timeoutMs,
    retries: preset.download.retries,
    retryDelayMs: preset.download.retryDelayMs,
    userAgent: preset.download.userAgent,
  });
  const analyses = new Map();
  const rendered = new Map();
  const primaryRecords = [];
  const variantRecords = [];

  async function persistRecord(record, variantName) {
    completeReportRecord(record);
    state.entries[stateKey(record.stableKey, variantName)] = record;
    await atomicWriteJson(statePath, state);
    await fs.appendFile(recoveryJsonlPath, `${JSON.stringify({ ...record, variantName })}\n`);
  }

  async function processEntity(entity, variantName) {
    const variantPreset = presetForVariant(preset, variantName);
    const outputPath = stagedOutputPath(packageRoot, preset.version, entity, variantName);
    const renderConfig = {
      maximumVisibleWidthPercent: variantPreset.logo.maximumVisibleWidthPercent,
      maximumVisibleHeightPercent: variantPreset.logo.maximumVisibleHeightPercent,
      backgroundStyle: variantPreset.backgrounds.primaryStyle,
    };
    const previous = state.entries[stateKey(entity.stableKey, variantName)];
    const base = {
      entityType: entity.entityType,
      tmdbId: entity.tmdbId,
      stableKey: entity.stableKey,
      name: entity.name,
      titleCount: entity.titleCount,
      logoPath: entity.logoPath,
      logoUrl: null,
      presetVersion: preset.version,
      rendererVersion: RENDERER_VERSION,
      variantName,
      expectedOutputPath: outputPath,
      outputPath,
      downloadReused: false,
      analysisReused: false,
      renderReused: false,
      errorCode: null,
      errorMessage: null,
    };

    try {
      let source = null;
      if (entity.logoPath) {
        source = await downloader.download(entity.logoPath, { refresh: refreshLogoCache });
        Object.assign(base, {
          logoUrl: source.url,
          sourcePath: source.cachePath,
          sourceFormat: source.sourceFormat,
          sourceWidth: source.sourceWidth,
          sourceHeight: source.sourceHeight,
          sourceHash: source.sourceHash,
          downloadReused: source.reused,
          downloadReuseKind: source.reuseKind,
        });
      } else {
        base.sourceHash = null;
      }
      base.artworkInputHash = renderInputHash(entity, base.sourceHash, preset, variantName, renderConfig);

      if (!force) {
        const valid = await canSkip(previous, base, outputPath, variantPreset);
        if (valid) {
          const record = {
            ...previous,
            ...base,
            ...valid,
            status: "skipped",
            renderStatus: previous.renderStatus ?? previous.status,
            generatedAt: new Date().toISOString(),
          };
          await persistRecord(record, variantName);
          return record;
        }
      }

      let renderedResult;
      if (!entity.logoPath) {
        renderedResult = await renderFallbackCover(entity, variantPreset, { fontCheckResult: productionFontCheck });
      } else {
        let analysisPromise = analyses.get(source.sourceHash);
        const analysisReused = Boolean(analysisPromise);
        if (!analysisPromise) {
          analysisPromise = analyseLogo(source.cachePath, preset);
          analyses.set(source.sourceHash, analysisPromise);
        }
        const analysis = await analysisPromise;
        base.analysisReused = analysisReused;
        Object.assign(base, reportAnalysis(analysis));
        const renderReuseKey = bufferFingerprint(Buffer.from(JSON.stringify([
          source.sourceHash,
          analysis.normalisedPixelHash,
          renderConfig,
          analysis.selectedBackground,
          preset.version,
          RENDERER_VERSION,
        ])));
        let renderPromise = rendered.get(renderReuseKey);
        const renderReused = Boolean(renderPromise);
        if (!renderPromise) {
          renderPromise = renderLogoCover(analysis, variantPreset);
          rendered.set(renderReuseKey, renderPromise);
        }
        renderedResult = await renderPromise;
        base.renderReused = renderReused;
      }

      await writeRenderedOutput(outputPath, renderedResult.buffer);
      const valid = await validateOutput(outputPath, variantPreset);
      const reviewReasons = [...new Set(renderedResult.reviewReasons ?? [])];
      const record = {
        ...base,
        ...valid,
        backgroundPreset: renderedResult.backgroundPreset,
        selectedBackground: renderedResult.selectedBackground,
        resizeScale: renderedResult.fit?.scale ?? null,
        upscaleFactor: renderedResult.fit?.upscaleFactor ?? null,
        resizeDirection: renderedResult.fit?.resizeDirection ?? null,
        renderedVisibleWidth: renderedResult.fit?.width ?? null,
        renderedVisibleHeight: renderedResult.fit?.height ?? null,
        fallbackFontSize: renderedResult.layout?.fontSize ?? null,
        fallbackLines: renderedResult.layout?.lines ?? null,
        fallbackTextLayout: renderedResult.layout ?? null,
        status: entity.logoPath ? "generated" : "missing-logo",
        renderStatus: entity.logoPath ? "generated" : "missing-logo",
        reviewStatus: entity.logoPath && !reviewReasons.length ? "unreviewed" : "needs-review",
        reviewReasons,
        generatedAt: new Date().toISOString(),
      };
      await persistRecord(record, variantName);
      return record;
    } catch (error) {
      const record = errorRecord(base, error);
      await persistRecord(record, variantName);
      return record;
    }
  }

  for (const entity of plan.selected) {
    primaryRecords.push(await processEntity(entity, "primary"));
  }

  if (plan.mode === "proof-of-concept") {
    const variantKeys = new Set(preset.variants.stableKeys);
    for (const entity of plan.selected.filter((item) => variantKeys.has(item.stableKey))) {
      for (const variantName of ["smaller", "larger", "gradient"]) {
        variantRecords.push(await processEntity(entity, variantName));
      }
    }
  }

  let contactSheets = {};
  if (plan.mode === "proof-of-concept") {
    const primaryPath = primaryContactSheetPath(packageRoot, preset.version);
    const variantsPath = variantContactSheetPath(packageRoot, preset.version);
    contactSheets.primary = await createContactSheet(primaryRecords, primaryPath, { columns: 5 });
    const primaryByKey = new Map(primaryRecords.map((record) => [record.stableKey, record]));
    const variantsByKey = new Map(variantRecords.map((record) => [`${record.stableKey}|${record.variantName}`, record]));
    const comparisonItems = [];
    for (const stableKey of preset.variants.stableKeys) {
      const primary = primaryByKey.get(stableKey);
      if (!primary) continue;
      comparisonItems.push({ ...primary, name: `${primary.name} — primary` });
      for (const variantName of ["smaller", "larger", "gradient"]) {
        const item = variantsByKey.get(`${stableKey}|${variantName}`);
        if (item) comparisonItems.push({ ...item, name: `${item.name} — ${variantName}` });
      }
    }
    contactSheets.variants = await createContactSheet(comparisonItems, variantsPath, {
      columns: 4,
      labelHeight: 72,
    });
  } else {
    contactSheets = await createPagedContactSheets(
      primaryRecords,
      packageRoot,
      preset.version,
      preset.contactSheets ?? {},
    );
  }

  const completedAt = now();
  const statistics = calculateRunStatistics(primaryRecords, preset);
  const sourceCacheHashes = {
    company: await hashFile(sourceData.sourceFiles.company),
    network: await hashFile(sourceData.sourceFiles.network),
  };
  const summary = {
    runId,
    mode: plan.mode,
    dryRun: false,
    force,
    refreshLogoCache,
    presetVersion: preset.version,
    rendererVersion: RENDERER_VERSION,
    sourceDirectory: sourceData.sourceDirectory,
    sourceCacheHashes,
    sourceFileHashes: sourceCacheHashes,
    ...statistics,
    variantsGenerated: variantRecords.filter((record) => ["generated", "missing-logo"].includes(record.status)).length,
    variantsSkipped: variantRecords.filter((record) => record.status === "skipped").length,
    variantsFailed: variantRecords.filter((record) => record.status === "failed").length,
    contactSheets,
    runStartedAt: startedAt.toISOString(),
    runCompletedAt: completedAt.toISOString(),
    runDurationMs: completedAt.getTime() - startedAt.getTime(),
    nodeVersion: process.version,
    sharpVersion: sharp.versions.sharp,
    libvipsVersion: sharp.versions.vips,
    webpVersion: sharp.versions.webp,
    issues: plan.issues,
  };

  const reviewPriority = buildReviewPriority(primaryRecords, preset);
  const statusGroups = groupRecordsByStatus(primaryRecords);

  await atomicWriteJson(path.join(runDirectory, "summary.json"), summary);
  await atomicWrite(path.join(runDirectory, "summary.md"), generationSummaryMarkdown(summary, reviewPriority));
  await atomicWriteJson(path.join(reportsDirectory, "run-summary.json"), summary);
  await atomicWrite(path.join(reportsDirectory, "entities.jsonl"), `${primaryRecords.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await atomicWrite(path.join(reportsDirectory, "variants.jsonl"), `${variantRecords.map((record) => JSON.stringify(record)).join("\n")}${variantRecords.length ? "\n" : ""}`);
  await atomicWrite(path.join(reportsDirectory, "summary.md"), generationSummaryMarkdown(summary, reviewPriority));
  await atomicWriteJson(path.join(reportsDirectory, "review-priority.json"), reviewPriority);
  await atomicWriteJson(path.join(reportsDirectory, "status-groups.json"), statusGroups);
  await atomicWrite(path.join(reportsDirectory, "review-summary.md"), statusSummaryMarkdown(statusGroups));
  if (contactSheets.groups) {
    await atomicWriteJson(path.join(reportsDirectory, "contact-sheet-index.json"), contactSheets);
    await atomicWrite(path.join(reportsDirectory, "contact-sheet-index.md"), contactSheetIndexMarkdown(contactSheets));
  }
  return { ...summary, reviewPriority, statusGroups, records: primaryRecords, variantRecords };
}

export function formatGenerationSummary(summary) {
  if (summary.dryRun) {
    return [
      `Nuvio generation dry run: ${summary.mode}`,
      `Selected: ${summary.totalSelected}`,
      summary.message,
    ].join("\n");
  }
  return [
    `Nuvio generation run: ${summary.runId}`,
    `Mode: ${summary.mode}`,
    `Selected: ${summary.totalSelected}`,
    `Generated: ${summary.generated}; fallback: ${summary.fallbackGenerated}; skipped: ${summary.skipped}`,
    `Failed downloads: ${summary.failedDownload}; decode: ${summary.failedDecode}; analysis: ${summary.failedAnalysis}; render: ${summary.failedRender}`,
    `Reuse — download: ${summary.downloadReused}; analysis: ${summary.analysisReused}; rendering: ${summary.renderingReused}`,
    `Needs review: ${summary.needsReview}`,
    `Backgrounds — dark: ${summary.backgroundSplit.dark}; light: ${summary.backgroundSplit.light}`,
    `Output bytes — total: ${summary.totalOutputBytes}; median: ${summary.medianOutputBytes}; range: ${summary.minimumOutputBytes}–${summary.maximumOutputBytes}`,
    `Variants — generated: ${summary.variantsGenerated}; skipped: ${summary.variantsSkipped}; failed: ${summary.variantsFailed}`,
    summary.contactSheets?.totalSheets ? `Paged contact sheets: ${summary.contactSheets.totalSheets}` : null,
    summary.contactSheets?.primary ? `Primary contact sheet: ${summary.contactSheets.primary.outputPath}` : null,
    summary.contactSheets?.variants ? `Variant contact sheet: ${summary.contactSheets.variants.outputPath}` : null,
  ].filter(Boolean).join("\n");
}

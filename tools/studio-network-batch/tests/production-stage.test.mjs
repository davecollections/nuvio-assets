import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { paginateContactSheetItems } from "../src/contact-sheet.mjs";
import { generateBatch } from "../src/generator.mjs";
import { buildPublishPlan } from "../src/publish-plan.mjs";
import {
  buildReviewPriority,
  calculateRunStatistics,
  groupRecordsByStatus,
} from "../src/reports.mjs";
import { layoutFallbackText } from "../src/render.mjs";

const productionPreset = JSON.parse(
  await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"),
);

function entity(tmdbId, name = `Entity ${tmdbId}`) {
  return {
    entityType: "company",
    tmdbId,
    stableKey: `company:${tmdbId}`,
    name,
    titleCount: 100,
    logoPath: "",
  };
}

function plan(selected) {
  return {
    mode: "all",
    selected,
    selectedCount: selected.length,
    issues: { malformedKeys: [], unknownKeys: [], ineligibleKeys: [], removedKeys: [], ineligibleManifestKeys: [] },
  };
}

async function fixture(context) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-production-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const sourceDirectory = path.join(packageRoot, "source");
  await fs.mkdir(sourceDirectory);
  const company = path.join(sourceDirectory, "companies.json");
  const network = path.join(sourceDirectory, "networks.json");
  await fs.writeFile(company, "[]");
  await fs.writeFile(network, "[]");
  const preset = structuredClone(productionPreset);
  preset.canvas = { width: 240, height: 135 };
  preset.contactSheets = {
    columns: 8,
    rows: 8,
    thumbnailWidth: 80,
    thumbnailHeight: 45,
    labelHeight: 72,
    gap: 4,
    margin: 8,
  };
  return {
    packageRoot,
    preset,
    sourceData: { sourceDirectory, sourceFiles: { company, network } },
  };
}

test("production preset loads the locked artwork settings", () => {
  assert.equal(productionPreset.version, "production-v1");
  assert.deepEqual(productionPreset.canvas, { width: 1200, height: 675 });
  assert.equal(productionPreset.backgrounds.primaryStyle, "flat");
  assert.equal(productionPreset.backgrounds.dark, "#08141C");
  assert.equal(productionPreset.backgrounds.light, "#E4E7E9");
  assert.equal(productionPreset.logo.visibleAlphaThreshold, 8);
  assert.equal(productionPreset.logo.maximumVisibleWidthPercent, 72);
  assert.equal(productionPreset.logo.maximumVisibleHeightPercent, 48);
  assert.equal(productionPreset.output.quality, 86);
  assert.equal(productionPreset.fallbackText.requiredFontFamily, "Inter");
  assert.equal(productionPreset.fallbackText.requireConfirmedFont, true);
});

test("fallback text chooses one line when comfortable and no more than two when wrapping", () => {
  const oneLine = layoutFallbackText("Netflix", productionPreset);
  const twoLines = layoutFallbackText("A Deliberately Long International Television Network Name", productionPreset);
  assert.equal(oneLine.lineCount, 1);
  assert.equal(twoLines.lineCount, 2);
  assert.equal(oneLine.fontFamily, "Inter");
  assert.deepEqual(twoLines.lines, twoLines.wrappedTextLines);
});

test("contact-sheet pagination is deterministic at the 64-item boundary", () => {
  const reversed = Array.from({ length: 65 }, (_, index) => entity(65 - index));
  const pages = paginateContactSheetItems(reversed, { pageSize: 64 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0][0].tmdbId, 1);
  assert.equal(pages[0].at(-1).tmdbId, 64);
  assert.equal(pages[1][0].tmdbId, 65);
});

test("report builders include required statistics, status groups, and review priorities", () => {
  const records = [
    { ...entity(1), status: "missing-logo", renderStatus: "missing-logo", reviewStatus: "needs-review", selectedBackground: "dark", outputHash: "a", outputBytes: 100, reviewReasons: ["missing-logo-text-fallback"] },
    { ...entity(2), logoPath: "/same.png", status: "generated", reviewStatus: "needs-review", selectedBackground: "light", outputHash: "b", outputBytes: 200, upscaleFactor: 3, visiblePixelCount: 1000, contrastConfidence: 0.1, reviewReasons: ["high-upscale-factor"] },
    { ...entity(3), logoPath: "/same.png", status: "failed", reviewStatus: "needs-review", errorCode: "http_failure", reviewReasons: [] },
  ];
  const statistics = calculateRunStatistics(records, productionPreset);
  assert.equal(statistics.totalSelected, 3);
  assert.equal(statistics.averageOutputBytes, 150);
  assert.equal(statistics.failedDownload, 1);
  assert.equal(statistics.duplicateLogoPathReuseOpportunities, 1);
  assert.deepEqual(statistics.backgroundSplit, { dark: 1, light: 1 });
  assert.equal(groupRecordsByStatus(records)["missing-logo"].length, 1);
  const priority = buildReviewPriority(records, productionPreset);
  assert.equal(priority.missingLogoFallbacks.count, 1);
  assert.equal(priority.failedItems.count, 1);
  assert.equal(priority.upscaleAboveTwo.count, 1);
});

test("large-boundary resumability skips all 65 valid staged outputs", async (context) => {
  const data = await fixture(context);
  const selected = Array.from({ length: 65 }, (_, index) => entity(index + 1));
  const first = await generateBatch({
    plan: plan(selected), preset: data.preset, packageRoot: data.packageRoot, sourceData: data.sourceData,
    fontCheckImpl: async () => ({ requestedFamily: "Inter", confirmed: true }),
  });
  assert.equal(first.missingLogoGenerated, 65);
  assert.equal(first.contactSheets.groups.companies.length, 2);
  const second = await generateBatch({
    plan: plan(selected), preset: data.preset, packageRoot: data.packageRoot, sourceData: data.sourceData,
    fontCheckImpl: async () => ({ requestedFamily: "Inter", confirmed: true }),
  });
  assert.equal(second.skipped, 65);
  assert.equal(second.generated, 0);
  assert.equal(second.records.every((record) => record.outputHash), true);
  await fs.access(path.join(data.packageRoot, ".work", "reports", "production-v1", "run-summary.json"));
  await fs.access(path.join(data.packageRoot, ".work", "reports", "production-v1", "review-priority.json"));
  await fs.access(path.join(data.packageRoot, ".work", "reports", "production-v1", "contact-sheet-index.json"));
});

test("publish preparation verifies approval hashes without writing final assets", async (context) => {
  const data = await fixture(context);
  const generated = await generateBatch({
    plan: plan([entity(10, "Approved Example")]), preset: data.preset,
    packageRoot: data.packageRoot, sourceData: data.sourceData,
    fontCheckImpl: async () => ({ requestedFamily: "Inter", confirmed: true }),
  });
  const record = generated.records[0];
  const publishPlan = await buildPublishPlan({
    records: [record],
    reviewEntries: [{
      stableKey: record.stableKey,
      reviewStatus: "approved",
      approvedOutputHash: record.outputHash,
      publishTargetPath: "assets/collection_covers/companies/10.webp",
    }],
    repoRoot: data.packageRoot,
  });
  assert.equal(publishPlan.approvedCount, 1);
  assert.equal(publishPlan.writesPerformed, false);
  await assert.rejects(fs.access(path.join(data.packageRoot, "assets", "collection_covers", "companies", "10.webp")));
});

test("production fallback generation stops before creating work files when Inter is unconfirmed", async (context) => {
  const data = await fixture(context);
  await assert.rejects(
    generateBatch({
      plan: plan([entity(11, "Blocked Example")]),
      preset: data.preset,
      packageRoot: data.packageRoot,
      sourceData: data.sourceData,
      fontCheckImpl: async () => ({ requestedFamily: "Inter", confirmed: false }),
    }),
    (error) => error.code === "required_font_unavailable",
  );
  await assert.rejects(fs.access(path.join(data.packageRoot, ".work")));
});

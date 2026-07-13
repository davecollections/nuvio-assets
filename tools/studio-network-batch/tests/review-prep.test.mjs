import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { bufferFingerprint } from "../src/fingerprints.mjs";
import { buildHashBoundReviewEntries, buildReviewGroups, prepareProductionReview } from "../src/review-prep.mjs";

const preset = {
  version: "production-v1",
  logo: { highUpscaleReviewThreshold: 2 },
  contrast: { closeScoreDifference: 0.35, veryCloseScoreDifference: 0.15 },
  contactSheets: { columns: 2, rows: 2, thumbnailWidth: 80, thumbnailHeight: 45, labelHeight: 72, gap: 4, margin: 8 },
};

function record(id, overrides = {}) {
  return {
    entityType: "company",
    tmdbId: id,
    stableKey: `company:${id}`,
    name: `Entity ${id}`,
    status: "generated",
    renderStatus: "generated",
    reviewStatus: "needs-review",
    reviewReasons: [],
    selectedBackground: "dark",
    ...overrides,
  };
}

test("review reason groups filter correctly and all-needs-review is deduplicated in stable order", () => {
  const records = [
    record(3, { reviewReasons: ["close-background-scores"], contrastConfidence: 0.1 }),
    record(1, { status: "missing-logo", renderStatus: "missing-logo", reviewReasons: ["missing-logo-text-fallback"] }),
    record(2, { unexpectedlyOpaqueBackground: true, upscaleFactor: 3, reviewReasons: ["unexpectedly-opaque-source-background", "high-upscale-factor", "likely-low-resolution-source"] }),
    record(1, { status: "missing-logo", renderStatus: "missing-logo", reviewReasons: ["missing-logo-text-fallback"] }),
  ];
  const groups = buildReviewGroups(records, preset);
  assert.equal(groups["missing-logo"].records.length, 1);
  assert.equal(groups["unexpectedly-opaque-source"].records.length, 1);
  assert.equal(groups["close-background-score"].records.length, 1);
  assert.equal(groups["very-close-contrast"].records.length, 1);
  assert.equal(groups["upscale-over-2x"].records.length, 1);
  assert.equal(groups["likely-low-resolution"].records.length, 1);
  assert.deepEqual(groups["all-needs-review"].records.map((item) => item.stableKey), ["company:1", "company:2", "company:3"]);
  assert.deepEqual(groups["very-close-contrast"].records[0].reviewReasons, ["close-background-scores", "very-close-contrast"]);
});

test("review preparation binds drafts to current output hashes and writes only ignored work artifacts", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-review-prep-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const staging = path.join(packageRoot, ".work", "staging", "production-v1", "companies");
  const reports = path.join(packageRoot, ".work", "reports", "production-v1");
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(reports, { recursive: true });
  const image = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#08141C" } }).webp().toBuffer();
  const hash = bufferFingerprint(image);
  const records = [
    record(2, { outputPath: path.join(staging, "2.webp"), outputHash: hash, reviewReasons: ["unexpectedly-opaque-source-background"], unexpectedlyOpaqueBackground: true }),
    record(1, { outputPath: path.join(staging, "1.webp"), outputHash: hash, status: "missing-logo", renderStatus: "missing-logo", reviewReasons: ["missing-logo-text-fallback"], fallbackFontSize: 64, fallbackLines: ["Entity 1"] }),
  ];
  await Promise.all(records.map((item) => fs.writeFile(item.outputPath, image)));
  await fs.writeFile(path.join(reports, "entities.jsonl"), `${records.map(JSON.stringify).join("\n")}\n`);
  const result = await prepareProductionReview({ packageRoot, preset, fontCheckResult: { confirmed: false } });
  assert.equal(result.uniqueNeedsReview, 2);
  assert.equal(result.writesFinalAssets, false);
  assert.equal(result.canonicalManifestCreated, false);
  const draft = JSON.parse(await fs.readFile(result.draftPath, "utf8"));
  assert.deepEqual(draft.map((entry) => entry.stableKey), ["company:1", "company:2"]);
  assert.equal(draft[0].outputHash, hash);
  assert.equal(draft.every((entry) => entry.reviewStatus === "pending" && entry.reviewedAt === null), true);
  assert.deepEqual(JSON.parse(await fs.readFile(result.fallbackIdsPath, "utf8")), ["company:1"]);
  await assert.rejects(fs.access(path.join(packageRoot, "assets")));
  await assert.rejects(fs.access(path.join(packageRoot, "manifest.json")));
});

test("review preparation uses persistent current state after a selective run report", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-review-state-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const staging = path.join(packageRoot, ".work", "staging", "production-v1", "companies");
  const reports = path.join(packageRoot, ".work", "reports", "production-v1");
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(reports, { recursive: true });
  const image = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#08141C" } }).webp().toBuffer();
  const hash = bufferFingerprint(image);
  const currentRecords = [
    record(1, { outputPath: path.join(staging, "1.webp"), outputHash: hash }),
    record(2, { outputPath: path.join(staging, "2.webp"), outputHash: hash }),
  ];
  await Promise.all(currentRecords.map((item) => fs.writeFile(item.outputPath, image)));
  await fs.writeFile(path.join(reports, "entities.jsonl"), `${JSON.stringify(currentRecords[1])}\n`);
  await fs.writeFile(path.join(reports, "run-state.json"), JSON.stringify({
    version: 1,
    entries: Object.fromEntries(currentRecords.map((item) => [`${item.stableKey}|primary`, { ...item, variantName: "primary" }])),
  }));
  const result = await prepareProductionReview({ packageRoot, preset, fontCheckResult: { confirmed: true } });
  assert.equal(result.reportRecords, 2);
  assert.equal(result.uniqueNeedsReview, 2);
  const draft = JSON.parse(await fs.readFile(result.draftPath, "utf8"));
  assert.deepEqual(draft.map((entry) => entry.stableKey), ["company:1", "company:2"]);
});

test("review preparation rejects a report hash that no longer matches staged output", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-review-hash-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const staging = path.join(packageRoot, ".work", "staging", "production-v1", "companies");
  const reports = path.join(packageRoot, ".work", "reports", "production-v1");
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(reports, { recursive: true });
  const outputPath = path.join(staging, "1.webp");
  await fs.writeFile(outputPath, "changed");
  await fs.writeFile(path.join(reports, "entities.jsonl"), `${JSON.stringify(record(1, { outputPath, outputHash: "stale", reviewReasons: ["missing-logo-text-fallback"] }))}\n`);
  await assert.rejects(
    prepareProductionReview({ packageRoot, preset, fontCheckResult: { confirmed: false } }),
    /hash differs/,
  );
});

test("review preparation preserves matching hash-bound state and resets changed output hashes", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-review-preserve-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const staging = path.join(packageRoot, ".work", "staging", "production-v1", "companies");
  await fs.mkdir(staging, { recursive: true });
  const first = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#08141C" } }).webp().toBuffer();
  const second = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#E4E7E9" } }).webp().toBuffer();
  const records = [
    record(1, { outputPath: path.join(staging, "1.webp"), outputHash: bufferFingerprint(first), reviewReasons: ["close-background-scores"] }),
    record(2, { outputPath: path.join(staging, "2.webp"), outputHash: bufferFingerprint(second), reviewReasons: ["close-background-scores"] }),
  ];
  await Promise.all([fs.writeFile(records[0].outputPath, first), fs.writeFile(records[1].outputPath, second)]);
  const entries = await buildHashBoundReviewEntries(records, packageRoot, "production-v1", { existingEntries: [
    { stableKey: "company:1", outputHash: bufferFingerprint(first), reviewStatus: "pending", reasons: ["close-background-scores"], note: "keep", reviewedAt: null },
    { stableKey: "company:2", outputHash: bufferFingerprint(first), reviewStatus: "pending", reasons: ["close-background-scores"], note: "reset", reviewedAt: null },
  ] });
  assert.equal(entries[0].note, "keep");
  assert.equal(entries[1].note, "");
  assert.equal(entries[1].outputHash, bufferFingerprint(second));
});

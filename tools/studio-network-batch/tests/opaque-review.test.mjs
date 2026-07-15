import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { bufferFingerprint } from "../src/fingerprints.mjs";
import {
  OPAQUE_REVIEW_REASON,
  opaqueReviewTemplateCsv,
  orderOpaqueReviewRecords,
  paginateOpaqueReviewRecords,
  runOpaqueFinalReview,
  selectUnresolvedOpaqueRecords,
} from "../src/opaque-review.mjs";

const productionPreset = JSON.parse(
  await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"),
);

function record(stableKey, extra = {}) {
  const [entityType, id] = stableKey.split(":");
  return {
    stableKey,
    entityType,
    tmdbId: Number(id),
    name: "Entity " + id,
    variantName: "primary",
    reviewReasons: [OPAQUE_REVIEW_REASON],
    classification: "manual-review",
    currentBackground: "dark",
    outputHash: "a".repeat(64),
    otherUnresolvedReasons: [],
    ...extra,
  };
}

test("unresolved-only selection excludes source flags whose opaque reason was resolved", () => {
  const unresolved = record("company:1");
  const resolved = record("company:2", {
    reviewReasons: [],
    unexpectedlyOpaqueBackground: true,
    resolvedReviewReasons: [OPAQUE_REVIEW_REASON],
  });
  const nonPrimary = record("company:3", { variantName: "larger" });
  assert.deepEqual(
    selectUnresolvedOpaqueRecords([resolved, nonPrimary, unresolved]).map((item) => item.stableKey),
    ["company:1"],
  );
});

test("opaque records order by classification, then companies and networks by numeric ID", () => {
  const records = [
    record("network:2", { classification: "tiny-logo-inside-opaque-canvas" }),
    record("company:9", { classification: "opaque-sticker-effect" }),
    record("company:4", { classification: "tiny-logo-inside-opaque-canvas" }),
    record("company:1", { classification: "manual-review" }),
    record("network:1", { classification: "opaque-suitable" }),
    record("company:2", { classification: "tiny-logo-inside-opaque-canvas" }),
  ];
  assert.deepEqual(orderOpaqueReviewRecords(records).map((item) => item.stableKey), [
    "company:2",
    "company:4",
    "network:2",
    "company:9",
    "company:1",
    "network:1",
  ]);
});

test("opaque pagination uses deterministic 4x4 pages", () => {
  const records = Array.from({ length: 17 }, (_, index) =>
    record("company:" + (index + 1), { classification: "manual-review" }),
  );
  const pages = paginateOpaqueReviewRecords([...records].reverse());
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 16);
  assert.equal(pages[1].length, 1);
  assert.deepEqual(pages[0].map((item) => item.tmdbId), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.equal(pages[1][0].tmdbId, 17);
});

test("review-template CSV has the required columns, output binding and blank owner fields", () => {
  const csv = opaqueReviewTemplateCsv([
    record("company:7", {
      name: "Comma, Studio",
      classification: "opaque-sticker-effect",
      currentBackground: "light",
      otherUnresolvedReasons: ["close-background-scores"],
    }),
  ]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "stable_key,name,classification,current_background,output_hash,other_unresolved_reasons,owner_decision,owner_note");
  assert.match(lines[1], /^company:7,"Comma, Studio",opaque-sticker-effect,light,a{64},close-background-scores,,$/);
});

test("offline opaque package generation writes no staging or review state", { concurrency: false }, async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-opaque-review-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const preset = structuredClone(productionPreset);
  preset.canvas = { width: 120, height: 68 };
  const paths = {
    preset: path.join(packageRoot, "presets", "production-v1.json"),
    state: path.join(packageRoot, ".work", "reports", "production-v1", "run-state.json"),
    draft: path.join(packageRoot, ".work", "reviews", "production-v1", "review-state-draft.json"),
    checklist: path.join(packageRoot, ".work", "reviews", "production-v1", "review-checklist.csv"),
    source: path.join(packageRoot, ".work", "cache", "logos", "source.png"),
    output: path.join(packageRoot, ".work", "staging", "production-v1", "companies", "1.webp"),
  };
  await Promise.all(Object.values(paths).map((filePath) => fs.mkdir(path.dirname(filePath), { recursive: true })));
  const source = await sharp({
    create: { width: 60, height: 30, channels: 4, background: "#FFFFFF" },
  }).composite([{
    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect x="20" y="10" width="20" height="10" fill="#000000"/></svg>'),
  }]).png().toBuffer();
  const output = await sharp({
    create: { width: 120, height: 68, channels: 4, background: "#08141C" },
  }).webp().toBuffer();
  await Promise.all([
    fs.writeFile(paths.preset, JSON.stringify(preset)),
    fs.writeFile(paths.source, source),
    fs.writeFile(paths.output, output),
    fs.writeFile(paths.draft, "[]\n"),
    fs.writeFile(paths.checklist, "stableKey\n"),
  ]);
  const state = {
    entries: {
      "company:1|primary": {
        ...record("company:1", { classification: undefined, currentBackground: undefined }),
        selectedBackground: "dark",
        outputPath: paths.output,
        outputHash: bufferFingerprint(output),
        sourcePath: paths.source,
        sourceHash: bufferFingerprint(source),
        logoPath: "/source.png",
        sourceWidth: 60,
        sourceHeight: 30,
        visibleWidth: 60,
        visibleHeight: 30,
        visibleBounds: { left: 0, top: 0, width: 60, height: 30 },
        visibleAreaProportion: 1,
        visiblePixelCount: 1800,
        opaqueEdgeProportion: 1,
      },
    },
  };
  await fs.writeFile(paths.state, JSON.stringify(state));
  const protectedBefore = await Promise.all([
    fs.readFile(paths.state),
    fs.readFile(paths.draft),
    fs.readFile(paths.checklist),
  ]);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden");
  };
  let result;
  try {
    result = await runOpaqueFinalReview({ packageRoot });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const protectedAfter = await Promise.all([
    fs.readFile(paths.state),
    fs.readFile(paths.draft),
    fs.readFile(paths.checklist),
  ]);
  assert.equal(fetchCalls, 0);
  assert.equal(result.summary.totalUnresolvedOpaqueRecords, 1);
  assert.equal(result.summary.pageCount, 1);
  assert.equal(result.index.columns, 4);
  assert.equal(result.index.rows, 4);
  assert.equal(result.preservation.unchanged, true);
  assert.deepEqual(protectedAfter, protectedBefore);
  assert.equal(bufferFingerprint(await fs.readFile(paths.output)), bufferFingerprint(output));
  await fs.access(result.pages[0].outputPath);
  await fs.access(result.paths.reviewTemplate);
  await assert.rejects(fs.access(path.join(packageRoot, "assets")));
});

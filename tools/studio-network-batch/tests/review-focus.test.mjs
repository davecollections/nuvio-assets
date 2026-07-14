import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReviewFocusOutputPath,
  buildProposedReviewActions,
  classifyOpaqueMetrics,
  orderFocusedItems,
  resolveContrastCandidates,
  selectFallbackRepresentatives,
} from "../src/review-focus.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function record(stableKey, name, extra = {}) {
  const [entityType, id] = stableKey.split(":");
  return {
    stableKey,
    entityType,
    tmdbId: Number(id),
    name,
    outputHash: HASH_A,
    sourceHash: HASH_B,
    reviewReasons: [],
    ...extra,
  };
}

test("exact-name resolution keeps duplicate discovery identities and resolves the MM2 canonical alias", () => {
  const records = [
    record("company:2", "MM2 Entertainment"),
    record("network:5", "discovery+"),
    record("network:6", "Discovery+"),
  ];
  const definitions = [
    { requestedName: "discovery+", names: ["discovery+"], category: "clear", expected: "all-new", caseInsensitive: true },
    { requestedName: "M2 Entertainment", names: ["M2 Entertainment", "MM2 Entertainment"], category: "borderline", expected: "single" },
  ];
  const result = resolveContrastCandidates(records, records.map((item) => item.stableKey), definitions);
  assert.deepEqual(result.map((item) => item.stableKey), ["network:5", "network:6", "company:2"]);
  assert.equal(result.at(-1).resolutionKind, "canonical-alias");
});

test("single-name resolution rejects ambiguous duplicate identities", () => {
  const records = [record("company:2", "Example"), record("company:3", "Example")];
  assert.throws(() => resolveContrastCandidates(records, records.map((item) => item.stableKey), [
    { requestedName: "Example", names: ["Example"], category: "clear", expected: "single" },
  ]), /Expected one Example record/);
});

test("focused-sheet ordering is deterministic by focus group, identity and variant", () => {
  const items = [
    { ...record("network:4", "D"), focusOrder: 1, variantName: "forced-dark" },
    { ...record("company:8", "B"), focusOrder: 0, variantName: "forced-light" },
    { ...record("company:8", "B"), focusOrder: 0, variantName: "current" },
    { ...record("company:3", "A"), focusOrder: 0, variantName: "forced-dark" },
  ];
  assert.deepEqual(orderFocusedItems(items).map((item) => `${item.stableKey}/${item.variantName}`), [
    "company:3/forced-dark",
    "company:8/current",
    "company:8/forced-light",
    "network:4/forced-dark",
  ]);
});

test("opaque classification distinguishes blends, tiny canvases, sticker effects, suitable art and uncertainty", () => {
  assert.equal(classifyOpaqueMetrics({ edgeColourStandardDeviation: 2, edgeToCoverBackgroundDistance: 8, foregroundPixelProportion: 0.4, foregroundBoundsAreaProportion: 0.5 }), "opaque-blends-with-background");
  assert.equal(classifyOpaqueMetrics({ edgeColourStandardDeviation: 2, edgeToCoverBackgroundDistance: 200, foregroundPixelProportion: 0.04, foregroundBoundsAreaProportion: 0.2 }), "tiny-logo-inside-opaque-canvas");
  assert.equal(classifyOpaqueMetrics({ edgeColourStandardDeviation: 2, edgeToCoverBackgroundDistance: 200, foregroundPixelProportion: 0.3, foregroundBoundsAreaProportion: 0.5 }), "opaque-sticker-effect");
  assert.equal(classifyOpaqueMetrics({ edgeColourStandardDeviation: 40, edgeToCoverBackgroundDistance: 100, foregroundPixelProportion: 0.4, foregroundBoundsAreaProportion: 0.8 }), "opaque-suitable");
  assert.equal(classifyOpaqueMetrics({ edgeColourStandardDeviation: 25, edgeToCoverBackgroundDistance: 100, foregroundPixelProportion: 0.1, foregroundBoundsAreaProportion: 0.4 }), "manual-review");
});

test("fallback sampling is deterministic, bounded and covers layout extremes", () => {
  const records = Array.from({ length: 30 }, (_, index) => record(`company:${index + 1}`, index === 0 ? "Å" : index === 29 ? "Very Long Institutional University Name, With Punctuation" : `Studio ${index + 1}`, {
    fallbackFontSize: index === 29 ? 28 : 96 - index,
    fallbackTextLayout: {
      fontFamily: "Inter",
      fontSize: index === 29 ? 28 : 96 - index,
      lineCount: index % 2 ? 1 : 2,
      wrappedTextLines: index % 2 ? [`Studio ${index + 1}`] : ["Studio", String(index + 1)],
    },
  }));
  const first = selectFallbackRepresentatives(records, 22);
  const second = selectFallbackRepresentatives([...records].reverse(), 22);
  assert.equal(first.length, 22);
  assert.deepEqual(first.map((item) => item.stableKey), second.map((item) => item.stableKey));
  assert.ok(first.some((item) => item.sampleCategories.includes("shortest-name")));
  assert.ok(first.some((item) => item.sampleCategories.includes("longest-name")));
  assert.ok(first.some((item) => item.sampleCategories.includes("near-minimum-font-size")));
  assert.ok(first.some((item) => item.fallbackTextLayout.lineCount === 1));
  assert.ok(first.some((item) => item.fallbackTextLayout.lineCount === 2));
});

test("focused output guard rejects production staging and review-state paths", () => {
  const root = "C:\\repo\\tools\\studio-network-batch";
  assert.doesNotThrow(() => assertReviewFocusOutputPath(`${root}\\.work\\review-focus\\eligibility-50\\sheet.png`, root));
  assert.throws(() => assertReviewFocusOutputPath(`${root}\\.work\\staging\\production-v1\\companies\\1.webp`, root), /Focused review output/);
  assert.throws(() => assertReviewFocusOutputPath(`${root}\\.work\\reviews\\production-v1\\review-state-draft.json`, root), /Focused review output/);
});

test("proposed reason-level actions bind output hashes and preserve independent reasons", () => {
  const fallback = record("company:1", "Fallback", { reviewReasons: ["missing-logo-text-fallback"] });
  const opaque = {
    ...record("company:2", "Opaque", { reviewReasons: ["close-background-scores", "unexpectedly-opaque-source-background"] }),
    sourceLogoHash: HASH_B,
    currentReviewReasons: ["close-background-scores", "unexpectedly-opaque-source-background"],
    classification: "opaque-suitable",
  };
  const result = buildProposedReviewActions({ fallbacks: [fallback], opaque: [opaque], contrast: [], resolution: [] });
  const proposal = result.groups["safe-opaque-batch-approval"][0];
  assert.equal(proposal.outputHash, HASH_A);
  assert.equal(proposal.sourceLogoHash, HASH_B);
  assert.deepEqual(proposal.unresolvedAfterProposedAction, ["close-background-scores"]);
  assert.equal(result.approvalStateModified, false);
});

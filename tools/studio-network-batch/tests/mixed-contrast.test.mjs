import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createContactSheet } from "../src/contact-sheet.mjs";
import {
  applyMixedContrastRule,
  calculateMixedContrastMetrics,
  compareStableKeys,
  experimentRenderPath,
  summariseProjectedImpact,
  weightedQuantile,
} from "../src/mixed-contrast.mjs";

const preset = JSON.parse(await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"));
const definition = JSON.parse(await fs.readFile(new URL("../presets/mixed-contrast-v1.json", import.meta.url), "utf8"));
const hybrid = definition.rules.find((rule) => rule.id === definition.recommendedRule);

function pixels(groups) {
  const values = [];
  for (const { count, colour, alpha = 255 } of groups) {
    for (let index = 0; index < count; index += 1) values.push(colour.r, colour.g, colour.b, alpha);
  }
  return {
    normalisedBuffer: Buffer.from(values),
    sourceWidth: values.length / 4,
    sourceHeight: 1,
  };
}

const fixtures = {
  colouredSymbolBlackWording: pixels([
    { count: 58, colour: { r: 20, g: 105, b: 240 } },
    { count: 42, colour: { r: 0, g: 0, b: 0 } },
  ]),
  colouredSymbolGreyWording: pixels([
    { count: 58, colour: { r: 15, g: 90, b: 230 } },
    { count: 42, colour: { r: 55, g: 55, b: 55 } },
  ]),
  allWhiteWordmark: pixels([{ count: 100, colour: { r: 255, g: 255, b: 255 } }]),
  allBlackWordmark: pixels([{ count: 100, colour: { r: 0, g: 0, b: 0 } }]),
  balancedColourfulLogo: pixels([
    { count: 34, colour: { r: 240, g: 40, b: 60 } },
    { count: 33, colour: { r: 20, g: 110, b: 240 } },
    { count: 33, colour: { r: 250, g: 205, b: 25 } },
  ]),
  antialiasEdgesOnly: pixels([
    { count: 96, colour: { r: 255, g: 255, b: 255 } },
    { count: 4, colour: { r: 0, g: 0, b: 0 }, alpha: 8 },
  ]),
  neitherBackgroundGood: pixels([
    { count: 50, colour: { r: 255, g: 255, b: 255 } },
    { count: 50, colour: { r: 0, g: 0, b: 0 } },
  ]),
  alternativeHarmsMajority: pixels([
    { count: 72, colour: { r: 255, g: 255, b: 255 } },
    { count: 28, colour: { r: 0, g: 0, b: 0 } },
  ]),
};

function currentBackground(metrics) {
  return metrics.dark.aggregateScore >= metrics.light.aggregateScore ? "dark" : "light";
}

test("weighted percentile calculation is deterministic at exact boundaries", () => {
  const samples = [{ value: 1, weight: 1 }, { value: 2, weight: 2 }, { value: 8, weight: 1 }];
  assert.equal(weightedQuantile(samples, 0.1), 1);
  assert.equal(weightedQuantile(samples, 0.5), 2);
  assert.equal(weightedQuantile(samples, 0.75), 2);
  assert.equal(weightedQuantile(samples, 0.76), 8);
});

test("all eight synthetic contrast patterns produce deterministic metrics and shares", () => {
  for (const fixture of Object.values(fixtures)) {
    const first = calculateMixedContrastMetrics(fixture, preset);
    const second = calculateMixedContrastMetrics(fixture, preset);
    assert.deepEqual(first, second);
    for (const background of ["dark", "light"]) {
      const metrics = first[background];
      assert.equal(metrics.below3 + metrics.atOrAbove3, 1);
      assert.equal(metrics.below4_5 + metrics.atOrAbove4_5, 1);
      assert.ok(metrics.p05 <= metrics.p10 && metrics.p10 <= metrics.p20 && metrics.p20 <= metrics.median);
    }
  }
});

test("current aggregate baseline never changes its input selection", () => {
  const metrics = calculateMixedContrastMetrics(fixtures.colouredSymbolBlackWording, preset);
  const current = currentBackground(metrics);
  const baseline = definition.rules.find((rule) => rule.type === "baseline");
  assert.deepEqual(applyMixedContrastRule(metrics, current, baseline), {
    decision: "unchanged",
    selectedBackground: current,
    ruleId: baseline.id,
    reason: "current-aggregate-baseline",
  });
});

test("lower-tail and hybrid guards can select a meaningful alternative", () => {
  const metrics = {
    dark: { aggregateScore: 3.8, p10: 1.1, p20: 1.5, below2: 0.42, below3: 0.48, atOrAbove3: 0.52 },
    light: { aggregateScore: 2.5, p10: 1.4, p20: 2.2, below2: 0.28, below3: 0.54, atOrAbove3: 0.46 },
  };
  const lower = definition.rules.find((rule) => rule.id === "p10-floor-1.5");
  assert.equal(applyMixedContrastRule(metrics, "dark", lower).decision, "switch");
  assert.equal(applyMixedContrastRule(metrics, "dark", hybrid).selectedBackground, "light");
});

test("hybrid guard does not false-flip obvious white or black controls", () => {
  for (const name of ["allWhiteWordmark", "allBlackWordmark"]) {
    const metrics = calculateMixedContrastMetrics(fixtures[name], preset);
    const current = currentBackground(metrics);
    assert.equal(applyMixedContrastRule(metrics, current, hybrid).decision, "unchanged");
  }
});

test("low-alpha antialiasing edges do not trigger a false flip", () => {
  const metrics = calculateMixedContrastMetrics(fixtures.antialiasEdgesOnly, preset);
  const current = currentBackground(metrics);
  assert.equal(current, "dark");
  assert.equal(applyMixedContrastRule(metrics, current, hybrid).decision, "unchanged");
});

test("hybrid rejects an alternative that severely harms the majority", () => {
  const metrics = calculateMixedContrastMetrics(fixtures.alternativeHarmsMajority, preset);
  assert.equal(currentBackground(metrics), "dark");
  assert.equal(applyMixedContrastRule(metrics, "dark", hybrid).decision, "unchanged");
});

test("mixed dark-component rule flips the known signature and keeps the nearest control", () => {
  const rule = definition.rules.find((item) => item.id === "hybrid-dark-component-v1");
  const candidate = {
    dark: { aggregateScore: 3.46, p10: 1.13, p20: 1.13, below1_5: 0.47, below2: 0.48, below3: 0.48, atOrAbove3: 0.52 },
    light: { aggregateScore: 2.89, p10: 2.41, p20: 2.41, below1_5: 0.01, below2: 0.02, below3: 0.52, atOrAbove3: 0.48 },
  };
  const nearestControl = {
    dark: { aggregateScore: 5.73, p10: 1.43, p20: 1.74, below1_5: 0.13, below2: 0.27, below3: 0.45, atOrAbove3: 0.55 },
    light: { aggregateScore: 1.97, p10: 1.31, p20: 1.31, below1_5: 0.54, below2: 0.54, below3: 0.54, atOrAbove3: 0.46 },
  };
  assert.equal(applyMixedContrastRule(candidate, "dark", rule).selectedBackground, "light");
  assert.equal(applyMixedContrastRule(nearestControl, "dark", rule).decision, "unchanged");
});

test("mixed dark-component rule sends the distinct grey-wording signature to review", () => {
  const rule = definition.rules.find((item) => item.id === "hybrid-dark-component-v1");
  const metrics = {
    dark: { aggregateScore: 4, p10: 2.57, p20: 2.57, below1_5: 0.01, below2: 0.02, below3: 0.43, atOrAbove3: 0.57 },
    light: { aggregateScore: 2.51, p10: 1.22, p20: 1.24, below1_5: 0.28, below2: 0.38, below3: 0.51, atOrAbove3: 0.49 },
  };
  assert.equal(applyMixedContrastRule(metrics, "dark", rule).decision, "review-only");
});

test("stable-key ordering is deterministic across identity namespaces", () => {
  const keys = ["network:6", "company:11846", "company:2", "network:461"];
  assert.deepEqual(keys.sort(compareStableKeys), ["company:2", "company:11846", "network:6", "network:461"]);
});

test("analysis-only projected scan distinguishes switches, review-only, and unchanged", () => {
  const records = [
    { proposedDecision: "unchanged", currentSelectedBackground: "dark", proposedSelectedBackground: "dark" },
    { proposedDecision: "switch", currentSelectedBackground: "dark", proposedSelectedBackground: "light" },
    { proposedDecision: "switch", currentSelectedBackground: "light", proposedSelectedBackground: "dark" },
    { proposedDecision: "review-only", currentSelectedBackground: "dark", proposedSelectedBackground: "dark" },
  ];
  assert.deepEqual(summariseProjectedImpact(records), {
    totalLogoBearing: 4,
    unchanged: 1,
    switchDarkToLight: 1,
    switchLightToDark: 1,
    reviewOnly: 1,
  });
});

test("experimental render paths cannot target production staging", () => {
  const packageRoot = path.resolve("package-root");
  const output = experimentRenderPath(packageRoot, "candidates", "company:6438", "forced-light");
  assert.match(output.replaceAll("\\", "/"), /\.work\/experiments\/mixed-contrast-v1\/renders\/candidates\/company-6438-forced-light\.webp$/);
  assert.doesNotMatch(output.replaceAll("\\", "/"), /\.work\/staging\/production-v1/);
});

test("four-column experiment contact sheet generation is deterministic and readable", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-mixed-sheet-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const items = [];
  for (const [index, variant] of ["current", "forced-dark", "forced-light", "proposed-rule"].entries()) {
    const outputPath = path.join(directory, `${variant}.webp`);
    await sharp({ create: { width: 1200, height: 675, channels: 4, background: index % 2 ? "#08141C" : "#E4E7E9" } }).webp({ quality: 86 }).toFile(outputPath);
    items.push({ name: "Synthetic mixed logo", tmdbId: 1, entityType: "company", stableKey: "company:1", outputPath, variantName: variant, contactSheetLabelLines: ["Synthetic mixed logo", `company:1 · ${variant}`, "dark · agg 3.20 · p10 1.10", ">=3 55% · proposed light"] });
  }
  const firstPath = path.join(directory, "sheet-1.png");
  const secondPath = path.join(directory, "sheet-2.png");
  await createContactSheet(items, firstPath, { columns: 4, labelHeight: 96 });
  await createContactSheet(items, secondPath, { columns: 4, labelHeight: 96 });
  const [first, second, metadata] = await Promise.all([fs.readFile(firstPath), fs.readFile(secondPath), sharp(firstPath).metadata()]);
  assert.deepEqual(first, second);
  assert.equal(metadata.format, "png");
  assert.ok(metadata.width > metadata.height);
});

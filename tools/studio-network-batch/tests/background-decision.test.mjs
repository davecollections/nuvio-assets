import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyProductionBackgroundDecision,
  loadBackgroundDecisionConfiguration,
  MIXED_CONTRAST_REVIEW_REASON,
  STALE_BACKGROUND_DECISION_REASON,
  validateBackgroundDecisionConfiguration,
} from "../src/background-decision.mjs";
import { applyMixedContrastRule } from "../src/mixed-contrast.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preset = JSON.parse(await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"));
const definition = JSON.parse(await fs.readFile(new URL("../presets/mixed-contrast-v1.json", import.meta.url), "utf8"));
const signatures = JSON.parse(await fs.readFile(new URL("./fixtures/mixed-contrast-signatures.json", import.meta.url), "utf8"));
const rule = definition.rules.find((entry) => entry.id === definition.recommendedRule);
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function pixels(groups) {
  const values = [];
  for (const { count, colour } of groups) {
    for (let index = 0; index < count; index += 1) values.push(colour.r, colour.g, colour.b, 255);
  }
  return {
    normalisedBuffer: Buffer.from(values),
    selectedBackground: "dark",
    unexpectedlyOpaqueBackground: false,
    reviewReasons: [],
  };
}

const whiteAnalysis = pixels([{ count: 100, colour: { r: 255, g: 255, b: 255 } }]);
const automaticSwitchAnalysis = pixels([
  { count: 58, colour: { r: 20, g: 105, b: 240 } },
  { count: 42, colour: { r: 0, g: 0, b: 0 } },
]);

function entry(stableKey, backgroundPreset, sourceLogoHash = hashA) {
  return { stableKey, backgroundPreset, sourceLogoHash, reason: "Owner-reviewed mixed-contrast logo" };
}

function configuration(manualDecisions = [], reviewResolutions = []) {
  return {
    version: definition.recommendedRule,
    rule,
    manualDecisions,
    reviewResolutions,
    manualByKey: new Map(manualDecisions.map((item) => [item.stableKey, item])),
    resolutionByKey: new Map(reviewResolutions.map((item) => [item.stableKey, item])),
  };
}

test("production configuration loads 29 hash-bound decisions and 32 background resolutions", async () => {
  const loaded = await loadBackgroundDecisionConfiguration(packageRoot, preset);
  assert.equal(loaded.version, "hybrid-dark-component-v1");
  assert.equal(loaded.manualDecisions.length, 29);
  assert.equal(loaded.reviewResolutions.length, 32);
  assert.equal(loaded.manualByKey.get("company:880").backgroundPreset, "light");
  assert.equal(loaded.manualByKey.get("company:1385").backgroundPreset, "dark");
  assert.equal(loaded.manualByKey.get("network:4440").backgroundPreset, "light");
  assert.equal(loaded.manualByKey.get("network:4883").backgroundPreset, "light");
});

test("all three approved automatic signatures switch and all 12 controls remain unchanged", () => {
  const results = signatures.map((signature) => {
    const current = signature.dark.aggregateScore >= signature.light.aggregateScore ? "dark" : "light";
    return { stableKey: signature.stableKey, expected: signature.expected, actual: applyMixedContrastRule(signature, current, rule).decision };
  });
  assert.deepEqual(results.filter((result) => result.actual === "switch").map((result) => result.stableKey), [
    "company:6438",
    "company:11846",
    "network:3732",
  ]);
  assert.equal(results.filter((result) => result.expected === "unchanged").every((result) => result.actual === "unchanged"), true);
});

test("matching manual light and dark decisions take precedence and resolve only the matching source hash", () => {
  const light = entry("company:1", "light");
  const resolvedLight = applyProductionBackgroundDecision(whiteAnalysis, preset, {
    stableKey: "company:1",
    sourceLogoHash: hashA,
    configuration: configuration([light], [light]),
  });
  assert.equal(resolvedLight.selectedBackground, "light");
  assert.equal(resolvedLight.metadata.backgroundDecisionSource, "manual-hash-bound");
  assert.equal(resolvedLight.metadata.manualBackgroundDecision.status, "applied");
  assert.equal(resolvedLight.metadata.mixedContrastReviewResolution.status, "resolved");
  assert.deepEqual(resolvedLight.reviewReasons, []);

  const dark = entry("company:2", "dark");
  const manualOverAutomatic = applyProductionBackgroundDecision(automaticSwitchAnalysis, preset, {
    stableKey: "company:2",
    sourceLogoHash: hashA,
    configuration: configuration([dark], [dark]),
  });
  assert.equal(manualOverAutomatic.selectedBackground, "dark");
  assert.equal(manualOverAutomatic.metadata.backgroundDecisionSource, "manual-hash-bound");
  assert.equal(manualOverAutomatic.metadata.automaticBackgroundDecision.decision, "switch");
});

test("a stale manual source hash is rejected, automatic analysis resumes, and review returns", () => {
  const stale = entry("company:1", "dark", hashA);
  const decision = applyProductionBackgroundDecision(automaticSwitchAnalysis, preset, {
    stableKey: "company:1",
    sourceLogoHash: hashB,
    configuration: configuration([stale], [stale]),
  });
  assert.equal(decision.selectedBackground, "light");
  assert.equal(decision.metadata.backgroundDecisionSource, "hybrid-dark-component-v1");
  assert.equal(decision.metadata.manualBackgroundDecision.status, "stale");
  assert.equal(decision.metadata.mixedContrastReviewResolution.status, "stale");
  assert.deepEqual(decision.reviewReasons, [MIXED_CONTRAST_REVIEW_REASON, STALE_BACKGROUND_DECISION_REASON]);
});

test("configuration validation rejects duplicate, unordered, invalid-background, and invalid-hash entries", () => {
  const good = entry("company:1", "dark");
  assert.throws(() => validateBackgroundDecisionConfiguration({ manualDecisions: [good, good], reviewResolutions: [] }), /duplicate/);
  assert.throws(() => validateBackgroundDecisionConfiguration({ manualDecisions: [entry("network:1", "dark"), entry("company:2", "dark")], reviewResolutions: [] }), /ordered/);
  assert.throws(() => validateBackgroundDecisionConfiguration({ manualDecisions: [{ ...good, backgroundPreset: "grey" }], reviewResolutions: [] }), /invalid backgroundPreset/);
  assert.throws(() => validateBackgroundDecisionConfiguration({ manualDecisions: [{ ...good, sourceLogoHash: "bad" }], reviewResolutions: [] }), /invalid sourceLogoHash/);
});

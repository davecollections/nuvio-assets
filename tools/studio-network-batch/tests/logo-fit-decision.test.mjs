import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadLogoFitDecisionConfiguration,
  resolveLogoFitDecision,
  validateLogoFitDecisionConfiguration,
} from "../src/logo-fit-decision.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedScope = ["company:4", "company:21", "company:174", "company:2785"];

test("compact-logo fit configuration is bounded to the four exact source-bound company decisions", async () => {
  const configuration = await loadLogoFitDecisionConfiguration(packageRoot);
  assert.deepEqual(configuration.scope, expectedScope);
  assert.equal(configuration.decisions.length, 4);
  for (const decision of configuration.decisions) {
    assert.equal(resolveLogoFitDecision(configuration, {
      stableKey: decision.stableKey,
      sourceLogoPath: decision.sourceLogoPath,
      sourceLogoHash: decision.sourceLogoHash,
      sourceVisibleBounds: decision.sourceVisibleBounds,
    }), decision);
  }
  assert.equal(resolveLogoFitDecision(configuration, {
    stableKey: "company:5",
    sourceLogoPath: "/unused.png",
    sourceLogoHash: "f".repeat(64),
    sourceVisibleBounds: { left: 0, top: 0, width: 1, height: 1 },
  }), null);
});

test("compact-logo fit decisions reject stale source paths, hashes, and visible bounds", async () => {
  const configuration = await loadLogoFitDecisionConfiguration(packageRoot);
  const decision = configuration.decisions[0];
  for (const override of [
    { sourceLogoPath: "/changed.png" },
    { sourceLogoHash: "f".repeat(64) },
    { sourceVisibleBounds: { ...decision.sourceVisibleBounds, width: decision.sourceVisibleBounds.width - 1 } },
  ]) {
    assert.throws(() => resolveLogoFitDecision(configuration, {
      stableKey: decision.stableKey,
      sourceLogoPath: decision.sourceLogoPath,
      sourceLogoHash: decision.sourceLogoHash,
      sourceVisibleBounds: decision.sourceVisibleBounds,
      ...override,
    }), /Stale logo fit decision/);
  }
});

test("compact-logo fit configuration rejects scope drift and unexpected fields", async () => {
  const configuration = await loadLogoFitDecisionConfiguration(packageRoot);
  const plain = JSON.parse(JSON.stringify({
    version: configuration.version,
    scope: configuration.scope,
    decisions: configuration.decisions,
  }));
  plain.scope = plain.scope.slice(1);
  assert.throws(() => validateLogoFitDecisionConfiguration(plain), /scope must exactly match/);

  const unexpected = JSON.parse(JSON.stringify({
    version: configuration.version,
    scope: configuration.scope,
    decisions: configuration.decisions,
  }));
  unexpected.decisions[0].note = "not permitted";
  assert.throws(() => validateLogoFitDecisionConfiguration(unexpected), /unexpected: note/);
});

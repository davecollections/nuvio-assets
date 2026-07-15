import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyReviewReasonResolutions,
  loadReviewReasonResolutionConfiguration,
  validateReviewReasonResolutionConfiguration,
} from "../src/review-reason-resolution.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function configuration() {
  return {
    version: "test-v1",
    groups: [{
      reason: "close-background-scores",
      approvalReason: "Owner reviewed contrast",
      bindings: [["company:1", HASH_A, HASH_B]],
    }],
  };
}

test("production reason resolutions load all reviewed hash bindings", async () => {
  const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", "production-v1.json"), "utf8"));
  const loaded = await loadReviewReasonResolutionConfiguration(packageRoot, preset);
  assert.equal(loaded.resolutions.length, 528);
  assert.deepEqual(Object.fromEntries(loaded.groups.map((group) => [group.reason, group.bindings.length])), {
    "close-background-scores": 7,
    "high-upscale-factor": 7,
    "likely-low-resolution-source": 3,
    "low-robust-contrast": 1,
    "missing-logo-text-fallback": 332,
    "unexpectedly-opaque-source-background": 176,
    "very-close-contrast": 2,
  });
});

test("review reason resolution configuration enforces deterministic hash-bound bindings", () => {
  assert.equal(validateReviewReasonResolutionConfiguration(configuration()).version, "test-v1");
  assert.throws(() => validateReviewReasonResolutionConfiguration({
    version: "test-v1",
    groups: [{
      reason: "close-background-scores",
      approvalReason: "Owner reviewed contrast",
      bindings: [["network:1", HASH_A], ["company:2", HASH_A]],
    }],
  }), /ordered/);
  assert.throws(() => validateReviewReasonResolutionConfiguration({
    version: "test-v1",
    groups: [
      { reason: "close-background-scores", approvalReason: "First", bindings: [["company:1", HASH_A]] },
      { reason: "close-background-scores", approvalReason: "Duplicate", bindings: [["company:1", HASH_A]] },
    ],
  }), /ordered|duplicate/);
});

test("reason resolutions remove only the exact approved reason and preserve independent reasons", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-reason-resolution-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(packageRoot, "config"));
  await fs.writeFile(path.join(packageRoot, "config", "review-reason-resolutions.json"), JSON.stringify(configuration()));
  const loaded = await loadReviewReasonResolutionConfiguration(packageRoot, {
    review: { reasonResolutions: "config/review-reason-resolutions.json" },
  });
  const result = applyReviewReasonResolutions({
    stableKey: "company:1",
    outputHash: HASH_A,
    sourceHash: HASH_B,
  }, ["close-background-scores", "unexpectedly-opaque-source-background"], loaded);
  assert.deepEqual(result.unresolvedReasons, ["unexpectedly-opaque-source-background"]);
  assert.deepEqual(result.resolvedReviewReasons.map((item) => item.reason), ["close-background-scores"]);
  assert.equal(result.reviewReasonResolutionStatuses[0].status, "resolved");
});

test("changed output or source hashes invalidate reason resolutions", async (context) => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-reason-stale-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(packageRoot, "config"));
  await fs.writeFile(path.join(packageRoot, "config", "review-reason-resolutions.json"), JSON.stringify(configuration()));
  const loaded = await loadReviewReasonResolutionConfiguration(packageRoot, {
    review: { reasonResolutions: "config/review-reason-resolutions.json" },
  });
  const staleOutput = applyReviewReasonResolutions({ stableKey: "company:1", outputHash: HASH_C, sourceHash: HASH_B }, ["close-background-scores"], loaded);
  assert.deepEqual(staleOutput.unresolvedReasons, ["close-background-scores"]);
  assert.equal(staleOutput.reviewReasonResolutionStatuses[0].status, "stale-output");
  const staleSource = applyReviewReasonResolutions({ stableKey: "company:1", outputHash: HASH_A, sourceHash: HASH_C }, ["close-background-scores"], loaded);
  assert.deepEqual(staleSource.unresolvedReasons, ["close-background-scores"]);
  assert.equal(staleSource.reviewReasonResolutionStatuses[0].status, "stale-source");
});

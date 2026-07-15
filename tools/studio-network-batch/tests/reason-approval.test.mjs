import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewResolutionsInMemory,
  buildFinalReviewResolutionConfigurations,
  reconcileFinalReviewActions,
} from "../src/reason-approval.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function record(overrides = {}) {
  return {
    stableKey: "company:1",
    entityType: "company",
    tmdbId: 1,
    name: "Example",
    outputHash: HASH_A,
    sourceHash: HASH_B,
    selectedBackground: "dark",
    reviewStatus: "needs-review",
    reviewReasons: ["close-background-scores", "mixed-contrast-background-review"],
    ...overrides,
  };
}

function action(reason, proposedAction = "retain-current-background") {
  return {
    stableKey: "company:1",
    canonicalName: "Example",
    reason,
    proposedAction,
    outputHash: HASH_A,
    sourceHash: HASH_B,
    currentBackground: "dark",
    recommendedBackground: "dark",
  };
}

test("final review reconciliation accepts only exact live safe hash-bound rows", () => {
  const records = [record()];
  const draftEntries = [{ stableKey: "company:1", outputHash: HASH_A, reasons: records[0].reviewReasons }];
  const reconciled = reconcileFinalReviewActions({
    proposedActions: [action("close-background-scores"), action("mixed-contrast-background-review")],
    records,
    draftEntries,
    expectedActionCounts: { "retain-current-background": 2 },
    exceptionKeys: [],
  });
  assert.equal(reconciled.liveActionCount, 2);
  assert.equal(reconciled.liveRecordCount, 1);
  assert.throws(() => reconcileFinalReviewActions({
    proposedActions: [{ ...action("close-background-scores"), proposedAction: "switch-light" }, action("mixed-contrast-background-review")],
    records,
    draftEntries,
    exceptionKeys: [],
  }), /not authorised/);
  assert.throws(() => reconcileFinalReviewActions({
    proposedActions: [{ ...action("close-background-scores"), outputHash: "c".repeat(64) }, action("mixed-contrast-background-review")],
    records,
    draftEntries,
    exceptionKeys: [],
  }), /output hash changed/i);
});

test("final review configuration updates are deterministic and keep retain-current decisions source-bound", () => {
  const records = [record()];
  const updates = buildFinalReviewResolutionConfigurations({
    liveActions: [action("close-background-scores"), action("mixed-contrast-background-review")],
    records,
    reasonConfiguration: {
      version: "old",
      groups: [{ reason: "close-background-scores", approvalReason: "Approved", bindings: [] }],
    },
    backgroundResolutions: [],
  });
  assert.equal(updates.reasonConfiguration.version, "final-review-reason-resolutions-v1");
  assert.deepEqual(updates.reasonConfiguration.groups[0].bindings, [["company:1", HASH_A, HASH_B]]);
  assert.deepEqual(updates.backgroundResolutions[0], {
    stableKey: "company:1",
    backgroundPreset: "dark",
    sourceLogoHash: HASH_B,
    reason: "Owner approved final publication-readiness background",
    name: "Example",
  });
});

test("in-memory review resolution clears exact reasons without mutating persistent records", () => {
  const persistent = record();
  const reasonConfiguration = {
    version: "final-v1",
    byStableKey: new Map([["company:1", [{
      stableKey: "company:1",
      reason: "close-background-scores",
      outputHash: HASH_A,
      sourceLogoHash: HASH_B,
      approvalReason: "Approved",
    }]]]),
  };
  const backgroundConfiguration = {
    version: "background-v1",
    resolutionByKey: new Map([["company:1", {
      stableKey: "company:1",
      backgroundPreset: "dark",
      sourceLogoHash: HASH_B,
      reason: "Approved background",
    }]]),
  };
  const [effective] = applyReviewResolutionsInMemory([persistent], reasonConfiguration, backgroundConfiguration);
  assert.deepEqual(effective.reviewReasons, []);
  assert.equal(effective.reviewStatus, "unreviewed");
  assert.deepEqual(persistent.reviewReasons, ["close-background-scores", "mixed-contrast-background-review"]);
  assert.equal(persistent.reviewStatus, "needs-review");
});

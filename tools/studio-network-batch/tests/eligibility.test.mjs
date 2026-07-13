import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  classifyEligibilityTier,
  isAutomaticallyEligible,
  loadEligibilityPolicy,
  validateEligibilityPolicy,
} from "../src/eligibility.mjs";

const policy = validateEligibilityPolicy({
  version: "test",
  eligibility: { companyMinimumTitleCount: 50, networkMinimumTitleCount: 50 },
});

test("committed production defaults remain independent 50/50 thresholds", async () => {
  const configured = await loadEligibilityPolicy(path.resolve("."));
  assert.equal(configured.companyMinimumTitleCount, 50);
  assert.equal(configured.networkMinimumTitleCount, 50);
});

function entity(entityType, titleCount, tmdbId = titleCount + 1) {
  return { entityType, titleCount, tmdbId, stableKey: `${entityType}:${tmdbId}` };
}

test("company and network thresholds independently include 50 and 51 but exclude 49", () => {
  for (const entityType of ["company", "network"]) {
    assert.equal(isAutomaticallyEligible(entity(entityType, 49), policy), false);
    assert.equal(isAutomaticallyEligible(entity(entityType, 50), policy), true);
    assert.equal(isAutomaticallyEligible(entity(entityType, 51), policy), true);
  }
  const independent = validateEligibilityPolicy({ companyMinimumTitleCount: 51, networkMinimumTitleCount: 49 });
  assert.equal(isAutomaticallyEligible(entity("company", 50), independent), false);
  assert.equal(isAutomaticallyEligible(entity("network", 50), independent), true);
});

test("eligibility tiers distinguish core, expanded, curated and explicit records", () => {
  assert.equal(classifyEligibilityTier(entity("company", 100), policy), "core");
  assert.equal(classifyEligibilityTier(entity("network", 50), policy), "expanded-threshold");
  assert.equal(classifyEligibilityTier(entity("company", 25, 25), policy, { curatedExceptionKeys: new Set(["company:25"]) }), "curated-exception");
  assert.equal(classifyEligibilityTier(entity("network", 10), policy, { explicit: true }), "explicit");
});

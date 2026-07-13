import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildBandStatistics,
  captureProtectedState,
  writeThresholdPlans,
} from "../src/threshold-audit.mjs";

function entity(entityType, tmdbId, titleCount, logoPath = "") {
  return { entityType, tmdbId, stableKey: `${entityType}:${tmdbId}`, name: `${entityType}-${tmdbId}`, titleCount, logoPath, originCountry: "", parentCompany: "" };
}

test("threshold bands and deterministic plan files group missing logos and duplicate reuse", async () => {
  const records = [entity("company", 2, 50), entity("company", 1, 100, "/a.png"), entity("network", 4, 25, "/n.png"), entity("network", 3, 50, "/a.png")];
  const bands = buildBandStatistics(records);
  assert.equal(bands.find((item) => item.entityType === "company" && item.countBand === "50-99").totalRecords, 1);
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-threshold-plans-"));
  const delta = {
    existingStillEligible: [records[1]],
    newCompanies: [records[0]], newNetworks: [records[3]], newEligible: [records[0], records[3]],
    newLogoBacked: [records[3]], newMissingLogo: [records[0]],
    duplicateReuse: [{ stableKey: "network:3" }], changedExisting: [], noLongerAutomaticallyEligible: [],
  };
  const { plans } = await writeThresholdPlans(packageRoot, delta);
  assert.deepEqual(plans["new-all.json"], ["company:2", "network:3"]);
  assert.deepEqual(plans["new-missing-logo.json"], ["company:2"]);
  assert.deepEqual(plans["new-duplicate-reuse.json"], ["network:3"]);
});

test("plan writing preserves staged content, mtimes and review hashes", async () => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-threshold-preserve-"));
  const staging = path.join(packageRoot, ".work", "staging", "production-v1", "companies");
  const reviews = path.join(packageRoot, ".work", "reviews", "production-v1");
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(reviews, { recursive: true });
  await fs.writeFile(path.join(staging, "1.webp"), Buffer.from("unchanged-artwork"));
  await fs.writeFile(path.join(reviews, "review-state-draft.json"), "[]\n");
  await fs.writeFile(path.join(reviews, "review-checklist.csv"), "stableKey\n");
  const before = await captureProtectedState(packageRoot, "production-v1");
  await writeThresholdPlans(packageRoot, {
    existingStillEligible: [], newCompanies: [], newNetworks: [], newEligible: [], newLogoBacked: [],
    newMissingLogo: [], duplicateReuse: [], changedExisting: [], noLongerAutomaticallyEligible: [],
  });
  const after = await captureProtectedState(packageRoot, "production-v1");
  assert.equal(after.staging.combinedFingerprint, before.staging.combinedFingerprint);
  assert.equal(after.staging.mtimeFingerprint, before.staging.mtimeFingerprint);
  assert.equal(after.reviewState.sha256, before.reviewState.sha256);
  assert.equal(after.reviewChecklist.sha256, before.reviewChecklist.sha256);
});

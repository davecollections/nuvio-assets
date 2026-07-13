import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bufferFingerprint } from "../src/fingerprints.mjs";
import { logoCachePath } from "../src/logo-cache.mjs";
import { buildPersistentStateDelta } from "../src/state-delta.mjs";

const policy = { version: "test", companyMinimumTitleCount: 50, networkMinimumTitleCount: 50 };
const preset = { version: "production-v1" };

function entity(entityType, tmdbId, titleCount, logoPath = "", name = `${entityType}-${tmdbId}`) {
  return { entityType, tmdbId, stableKey: `${entityType}:${tmdbId}`, name, titleCount, logoPath, parentCompany: "", originCountry: "", headquarters: "" };
}

test("persistent-state delta selects only new eligible records and reports changes without network access", async () => {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-state-delta-"));
  const cacheDirectory = path.join(packageRoot, ".work", "cache", "logos");
  await fs.mkdir(cacheDirectory, { recursive: true });
  const currentBuffer = Buffer.from("current-logo");
  const hashPath = logoCachePath(cacheDirectory, "/hash.png");
  await fs.writeFile(hashPath, currentBuffer);
  const entities = [
    entity("company", 1, 100, "/same.png"),
    entity("company", 2, 50),
    entity("company", 3, 50, "/same.png"),
    entity("company", 4, 60, "/new-path.png"),
    entity("company", 5, 75, "/hash.png"),
    entity("network", 10, 49),
  ];
  const stateRecords = [
    { ...entities[0], sourceHash: "same" },
    { ...entities[3], logoPath: "/old-path.png", sourceHash: "old" },
    { ...entities[4], sourceHash: bufferFingerprint(Buffer.from("old-logo")) },
    entity("network", 10, 50),
  ];
  const delta = await buildPersistentStateDelta({
    entities,
    eligibility: policy,
    stateRecords,
    packageRoot,
    preset,
    inspectOutputs: false,
  });
  assert.deepEqual(delta.newEligible.map((item) => item.stableKey), ["company:2", "company:3"]);
  assert.deepEqual(delta.newMissingLogo.map((item) => item.stableKey), ["company:2"]);
  assert.deepEqual(delta.duplicateReuse.map((item) => item.stableKey), ["company:3"]);
  assert.deepEqual(delta.changedLogoPaths.map((item) => item.stableKey), ["company:4"]);
  assert.deepEqual(delta.changedSourceHashes.map((item) => item.stableKey), ["company:5"]);
  assert.deepEqual(delta.noLongerAutomaticallyEligible.map((item) => item.stableKey), ["network:10"]);
});

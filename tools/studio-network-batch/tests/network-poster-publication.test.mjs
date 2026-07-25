import assert from "node:assert/strict";
import test from "node:test";

import {
  installPreparedNetworkPosterTransaction,
  validateResolverCompatibilityEvidence,
} from "../src/network-poster-publication.mjs";

const evidence = {
  version: "network-poster-resolver-compatibility-v1",
  acceptedRuntimeSchemaVersions: [1, 2],
  networkPosterRequiredInV2: true,
  companyPosterUnsupported: true,
  v1AdapterInterfaceUnchanged: true,
  testsPassed: true,
};

test("publication compatibility gate requires dual-version resolver and unchanged v1 adapter evidence", () => {
  assert.equal(validateResolverCompatibilityEvidence(evidence), evidence);
  assert.throws(
    () => validateResolverCompatibilityEvidence({ ...evidence, testsPassed: false }),
    /tests have not passed/,
  );
});

test("public installation remains locked in the proof-only tooling task", async () => {
  await assert.rejects(installPreparedNetworkPosterTransaction(), /separately authorized release task/);
});

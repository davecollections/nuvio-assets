import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanonicalManifestV2,
  inventoryFingerprint,
  posterApprovalHash,
  validateCanonicalManifest,
} from "../src/canonical-manifest.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function landscapeManifest() {
  return {
    version: "studio-network-canonical-manifest-v1",
    releaseId: "studio-network-v1-2026-07-16",
    publishedAt: "2026-07-16T00:00:00.000Z",
    status: "published",
    entrySchema: "tools/studio-network-batch/schemas/manifest-entry.schema.json",
    approvalStateHash: SHA_A,
    stagingContentFingerprint: SHA_A,
    publishedAssetFingerprint: inventoryFingerprint([{ path: "networks/7.webp", bytes: 100, sha256: SHA_A }]),
    entryCount: 1,
    companyCount: 0,
    networkCount: 1,
    entries: [{
      stable_key: "network:7",
      entity_type: "network",
      tmdb_id: 7,
      output_hash: SHA_A,
      output_path: "assets/collection_covers/networks/7.webp",
    }],
    publicationMetadata: [{
      stableKey: "network:7",
      entityType: "network",
      tmdbId: 7,
    }],
  };
}

function posterRecord() {
  const record = {
    stableKey: "network:7",
    tmdbId: 7,
    name: "Seven",
    candidateSha256: SHA_B,
    candidateBytes: 123,
    background: "dark",
    renderMode: "generated-logo",
    sourceLogoPath: "/seven.png",
    sourceSha256: SHA_A,
    normalizedPixelSha256: SHA_A,
    decisionBinding: {
      kind: "poster-background-decision-v1",
      stableKey: "network:7",
      tmdbId: 7,
      orientation: "poster",
      sourceLogoPath: "/seven.png",
      sourceLogoSha256: SHA_A,
      background: "dark",
    },
    ownerApprovalBasis: "owner-approved-strong",
    rendererVersion: "network-poster-proof-renderer-v1",
    presetVersion: "network-poster-variant-b-proof-v1",
  };
  record.approvalHash = posterApprovalHash({
    decisionBinding: record.decisionBinding,
    outputHash: record.candidateSha256,
    approvalBasis: record.ownerApprovalBasis,
    rendererVersion: record.rendererVersion,
    presetVersion: record.presetVersion,
  });
  return record;
}

test("manifest v2 preserves landscape sections and adds exactly one source-bound poster per network", () => {
  const v1 = landscapeManifest();
  const v2 = createCanonicalManifestV2({
    landscapeManifest: v1,
    posterRecords: [posterRecord()],
    releaseId: "studio-network-posters-v2-2026-07-25",
    publishedAt: "2026-07-25T01:02:03.000Z",
    landscapeInventory: [{ path: "networks/7.webp", bytes: 100, sha256: SHA_A }],
  });
  assert.equal(v2.version, "studio-network-canonical-manifest-v2");
  assert.equal(v2.entries, v1.entries);
  assert.equal(v2.publicationMetadata, v1.publicationMetadata);
  assert.equal(v2.posterCount, 1);
  assert.equal(v2.posterPublicationMetadata[0].publishPath, "assets/collection_covers/networks/poster/7.webp");
  assert.equal(validateCanonicalManifest(v2), v2);
});

test("manifest v2 rejects incomplete network coverage and stale source bindings", () => {
  assert.throws(() => createCanonicalManifestV2({
    landscapeManifest: landscapeManifest(),
    posterRecords: [],
    releaseId: "studio-network-posters-v2-2026-07-25",
    publishedAt: "2026-07-25T01:02:03.000Z",
    landscapeInventory: [{ path: "networks/7.webp", bytes: 100, sha256: SHA_A }],
  }), /coverage|every network/i);

  const record = posterRecord();
  record.decisionBinding.sourceLogoSha256 = "c".repeat(64);
  assert.throws(() => createCanonicalManifestV2({
    landscapeManifest: landscapeManifest(),
    posterRecords: [record],
    releaseId: "studio-network-posters-v2-2026-07-25",
    publishedAt: "2026-07-25T01:02:03.000Z",
    landscapeInventory: [{ path: "networks/7.webp", bytes: 100, sha256: SHA_A }],
  }), /approval hash|stale/i);
});

test("manifest validation rejects duplicate landscape paths and duplicate poster identities", () => {
  const duplicateLandscape = landscapeManifest();
  duplicateLandscape.entryCount = 2;
  duplicateLandscape.networkCount = 2;
  duplicateLandscape.entries.push({
    stable_key: "network:8",
    entity_type: "network",
    tmdb_id: 8,
    output_hash: SHA_A,
    output_path: duplicateLandscape.entries[0].output_path,
  });
  duplicateLandscape.publicationMetadata.push({
    stableKey: "network:8",
    entityType: "network",
    tmdbId: 8,
  });
  assert.throws(() => validateCanonicalManifest(duplicateLandscape), /duplicate landscape path/);

  assert.throws(() => createCanonicalManifestV2({
    landscapeManifest: landscapeManifest(),
    posterRecords: [posterRecord(), posterRecord()],
    releaseId: "studio-network-posters-v2-2026-07-25",
    publishedAt: "2026-07-25T01:02:03.000Z",
    landscapeInventory: [{ path: "networks/7.webp", bytes: 100, sha256: SHA_A }],
  }), /duplicate poster|coverage|every network/i);
});

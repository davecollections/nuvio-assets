import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculateLookupFingerprint,
  generateRuntimeLookup,
  validateRuntimeLookup,
} from "../src/runtime-lookup.mjs";
import {
  createCanonicalManifestV2,
  inventoryFingerprint,
  posterApprovalHash,
} from "../../studio-network-batch/src/canonical-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaV1 = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas/artwork-runtime-lookup.schema.json"), "utf8"));
const schemaV2 = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas/artwork-runtime-lookup-v2.schema.json"), "utf8"));
const SHA = "a".repeat(64);

function runtimeV2() {
  const payload = {
    schemaVersion: 2,
    status: "published",
    generatedFrom: {
      studioNetworkManifest: {
        path: "assets/collection_covers/manifest.json",
        sha256: SHA,
        fingerprint: SHA,
      },
      peopleManifest: {
        path: "assets/collection_covers/people/manifest.json",
        sha256: SHA,
        fingerprint: SHA,
      },
    },
    counts: {
      companies: 1,
      networks: 1,
      people: 0,
      totalEntities: 2,
      landscapeAssets: 2,
      posterAssets: 1,
      totalAssets: 3,
    },
    formats: {
      company: { landscape: { width: 1200, height: 675 }, poster: null },
      network: { landscape: { width: 1200, height: 675 }, poster: { width: 1000, height: 1500 } },
      person: { landscape: { width: 1200, height: 675 }, poster: { width: 1000, height: 1500 } },
    },
    companies: {
      "1": {
        id: 1,
        name: "Company",
        status: "published",
        landscape: { path: "assets/collection_covers/companies/1.webp", sha256: SHA },
        fallbackUsed: false,
        reviewRequired: false,
      },
    },
    networks: {
      "2": {
        id: 2,
        name: "Network",
        status: "published",
        landscape: { path: "assets/collection_covers/networks/2.webp", sha256: SHA },
        poster: { path: "assets/collection_covers/networks/poster/2.webp", sha256: SHA },
        fallbackUsed: false,
        reviewRequired: false,
      },
    },
    people: {},
  };
  return {
    schemaVersion: payload.schemaVersion,
    status: payload.status,
    fingerprint: calculateLookupFingerprint(payload),
    generatedFrom: payload.generatedFrom,
    counts: payload.counts,
    formats: payload.formats,
    companies: payload.companies,
    networks: payload.networks,
    people: payload.people,
  };
}

test("runtime v2 validates exact network poster shape while companies remain landscape-only", () => {
  const lookup = runtimeV2();
  assert.equal(validateRuntimeLookup(lookup, schemaV2), true);
  assert.deepEqual(Object.keys(lookup.networks["2"]), [
    "id", "name", "status", "landscape", "poster", "fallbackUsed", "reviewRequired",
  ]);
  assert.equal(lookup.formats.company.poster, null);
});

test("runtime schemas are strict and version-specific", () => {
  const lookup = runtimeV2();
  assert.throws(() => validateRuntimeLookup(lookup, schemaV1), /schemaVersion|additional property/i);
  delete lookup.networks["2"].poster;
  lookup.counts.posterAssets = 0;
  lookup.counts.totalAssets = 2;
  lookup.fingerprint = calculateLookupFingerprint(lookup);
  assert.throws(() => validateRuntimeLookup(lookup, schemaV2), /poster is required/i);
});

test("runtime v2 generator derives counts and poster entries from manifest v2", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-runtime-v2-"));
  try {
    const decisionBinding = {
      kind: "poster-background-decision-v1",
      stableKey: "network:2",
      tmdbId: 2,
      orientation: "poster",
      sourceLogoPath: "/network.png",
      sourceLogoSha256: SHA,
      background: "dark",
    };
    const posterRecord = {
      stableKey: "network:2",
      tmdbId: 2,
      name: "Network",
      candidateSha256: SHA,
      candidateBytes: 10,
      background: "dark",
      renderMode: "generated-logo",
      sourceLogoPath: "/network.png",
      sourceSha256: SHA,
      normalizedPixelSha256: SHA,
      decisionBinding,
      ownerApprovalBasis: "owner-approved-strong",
      rendererVersion: "network-poster-proof-renderer-v1",
      presetVersion: "network-poster-variant-b-proof-v1",
    };
    posterRecord.approvalHash = posterApprovalHash({
      decisionBinding,
      outputHash: SHA,
      approvalBasis: posterRecord.ownerApprovalBasis,
      rendererVersion: posterRecord.rendererVersion,
      presetVersion: posterRecord.presetVersion,
    });
    const landscapeManifest = {
      version: "studio-network-canonical-manifest-v1",
      releaseId: "studio-network-v1-2026-07-16",
      publishedAt: "2026-07-16T00:00:00.000Z",
      status: "published",
      entrySchema: "tools/studio-network-batch/schemas/manifest-entry.schema.json",
      approvalStateHash: SHA,
      stagingContentFingerprint: SHA,
      publishedAssetFingerprint: inventoryFingerprint([{ path: "networks/2.webp", bytes: 20, sha256: SHA }]),
      entryCount: 1,
      companyCount: 0,
      networkCount: 1,
      entries: [{
        stable_key: "network:2",
        entity_type: "network",
        tmdb_id: 2,
        name: "Network",
        review_status: "approved",
        output_path: "assets/collection_covers/networks/2.webp",
        output_hash: SHA,
        output_bytes: 20,
      }],
      publicationMetadata: [{
        stableKey: "network:2",
        entityType: "network",
        tmdbId: 2,
        canonicalName: "Network",
        status: "published",
        renderMode: "generated",
        publishPath: "assets/collection_covers/networks/2.webp",
        outputHash: SHA,
        byteCount: 20,
        width: 1200,
        height: 675,
        format: "webp",
      }],
    };
    const manifestV2 = createCanonicalManifestV2({
      landscapeManifest,
      posterRecords: [posterRecord],
      releaseId: "studio-network-posters-v2-2026-07-25",
      publishedAt: "2026-07-25T01:02:03.000Z",
      landscapeInventory: [{ path: "networks/2.webp", bytes: 20, sha256: SHA }],
    });
    const peopleManifest = {
      version: "people-artwork-manifest-v1",
      status: "published",
      ordering: "tmdb-person-id-ascending",
      manifestFingerprint: SHA,
      recordCount: 0,
      landscapeCount: 0,
      posterCount: 0,
      fallbackCount: 0,
      records: [],
    };
    const studioPath = path.join(temporaryRoot, "manifest.json");
    const peoplePath = path.join(temporaryRoot, "people.json");
    await fs.writeFile(studioPath, `${JSON.stringify(manifestV2)}\n`);
    await fs.writeFile(peoplePath, `${JSON.stringify(peopleManifest)}\n`);
    const result = await generateRuntimeLookup({
      repoRoot,
      studioManifestPath: studioPath,
      peopleManifestPath: peoplePath,
      verifyAssets: false,
    });
    assert.equal(result.lookup.schemaVersion, 2);
    assert.deepEqual(result.lookup.counts, {
      companies: 0,
      networks: 1,
      people: 0,
      totalEntities: 1,
      landscapeAssets: 1,
      posterAssets: 1,
      totalAssets: 2,
    });
    assert.deepEqual(Object.keys(result.lookup.networks["2"]), [
      "id", "name", "status", "landscape", "poster", "fallbackUsed", "reviewRequired",
    ]);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

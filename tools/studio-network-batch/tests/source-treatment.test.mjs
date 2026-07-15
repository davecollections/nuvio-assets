import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { bufferFingerprint } from "../src/fingerprints.mjs";
import {
  loadSourceTreatmentConfiguration,
  resolveSourceTreatment,
  sourceTreatmentBackgroundDecision,
  validateSourceTreatmentConfiguration,
} from "../src/source-treatment.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionPreset = JSON.parse(await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"));
const AUTHORISED_KEYS = [
  "company:1742",
  "company:2788",
  "company:3407",
  "company:47208",
  "company:69347",
  "company:80138",
  "company:102867",
];

function textConfiguration(sourceHash) {
  const treatment = {
    stableKey: "company:2788",
    treatmentId: "company-2788__owner-approved-text",
    type: "owner-approved-text",
    canonicalName: "Avex Entertainment",
    originalTmdbLogoPath: "/avex.png",
    originalTmdbSourceHash: sourceHash,
    selectedBackground: "dark",
    text: "Avex Entertainment",
    fontFamily: "Inter",
    ownerDecision: "Owner-approved test text treatment.",
  };
  return {
    version: "test-source-treatment-v1",
    scope: [treatment.stableKey],
    treatments: [treatment],
    byStableKey: new Map([[treatment.stableKey, treatment]]),
  };
}

test("production source treatments are limited to the exact seven authorised keys", async () => {
  const configuration = await loadSourceTreatmentConfiguration(packageRoot, productionPreset);
  assert.deepEqual(configuration.scope, AUTHORISED_KEYS);
  assert.deepEqual(configuration.treatments.map((entry) => entry.stableKey), AUTHORISED_KEYS);
  assert.deepEqual(
    configuration.treatments.filter((entry) => entry.type === "owner-approved-text").map((entry) => entry.stableKey),
    ["company:2788", "company:3407", "company:69347"],
  );
  assert.equal(configuration.byStableKey.has("company:4708"), false);
});

test("tracked manual sources match their configured hashes and dimensions", async () => {
  const configuration = await loadSourceTreatmentConfiguration(packageRoot, productionPreset);
  for (const entry of configuration.treatments.filter((item) => item.type === "manual-source")) {
    const filePath = path.resolve(packageRoot, entry.sourcePath);
    const buffer = await fs.readFile(filePath);
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    assert.equal(bufferFingerprint(buffer), entry.sourceHash, entry.stableKey);
    assert.equal(metadata.width, entry.sourceWidth, entry.stableKey);
    assert.equal(metadata.height, entry.sourceHeight, entry.stableKey);
  }
});

test("canonical name, TMDB logo path, and original source hash changes invalidate a text treatment", async () => {
  const original = Buffer.from("original-source");
  const originalSource = { cachePath: "unused.png", sourceHash: bufferFingerprint(original), url: "https://example.test/logo.png" };
  const configuration = textConfiguration(originalSource.sourceHash);
  const entity = {
    stableKey: "company:2788",
    name: "Avex Entertainment",
    logoPath: "/avex.png",
  };
  const resolved = await resolveSourceTreatment({ packageRoot, configuration, entity, originalSource });
  assert.equal(resolved.renderMode, "text");
  assert.equal(resolved.effectiveSource, null);
  assert.match(resolved.metadata.treatmentHash, /^[a-f0-9]{64}$/);
  await assert.rejects(
    resolveSourceTreatment({ packageRoot, configuration, entity: { ...entity, name: "Avex" }, originalSource }),
    /Canonical name changed/,
  );
  await assert.rejects(
    resolveSourceTreatment({ packageRoot, configuration, entity: { ...entity, logoPath: "/new.png" }, originalSource }),
    /TMDB logo path changed/,
  );
  await assert.rejects(
    resolveSourceTreatment({ packageRoot, configuration, entity, originalSource: { ...originalSource, sourceHash: "0".repeat(64) } }),
    /TMDB source hash changed/,
  );
});

test("safe source crop re-derives the exact configured pixels and hash deterministically", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-source-crop-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const cachePath = path.join(root, "source.png");
  const original = await sharp({ create: { width: 100, height: 80, channels: 4, background: "#FCFCFC" } })
    .composite([{ input: { create: { width: 60, height: 20, channels: 4, background: "#101010" } }, left: 20, top: 30 }])
    .png()
    .toBuffer();
  await fs.writeFile(cachePath, original);
  const cropBounds = { left: 15, top: 25, width: 70, height: 30 };
  const expected = await sharp(original).rotate().extract(cropBounds).png({ compressionLevel: 9 }).toBuffer();
  const treatment = {
    stableKey: "company:47208",
    treatmentId: "company-47208__safe-crop",
    type: "safe-source-crop",
    canonicalName: "OctoArts Films",
    originalTmdbLogoPath: "/octo.png",
    originalTmdbSourceHash: bufferFingerprint(original),
    selectedBackground: "dark",
    sourcePageUrl: "https://www.themoviedb.org/company/47208",
    directAssetUrl: "https://image.tmdb.org/t/p/original/octo.png",
    sourceHash: bufferFingerprint(expected),
    sourceWidth: 70,
    sourceHeight: 30,
    cropBounds,
    threshold: 24,
    padding: 5,
    backgroundRgbaApproximation: [252, 252, 252, 252],
    encoding: "png-compression-9",
    provenanceType: "deterministic-trim-of-current-tmdb-source",
    provenanceConfidence: "high",
    licenceOrRightsNote: "Test deterministic crop.",
    ownerDecision: "Owner-approved test crop.",
  };
  const configuration = validateSourceTreatmentConfiguration({
    version: "test-source-treatment-v1",
    scope: [treatment.stableKey],
    treatments: [treatment],
  });
  configuration.byStableKey = new Map([[treatment.stableKey, treatment]]);
  const options = {
    packageRoot: root,
    configuration,
    entity: { stableKey: treatment.stableKey, name: treatment.canonicalName, logoPath: treatment.originalTmdbLogoPath },
    originalSource: { cachePath, sourceHash: bufferFingerprint(original), url: treatment.directAssetUrl },
  };
  const first = await resolveSourceTreatment(options);
  const second = await resolveSourceTreatment(options);
  assert.equal(first.effectiveSource.sourceHash, treatment.sourceHash);
  assert.equal(second.effectiveSource.sourceHash, treatment.sourceHash);
  assert.deepEqual(first.effectiveSource.input, second.effectiveSource.input);
});

test("source treatment background metadata remains production-versioned and owner-approved", () => {
  const treatment = {
    treatment: { selectedBackground: "dark", ownerDecision: "Owner-approved test treatment." },
    effectiveSource: null,
    metadata: { treatmentHash: "a".repeat(64) },
  };
  const decision = sourceTreatmentBackgroundDecision(treatment, productionPreset);
  assert.equal(decision.selectedBackground, "dark");
  assert.equal(decision.metadata.backgroundDecisionVersion, productionPreset.backgroundDecision.version);
  assert.equal(decision.metadata.backgroundDecisionSource, "owner-approved-source-treatment");
});

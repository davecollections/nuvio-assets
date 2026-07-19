import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LandscapeCropOverrideSourceMismatchError,
  loadLandscapeCropOverrides,
  resolveLandscapeCropOverride,
  validateLandscapeCropOverrides,
} from "../src/people-artwork/landscape-crop-overrides.mjs";
import { cropFor, loadPeopleArtworkPresets } from "../src/people-artwork/renderer.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

test("tracked landscape crop overrides validate as exactly 51 unique active identities", async () => {
  const [document, schema, registry] = await Promise.all([
    readJson(path.join(repoRoot, "data", "people", "landscape-crop-overrides.json")),
    readJson(path.join(repoRoot, "schemas", "landscape-crop-overrides.schema.json")),
    readJson(path.join(repoRoot, "data", "people", "people-registry.json")),
  ]);
  assert.deepEqual(validateLandscapeCropOverrides(document, schema, { registry }), []);
  assert.equal(document.recordCount, 51);
  assert.equal(new Set(document.records.map((record) => record.stableKey)).size, 51);
  assert.equal(new Set(document.records.map((record) => record.tmdbPersonId)).size, 51);
  assert.ok(document.records.every((record) => record.format === "landscape" && record.status === "active"));
});

test("all 51 Alternative A proof bindings retain the approved 594x675 target geometry", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  for (const record of config.records) {
    assert.match(record.approvedProofHash, /^[a-f0-9]{64}$/u);
    assert.match(record.sourceHash, /^[a-f0-9]{64}$/u);
    assert.equal(Math.round(record.cropRectangle.width * record.cropScale.x), 594, record.stableKey);
    assert.equal(Math.round(record.cropRectangle.height * record.cropScale.y), 675, record.stableKey);
    assert.equal(record.cropOffsetX, 504, record.stableKey);
    assert.equal(record.cropOffsetY, 0, record.stableKey);
  }
});

test("override configuration hashing is deterministic over exact tracked bytes", async () => {
  const first = await loadLandscapeCropOverrides({ repoRoot });
  const second = await loadLandscapeCropOverrides({ repoRoot });
  assert.equal(first.configHash, second.configHash);
  assert.match(first.configHash, /^[a-f0-9]{64}$/u);
});

test("a matching override is applied only to landscape", async () => {
  const configuration = await loadLandscapeCropOverrides({ repoRoot });
  const record = configuration.config.records[0];
  const person = { stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, canonicalName: record.canonicalName };
  const source = { available: true, sourceHash: record.sourceHash, profilePathAttempted: record.sourceProfilePath };
  const landscape = resolveLandscapeCropOverride({ person, source, formatId: "landscape", overrideConfiguration: configuration });
  assert.equal(landscape.used, true);
  assert.equal(landscape.record, record);
  const poster = resolveLandscapeCropOverride({ person, source: null, formatId: "poster", overrideConfiguration: null });
  assert.deepEqual(poster, { used: false, status: "not-applicable-format" });
});

test("a source mismatch refuses stale coordinates with a stable review error", async () => {
  const configuration = await loadLandscapeCropOverrides({ repoRoot });
  const record = configuration.config.records[0];
  const person = { stableKey: record.stableKey, tmdbPersonId: record.tmdbPersonId, canonicalName: record.canonicalName };
  assert.throws(
    () => resolveLandscapeCropOverride({ person, source: { available: true, sourceHash: "0".repeat(64), profilePathAttempted: record.sourceProfilePath }, formatId: "landscape", overrideConfiguration: configuration }),
    (error) => error instanceof LandscapeCropOverrideSourceMismatchError && error.code === "crop-override-source-mismatch" && error.cropOverrideStatus === "source-mismatch",
  );
});

test("default crop behaviour and the global landscape preset remain unchanged", async () => {
  const presets = await loadPeopleArtworkPresets();
  const presetRecord = presets.portrait.landscape;
  assert.equal(presetRecord.presetHash, "a94f863b9332332617355fd73265571dc9b3ccf055365674757d76ac2c48faad");
  assert.deepEqual(cropFor({ width: 791, height: 1187, exifOrientation: 1 }, presetRecord.preset, "landscape"), {
    left: 0,
    top: 0,
    width: 791,
    height: 809,
    orientedSourceWidth: 791,
    orientedSourceHeight: 1187,
    retainedAreaFraction: 0.6816,
  });
});

test("renderer policy contains no alternate discovery, generative processing, or mirroring", async () => {
  const [renderer, sourceResolution] = await Promise.all([
    fs.readFile(path.join(packageRoot, "src", "people-artwork", "renderer.mjs"), "utf8"),
    fs.readFile(path.join(packageRoot, "src", "people-artwork", "source-resolution.mjs"), "utf8"),
  ]);
  assert.doesNotMatch(sourceResolution, /person\/images|person-images|search\/person|person\/\{person_id\}/iu);
  assert.doesNotMatch(renderer, /generative|inpaint|outpaint|\.flop\s*\(|\.flip\s*\(/iu);
});

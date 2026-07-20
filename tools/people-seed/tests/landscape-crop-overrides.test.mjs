import assert from "node:assert/strict";
import crypto from "node:crypto";
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

const ORIGINAL_OVERRIDE_IDS = new Set([19, 85, 113, 114, 116, 193, 569, 934, 1230, 1810, 1932, 2282, 3149, 3460, 3490, 3636, 3810, 3967, 4068, 4070, 4111, 4135, 4173, 4512, 4587, 5341, 5469, 5563, 6837, 6905, 6968, 7499, 8487, 8930, 10017, 11160, 11288, 12147, 12446, 15152, 16757, 18277, 19384, 40174, 55636, 59410, 73421, 78029, 83271, 117642, 119589]);
const ORIGINAL_OVERRIDE_RECORDS_HASH = "a88830cb92d652e84d612d1e755c13e1014c6f0b0efd22732f8cef55201dcea5";
const PRE_DIRECTOR_OVERRIDE_RECORDS_HASH = "21a9e9e93e2c7fecc123b01e533488a8782c26202f6220b5ee8d658455b8bf78";
const LATER_ACTOR_EVIDENCE_PACKAGE = "tools/people-seed/.work/people-later-actors-candidate/visual-audit";
const DIRECTOR_EVIDENCE_PACKAGE = "tools/people-seed/.work/people-directors-candidate/visual-review";
const DIRECTOR_OVERRIDE_IDS = [793, 1032, 2226, 3239, 5026, 9956, 15189, 15389, 18738, 24882, 39009, 39012, 45791, 53914, 85637, 138006, 141713, 229931];
const DIRECTOR_OVERRIDE_RECORDS_HASH = "8d6ef848c8fbc5c065a0cf92982497d68214b70921fe8e7c7b4b83e5c99ea3e0";
const REVIEW_ACTOR_EVIDENCE_PACKAGE = "tools/people-seed/.work/people-review-actors-candidate/visual-review/manual-expanded-review";
const REVIEW_ACTOR_OVERRIDE_IDS = [7399, 18072, 25541, 51576, 112561, 1190668, 1373737];
const REVIEW_ACTOR_OVERRIDE_RECORDS_HASH = "86372d8f4f0e0a1ebd0e008fe538c799781c4f7939d0a53de82eab5f6de64757";
const ORIGINAL_147_OVERRIDE_RECORDS_HASH = "f7a3653a55f52b33401c866c68039fbbb012faca5604f3b4e700378a4c506619";

test("tracked landscape crop overrides validate as exactly 154 unique active identities", async () => {
  const [document, schema, registry] = await Promise.all([
    readJson(path.join(repoRoot, "data", "people", "landscape-crop-overrides.json")),
    readJson(path.join(repoRoot, "schemas", "landscape-crop-overrides.schema.json")),
    readJson(path.join(repoRoot, "data", "people", "people-registry.json")),
  ]);
  assert.deepEqual(validateLandscapeCropOverrides(document, schema, { registry }), []);
  assert.equal(document.recordCount, 154);
  assert.equal(new Set(document.records.map((record) => record.stableKey)).size, 154);
  assert.equal(new Set(document.records.map((record) => record.tmdbPersonId)).size, 154);
  assert.ok(document.records.every((record) => record.format === "landscape" && record.status === "active"));
});

test("the original 51 source-bound override records remain value-for-value unchanged", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const originalRecords = config.records.filter((record) => ORIGINAL_OVERRIDE_IDS.has(record.tmdbPersonId));
  assert.equal(originalRecords.length, 51);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(originalRecords)).digest("hex"), ORIGINAL_OVERRIDE_RECORDS_HASH);
});

test("the 78 later-actor Alternative A records remain landscape-only and exactly source-bound", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const laterActorRecords = config.records.filter((record) => record.evidencePackage === LATER_ACTOR_EVIDENCE_PACKAGE);
  assert.equal(laterActorRecords.length, 78);
  assert.ok(laterActorRecords.every((record) => record.format === "landscape" && record.status === "active"));
  assert.ok(laterActorRecords.every((record) => /^\/[^\\]+$/u.test(record.sourceProfilePath)));
  assert.ok(laterActorRecords.every((record) => /^[a-f0-9]{64}$/u.test(record.sourceHash) && /^[a-f0-9]{64}$/u.test(record.approvedProofHash)));
  assert.ok(laterActorRecords.every((record) => record.reason === "avoid-unintended-face-crop" && record.createdFromAuditVersion === "people-landscape-crop-audit-v1"));
});

test("all 129 pre-director override records remain value-for-value unchanged", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const records = config.records.filter((record) => record.evidencePackage !== DIRECTOR_EVIDENCE_PACKAGE && record.evidencePackage !== REVIEW_ACTOR_EVIDENCE_PACKAGE);
  assert.equal(records.length, 129);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"), PRE_DIRECTOR_OVERRIDE_RECORDS_HASH);
});

test("all original 147 crop override records remain serialized value-for-value unchanged", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const records = config.records.filter((record) => record.evidencePackage !== REVIEW_ACTOR_EVIDENCE_PACKAGE);
  assert.equal(records.length, 147);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"), ORIGINAL_147_OVERRIDE_RECORDS_HASH);
});

test("the seven approved review-actor Alternative A records are exact and source-bound", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const records = config.records.filter((record) => record.evidencePackage === REVIEW_ACTOR_EVIDENCE_PACKAGE);
  assert.equal(records.length, 7);
  assert.deepEqual(records.map((record) => record.tmdbPersonId), REVIEW_ACTOR_OVERRIDE_IDS);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"), REVIEW_ACTOR_OVERRIDE_RECORDS_HASH);
  assert.ok(records.every((record) => record.format === "landscape" && record.status === "active"));
  assert.ok(records.every((record) => /^\/[^\\]+$/u.test(record.sourceProfilePath)));
  assert.ok(records.every((record) => /^[a-f0-9]{64}$/u.test(record.sourceHash) && /^[a-f0-9]{64}$/u.test(record.approvedProofHash)));
  assert.ok(records.every((record) => record.reason === "avoid-unintended-face-crop" && record.createdFromAuditVersion === "people-landscape-crop-audit-v1"));
});

test("the 18 approved director Alternative A records remain exact and source-bound", async () => {
  const { config } = await loadLandscapeCropOverrides({ repoRoot });
  const records = config.records.filter((record) => record.evidencePackage === DIRECTOR_EVIDENCE_PACKAGE);
  assert.equal(records.length, 18);
  assert.deepEqual(records.map((record) => record.tmdbPersonId), DIRECTOR_OVERRIDE_IDS);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex"), DIRECTOR_OVERRIDE_RECORDS_HASH);
  assert.ok(records.every((record) => record.format === "landscape" && record.status === "active"));
  assert.ok(records.every((record) => /^\/[^\\]+$/u.test(record.sourceProfilePath)));
  assert.ok(records.every((record) => /^[a-f0-9]{64}$/u.test(record.sourceHash) && /^[a-f0-9]{64}$/u.test(record.approvedProofHash)));
  assert.ok(records.every((record) => record.reason === "avoid-unintended-face-crop" && record.createdFromAuditVersion === "people-landscape-crop-audit-v1"));
});

test("all 154 Alternative A proof bindings retain the approved 594x675 target geometry", async () => {
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
  assert.throws(
    () => resolveLandscapeCropOverride({ person, source: { available: true, sourceHash: record.sourceHash, profilePathAttempted: "/stale-profile-path.jpg" }, formatId: "landscape", overrideConfiguration: configuration }),
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

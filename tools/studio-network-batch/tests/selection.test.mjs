import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { determinePlanMode, parseCliOptions } from "../src/cli-options.mjs";
import { artworkInputFingerprint } from "../src/fingerprints.mjs";
import { readStableKeyArray } from "../src/json-input.mjs";
import { loadSourceData } from "../src/load-source.mjs";
import { readManifest } from "../src/manifest.mjs";
import { buildSelectionPlan } from "../src/selection.mjs";

const fixtureSource = path.resolve("tests/fixtures/source");
let entities;
const eligibility = { version: "test-100", companyMinimumTitleCount: 100, networkMinimumTitleCount: 100 };

test.before(async () => {
  ({ entities } = await loadSourceData(fixtureSource));
});

function explicit(keys, extra = {}) {
  return buildSelectionPlan({ entities, eligibility, mode: "explicit", requestedKeys: keys, ...extra });
}

test("company-ID selection", () => {
  assert.deepEqual(explicit(["company:2"]).selected.map((x) => x.stableKey), ["company:2"]);
});

test("network-ID selection", () => {
  assert.deepEqual(explicit(["network:11"]).selected.map((x) => x.stableKey), ["network:11"]);
});

test("mixed selection is deterministic by entity type then numeric ID", () => {
  assert.deepEqual(explicit(["network:11", "company:3", "company:2", "network:10"]).selected.map((x) => x.stableKey), [
    "company:2", "company:3", "network:10", "network:11",
  ]);
});

test("ID-file selection reads the committed stable-key array", async () => {
  const keys = await readStableKeyArray(path.resolve("tests/fixtures/ids.json"));
  assert.deepEqual(explicit(keys).selected.map((x) => x.stableKey), ["company:2", "network:11"]);
});

test("unknown and malformed keys are reported", () => {
  const plan = explicit(["company:999", "studio:2", "company:not-a-number"]);
  assert.deepEqual(plan.issues.unknownKeys, ["company:999"]);
  assert.deepEqual(plan.issues.malformedKeys, ["studio:2", "company:not-a-number"]);
});

test("ineligible explicit IDs require include-ineligible", () => {
  const excluded = explicit(["company:1"]);
  assert.equal(excluded.selectedCount, 0);
  assert.deepEqual(excluded.issues.ineligibleKeys, ["company:1"]);
  assert.deepEqual(explicit(["company:1"], { includeIneligible: true }).selected.map((x) => x.stableKey), ["company:1"]);
});

test("all selects all and only eligible records", () => {
  const plan = buildSelectionPlan({ entities, eligibility, mode: "all" });
  assert.deepEqual(plan.selected.map((x) => x.stableKey), ["company:2", "company:3", "network:10", "network:11"]);
});

test("proof-of-concept validates configured keys without substitutions", () => {
  const plan = buildSelectionPlan({ entities, eligibility, mode: "proof-of-concept", proofKeys: ["network:11", "company:1", "company:999"] });
  assert.deepEqual(plan.selected.map((x) => x.stableKey), ["network:11"]);
  assert.deepEqual(plan.issues.ineligibleKeys, ["company:1"]);
  assert.deepEqual(plan.issues.unknownKeys, ["company:999"]);
});

test("new without a manifest treats every eligible record as new and says so", () => {
  const plan = buildSelectionPlan({ entities, eligibility, mode: "new", manifestProvided: false });
  assert.equal(plan.selectedCount, 4);
  assert.match(plan.notes[0], /every currently eligible record is treated as new/i);
});

test("new with a fixture manifest selects eligible records absent from it", async () => {
  const manifest = await readManifest(path.resolve("tests/fixtures/manifest.json"));
  const plan = buildSelectionPlan({ entities, eligibility, mode: "new", manifest, manifestProvided: true });
  assert.deepEqual(plan.selected.map((x) => x.stableKey), ["company:3", "network:10", "network:11"]);
  assert.deepEqual(plan.issues.removedKeys, ["network:999"]);
});

test("new-from-state selects only absent eligible records and reports state drift separately", () => {
  const stateDelta = {
    stateRecordCount: 3,
    newEligible: entities.filter((entity) => ["company:3", "network:11"].includes(entity.stableKey)),
    existingOutputIssues: [{ stableKey: "company:2" }],
    changedLogoPaths: [], changedSourceHashes: [], noLongerAutomaticallyEligible: [],
    disappearedFromSource: [], sourceHashUnavailable: [],
  };
  const plan = buildSelectionPlan({ entities, eligibility, mode: "new-from-state", stateDelta });
  assert.deepEqual(plan.selected.map((item) => item.stableKey), ["company:3", "network:11"]);
  assert.deepEqual(plan.issues.existingOutputIssues, ["company:2"]);
  assert.equal(plan.selected.every((item) => item.reasons.includes("absent_from_persistent_state")), true);
});

test("changed comparison selects differing fixture manifest records", async () => {
  const manifest = await readManifest(path.resolve("tests/fixtures/manifest.json"));
  const plan = buildSelectionPlan({ entities, eligibility, mode: "changed", manifest, manifestProvided: true, repoRoot: path.resolve(".") });
  assert.deepEqual(plan.selected.map((x) => x.stableKey), ["company:2"]);
  assert.ok(plan.selected[0].reasons.includes("artwork_input_changed"));
});

test("changed comparison ignores a title-count-only movement", () => {
  const entity = entities.find((item) => item.stableKey === "company:2");
  const rendererVersion = "r1";
  const presetVersion = "p1";
  const manifest = new Map([[entity.stableKey, {
    stable_key: entity.stableKey,
    artwork_input_hash: artworkInputFingerprint({ ...entity, titleCount: 999 }, { rendererVersion, presetVersion }),
    renderer_version: rendererVersion,
    preset_version: presetVersion,
    output_path: "assets/collection_covers/companies/2.webp",
    status: "planned",
  }]]);
  const plan = buildSelectionPlan({ entities, eligibility, mode: "changed", manifest, manifestProvided: true, rendererVersion, presetVersion });
  assert.equal(plan.selectedCount, 0);
});

test("changed comparison reports a generated output that is missing", () => {
  const entity = entities.find((item) => item.stableKey === "company:2");
  const rendererVersion = "r1";
  const presetVersion = "p1";
  const manifest = new Map([[entity.stableKey, {
    stable_key: entity.stableKey,
    artwork_input_hash: artworkInputFingerprint(entity, { rendererVersion, presetVersion }),
    renderer_version: rendererVersion,
    preset_version: presetVersion,
    output_path: "assets/collection_covers/companies/2.webp",
    status: "generated",
  }]]);
  const plan = buildSelectionPlan({ entities, eligibility, mode: "changed", manifest, manifestProvided: true, rendererVersion, presetVersion, repoRoot: path.resolve("tests/fixtures") });
  assert.deepEqual(plan.selected[0].reasons, ["output_missing"]);
});

test("changed requires a comparison manifest", () => {
  assert.throws(() => buildSelectionPlan({ entities, eligibility, mode: "changed" }), /requires --manifest/);
});

test("force is recorded but does not widen selection; planning stays dry-run", () => {
  const plan = explicit(["company:2"], { force: true, dryRun: false });
  assert.equal(plan.selectedCount, 1);
  assert.equal(plan.selected[0].force, true);
  assert.equal(plan.dryRun, false);
});

test("CLI parser supports mixed ID and offline options and rejects conflicting selection modes", () => {
  const options = parseCliOptions(["--company-ids", "33,174", "--network-ids=18,66", "--dry-run", "--offline"]);
  assert.deepEqual(options.companyIds, [33, 174]);
  assert.deepEqual(options.networkIds, [18, 66]);
  assert.equal(options.offline, true);
  assert.equal(determinePlanMode(options), "explicit");
  assert.throws(() => determinePlanMode({ ...options, all: true }), /Conflicting selection modes/);
  const thresholds = parseCliOptions(["--new-from-state", "--company-min-titles", "49", "--network-min-titles=51"]);
  assert.equal(determinePlanMode(thresholds), "new-from-state");
  assert.equal(thresholds.companyMinTitles, 49);
  assert.equal(thresholds.networkMinTitles, 51);
});

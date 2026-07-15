import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { bufferFingerprint } from "../src/fingerprints.mjs";
import { logoCachePath } from "../src/logo-cache.mjs";
import {
  reconcileProductionState,
  verifySelectiveProductionChange,
  writeProductionSnapshot,
} from "../src/production-reconcile.mjs";

const productionPreset = JSON.parse(await fs.readFile(new URL("../presets/production-v1.json", import.meta.url), "utf8"));
const ruleDefinition = JSON.parse(await fs.readFile(new URL("../presets/mixed-contrast-v1.json", import.meta.url), "utf8"));

function entity(id) {
  return {
    entityType: "company",
    tmdbId: id,
    stableKey: `company:${id}`,
    name: `Entity ${id}`,
    titleCount: 100,
    logoPath: `/logo-${id}.png`,
    parentCompany: "",
    originCountry: "",
    headquarters: "",
  };
}

async function fixture(context) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-reconcile-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const preset = structuredClone(productionPreset);
  preset.canvas = { width: 120, height: 68 };
  preset.contactSheets = { columns: 2, rows: 2, thumbnailWidth: 80, thumbnailHeight: 45, labelHeight: 72, gap: 4, margin: 8 };
  const directories = [
    path.join(packageRoot, "config"),
    path.join(packageRoot, "presets"),
    path.join(packageRoot, ".work", "cache", "logos"),
    path.join(packageRoot, ".work", "reports", preset.version),
    path.join(packageRoot, ".work", "staging", preset.version, "companies"),
    path.join(packageRoot, ".work", "plans"),
  ];
  await Promise.all(directories.map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(packageRoot, "presets", "mixed-contrast-v1.json"), JSON.stringify(ruleDefinition));

  const entities = [entity(1), entity(2)];
  const sourceLogo = await sharp({ create: { width: 40, height: 20, channels: 4, background: "#FFFFFF" } }).png().toBuffer();
  const sourceHash = bufferFingerprint(sourceLogo);
  const decisions = entities.map((item, index) => ({
    stableKey: item.stableKey,
    backgroundPreset: index === 0 ? "light" : "dark",
    sourceLogoHash: sourceHash,
    reason: "Owner-reviewed mixed-contrast logo",
    name: item.name,
  }));
  await Promise.all([
    fs.writeFile(path.join(packageRoot, "config", "background-decisions.json"), JSON.stringify(decisions)),
    fs.writeFile(path.join(packageRoot, "config", "background-review-resolutions.json"), JSON.stringify(decisions)),
    fs.writeFile(path.join(packageRoot, "config", "review-reason-resolutions.json"), JSON.stringify({ version: "test-v1", groups: [] })),
  ]);
  for (const item of entities) {
    await fs.writeFile(logoCachePath(path.join(packageRoot, ".work", "cache", "logos"), item.logoPath), sourceLogo);
  }

  const dark = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#08141C" } }).webp().toBuffer();
  const light = await sharp({ create: { width: 120, height: 68, channels: 4, background: "#E4E7E9" } }).webp().toBuffer();
  const outputs = entities.map((item) => path.join(packageRoot, ".work", "staging", preset.version, "companies", `${item.tmdbId}.webp`));
  await Promise.all(outputs.map((outputPath) => fs.writeFile(outputPath, dark)));
  const records = Object.fromEntries(entities.map((item, index) => [`${item.stableKey}|primary`, {
    ...item,
    variantName: "primary",
    status: "generated",
    renderStatus: "generated",
    reviewStatus: index === 0 ? "needs-review" : "unreviewed",
    reviewReasons: index === 0 ? ["unexpectedly-opaque-source-background", "mixed-contrast-background-review"] : [],
    selectedBackground: "dark",
    backgroundPreset: "dark-flat",
    sourceHash,
    sourcePath: logoCachePath(path.join(packageRoot, ".work", "cache", "logos"), item.logoPath),
    artworkInputHash: `input-${index}`,
    rendererVersion: "sharp-renderer-v2",
    presetVersion: preset.version,
    outputPath: outputs[index],
    outputHash: bufferFingerprint(dark),
    outputBytes: dark.length,
    generatedAt: "2026-01-01T00:00:00.000Z",
  }]));
  const statePath = path.join(packageRoot, ".work", "reports", preset.version, "run-state.json");
  await fs.writeFile(statePath, JSON.stringify({ version: 1, entries: records }));
  const companySource = path.join(packageRoot, "companies.json");
  const networkSource = path.join(packageRoot, "networks.json");
  await Promise.all([fs.writeFile(companySource, "[]"), fs.writeFile(networkSource, "[]")]);
  return {
    packageRoot,
    preset,
    entities,
    sourceData: { sourceDirectory: packageRoot, sourceFiles: { company: companySource, network: networkSource }, entities, validationErrors: [] },
    statePath,
    outputs,
    dark,
    light,
  };
}

test("selective change reconciliation preserves full state, retained hashes and mtimes, and reason-level resolution", async (context) => {
  const data = await fixture(context);
  const beforeSnapshotPath = path.join(data.packageRoot, ".work", "plans", "before.json");
  const afterSnapshotPath = path.join(data.packageRoot, ".work", "plans", "after.json");
  const summaryPath = path.join(data.packageRoot, ".work", "plans", "summary.json");
  await writeProductionSnapshot({ packageRoot: data.packageRoot, presetVersion: data.preset.version, outputPath: beforeSnapshotPath });
  const retainedBefore = await fs.stat(data.outputs[1]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await fs.writeFile(data.outputs[0], data.light);
  const state = JSON.parse(await fs.readFile(data.statePath, "utf8"));
  Object.assign(state.entries["company:1|primary"], {
    selectedBackground: "light",
    backgroundPreset: "light-flat",
    outputHash: bufferFingerprint(data.light),
    outputBytes: data.light.length,
  });
  await fs.writeFile(data.statePath, JSON.stringify(state));
  data.sourceData.entities.push(entity(3));

  const reconciled = await reconcileProductionState({
    packageRoot: data.packageRoot,
    preset: data.preset,
    sourceData: data.sourceData,
    selectivelyRegeneratedKeys: ["company:1"],
    eligibility: { version: "test", companyMinimumTitleCount: 100, networkMinimumTitleCount: 100 },
  });
  assert.equal(reconciled.records.length, 2);
  assert.equal(reconciled.summary.metadataOnlyReconciled, 1);
  assert.deepEqual(reconciled.summary.deferredNewEligible.map((item) => item.stableKey), ["company:3"]);
  assert.equal(reconciled.records.every((record) => record.eligibilityTier === "core"), true);
  assert.equal(reconciled.records.every((record) => record.backgroundDecisionVersion === "hybrid-dark-component-v1"), true);
  assert.deepEqual(reconciled.records[0].reviewReasons, ["unexpectedly-opaque-source-background"]);
  assert.equal(reconciled.records[0].mixedContrastReviewResolution.status, "resolved");
  assert.equal(reconciled.summary.reviewReasonResolutions.resolved, 0);
  assert.equal(reconciled.summary.reviewReasonResolutions.staleOutput, 0);
  assert.equal(reconciled.summary.reviewReasonResolutions.staleSource, 0);
  assert.equal((await fs.stat(data.outputs[1])).mtimeMs, retainedBefore.mtimeMs);
  assert.equal(bufferFingerprint(await fs.readFile(data.outputs[1])), bufferFingerprint(data.dark));

  const verified = await verifySelectiveProductionChange({
    packageRoot: data.packageRoot,
    preset: data.preset,
    beforeSnapshotPath,
    afterSnapshotPath,
    summaryPath,
    selectivelyRegeneratedKeys: ["company:1"],
    retainedReviewedKeys: ["company:2"],
    records: reconciled.records,
    configuration: reconciled.configuration,
    reviewResult: { writesFinalAssets: false, canonicalManifestCreated: false },
  });
  assert.equal(verified.selectivelyRegeneratedCount, 1);
  assert.equal(verified.unchangedOutputCount, 1);
  assert.equal(verified.changedFiles[0].contentChanged, true);
  assert.equal(verified.changedFiles[0].mtimeChanged, true);
  assert.equal(verified.finalDecisions[0].regenerated, true);
  assert.equal(verified.finalDecisions[1].regenerated, false);
  await assert.rejects(fs.access(path.join(data.packageRoot, "assets")));
  await assert.rejects(fs.access(path.join(data.packageRoot, "manifest.json")));
});

test("new-key reconciliation verifies an absent-before addition without requiring a background review resolution", async (context) => {
  const data = await fixture(context);
  const beforeSnapshotPath = path.join(data.packageRoot, ".work", "plans", "before-add.json");
  const afterSnapshotPath = path.join(data.packageRoot, ".work", "plans", "after-add.json");
  const summaryPath = path.join(data.packageRoot, ".work", "plans", "add-summary.json");
  const initialState = JSON.parse(await fs.readFile(data.statePath, "utf8"));
  Object.assign(initialState.entries["company:1|primary"], {
    selectedBackground: "light",
    backgroundPreset: "light-flat",
    outputHash: bufferFingerprint(data.light),
    outputBytes: data.light.length,
  });
  await Promise.all([
    fs.writeFile(data.outputs[0], data.light),
    fs.writeFile(data.statePath, JSON.stringify(initialState)),
  ]);
  await writeProductionSnapshot({
    packageRoot: data.packageRoot,
    presetVersion: data.preset.version,
    outputPath: beforeSnapshotPath,
  });

  const addedEntity = entity(3);
  const addedOutputPath = path.join(
    data.packageRoot,
    ".work",
    "staging",
    data.preset.version,
    "companies",
    "3.webp",
  );
  const addedSourcePath = logoCachePath(
    path.join(data.packageRoot, ".work", "cache", "logos"),
    addedEntity.logoPath,
  );
  const sourceLogo = await fs.readFile(logoCachePath(
    path.join(data.packageRoot, ".work", "cache", "logos"),
    data.entities[0].logoPath,
  ));
  await Promise.all([
    fs.writeFile(addedOutputPath, data.dark),
    fs.writeFile(addedSourcePath, sourceLogo),
  ]);
  const state = JSON.parse(await fs.readFile(data.statePath, "utf8"));
  state.entries["company:3|primary"] = {
    ...addedEntity,
    variantName: "primary",
    status: "generated",
    renderStatus: "generated",
    reviewStatus: "unreviewed",
    reviewReasons: [],
    selectedBackground: "dark",
    backgroundPreset: "dark-flat",
    sourceHash: bufferFingerprint(sourceLogo),
    sourcePath: addedSourcePath,
    artworkInputHash: "input-added",
    rendererVersion: "sharp-renderer-v2",
    presetVersion: data.preset.version,
    outputPath: addedOutputPath,
    outputHash: bufferFingerprint(data.dark),
    outputBytes: data.dark.length,
    generatedAt: "2026-01-02T00:00:00.000Z",
  };
  await fs.writeFile(data.statePath, JSON.stringify(state));
  data.sourceData.entities.push(addedEntity);

  const reconciled = await reconcileProductionState({
    packageRoot: data.packageRoot,
    preset: data.preset,
    sourceData: data.sourceData,
    selectivelyRegeneratedKeys: [addedEntity.stableKey],
    eligibility: { version: "test", companyMinimumTitleCount: 100, networkMinimumTitleCount: 100 },
  });
  assert.equal(reconciled.records.length, 3);
  assert.equal(reconciled.summary.metadataOnlyReconciled, 2);

  const verified = await verifySelectiveProductionChange({
    packageRoot: data.packageRoot,
    preset: data.preset,
    beforeSnapshotPath,
    afterSnapshotPath,
    summaryPath,
    selectivelyRegeneratedKeys: [],
    selectivelyAddedKeys: [addedEntity.stableKey],
    retainedReviewedKeys: [],
    records: reconciled.records,
    configuration: reconciled.configuration,
    reviewResult: { writesFinalAssets: false, canonicalManifestCreated: false },
  });
  assert.equal(verified.selectivelyRegeneratedCount, 0);
  assert.equal(verified.selectivelyAddedCount, 1);
  assert.equal(verified.unchangedOutputCount, 2);
  assert.equal(verified.changedFiles.length, 1);
  assert.equal(verified.changedFiles[0].before, null);
  assert.equal(verified.addedRecords[0].stableKey, addedEntity.stableKey);
  assert.deepEqual(verified.finalDecisions, []);
});

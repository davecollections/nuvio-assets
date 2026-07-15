#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkInterAvailability } from "./font-check.mjs";
import { loadEligibilityPolicy } from "./eligibility.mjs";
import { readStableKeyArray } from "./json-input.mjs";
import { loadSourceData } from "./load-source.mjs";
import {
  reconcileProductionState,
  validateProductionState,
  verifySelectiveProductionChange,
  writeProductionSnapshot,
} from "./production-reconcile.mjs";
import { prepareProductionReview } from "./review-prep.mjs";
import { resolveSourceDirectory } from "./source-path.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function parseOptions(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["snapshot", "reconcile", "validate"]).has(command)) {
    throw new Error("Usage: production-reconcile-cli.mjs <snapshot|reconcile|validate> [options]");
  }
  const options = { command, preset: "production-v1" };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const name = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = match[2] ?? rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    options[name] = value;
  }
  return options;
}

function resolvePackagePath(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return path.resolve(packageRoot, value);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", `${options.preset}.json`), "utf8"));
  const eligibility = await loadEligibilityPolicy(packageRoot, { configuration: preset.eligibilityConfiguration });
  if (options.command === "validate") {
    process.stdout.write(`${JSON.stringify(await validateProductionState({ packageRoot, preset }), null, 2)}\n`);
    return;
  }
  if (options.command === "snapshot") {
    const outputPath = resolvePackagePath(options.output, "--output");
    const snapshot = await writeProductionSnapshot({ packageRoot, presetVersion: preset.version, outputPath });
    process.stdout.write(`${JSON.stringify({ outputPath, count: snapshot.count, combinedFingerprint: snapshot.combinedFingerprint, mtimeFingerprint: snapshot.mtimeFingerprint }, null, 2)}\n`);
    return;
  }

  const beforeSnapshotPath = resolvePackagePath(options.beforeSnapshot, "--before-snapshot");
  const changedIdsPath = options.changedIds ? resolvePackagePath(options.changedIds, "--changed-ids") : null;
  const addedIdsPath = options.addedIds ? resolvePackagePath(options.addedIds, "--added-ids") : null;
  if (!changedIdsPath && !addedIdsPath) throw new Error("At least one of --changed-ids or --added-ids is required.");
  const retainedIdsPath = resolvePackagePath(options.retainedIds, "--retained-ids");
  const afterSnapshotPath = resolvePackagePath(options.afterSnapshot, "--after-snapshot");
  const summaryPath = resolvePackagePath(options.summary, "--summary");
  const [selectivelyRegeneratedKeys, selectivelyAddedKeys, retainedReviewedKeys] = await Promise.all([
    changedIdsPath ? readStableKeyArray(changedIdsPath, "selectively regenerated IDs") : [],
    addedIdsPath ? readStableKeyArray(addedIdsPath, "selectively added IDs") : [],
    readStableKeyArray(retainedIdsPath, "retained reviewed IDs"),
  ]);
  const pendingOpaqueKeys = options.pendingOpaqueIds
    ? await readStableKeyArray(resolvePackagePath(options.pendingOpaqueIds, "--pending-opaque-ids"), "pending opaque IDs")
    : [];
  const expectedPendingOpaqueCount = options.expectedPendingOpaqueCount === undefined
    ? null
    : Number.parseInt(options.expectedPendingOpaqueCount, 10);
  if (expectedPendingOpaqueCount !== null && (!Number.isInteger(expectedPendingOpaqueCount) || expectedPendingOpaqueCount < 0)) {
    throw new Error("--expected-pending-opaque-count must be a non-negative integer.");
  }
  const changedAndRetained = selectivelyRegeneratedKeys.filter((stableKey) => retainedReviewedKeys.includes(stableKey));
  const addedAndRetained = selectivelyAddedKeys.filter((stableKey) => retainedReviewedKeys.includes(stableKey));
  const changedAndAdded = selectivelyRegeneratedKeys.filter((stableKey) => selectivelyAddedKeys.includes(stableKey));
  const overlap = [...new Set([...changedAndRetained, ...addedAndRetained, ...changedAndAdded])];
  if (overlap.length) throw new Error(`Changed, added, and retained ID plans overlap: ${overlap.join(", ")}`);
  const source = resolveSourceDirectory({ sourceDir: options.sourceDir, repoRoot });
  const sourceData = await loadSourceData(source.directory);
  const reconciliation = await reconcileProductionState({
    packageRoot,
    preset,
    sourceData,
    selectivelyRegeneratedKeys: [...selectivelyRegeneratedKeys, ...selectivelyAddedKeys],
    eligibility,
  });
  const fontCheckResult = await checkInterAvailability({ requestedFamily: preset.fallbackText?.requiredFontFamily ?? "Inter" });
  const reviewResult = await prepareProductionReview({ packageRoot, preset, fontCheckResult });
  const verification = await verifySelectiveProductionChange({
    packageRoot,
    preset,
    beforeSnapshotPath,
    afterSnapshotPath,
    summaryPath,
    selectivelyRegeneratedKeys,
    selectivelyAddedKeys,
    retainedReviewedKeys,
    records: reconciliation.records,
    configuration: reconciliation.configuration,
    reviewResult,
    verificationSheetPath: options.verificationSheet
      ? resolvePackagePath(options.verificationSheet, "--verification-sheet")
      : null,
    pendingOpaqueKeys,
    pendingOpaqueOutputDir: options.pendingOpaqueOutputDir
      ? resolvePackagePath(options.pendingOpaqueOutputDir, "--pending-opaque-output-dir")
      : null,
    expectedPendingOpaqueCount,
  });
  process.stdout.write(`${JSON.stringify({
    reportRecords: reconciliation.records.length,
    metadataOnlyReconciled: reconciliation.summary.metadataOnlyReconciled,
    selectivelyRegenerated: verification.selectivelyRegeneratedCount,
    selectivelyAdded: verification.selectivelyAddedCount,
    unchangedOutputs: verification.unchangedOutputCount,
    beforeFingerprint: verification.before.combinedFingerprint,
    afterFingerprint: verification.after.combinedFingerprint,
    verificationSheet: verification.verificationSheet.outputPath,
    pendingOpaqueCount: verification.pendingOpaque?.count ?? null,
    summaryPath,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

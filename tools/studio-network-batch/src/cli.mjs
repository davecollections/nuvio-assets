#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAudit, formatAudit } from "./audit.mjs";
import { parseCliOptions, determinePlanMode } from "./cli-options.mjs";
import { loadSourceData } from "./load-source.mjs";
import { readManifest } from "./manifest.mjs";
import { readStableKeyArray } from "./json-input.mjs";
import { buildSelectionPlan, formatSelectionPlan } from "./selection.mjs";
import { resolveSourceDirectory } from "./source-path.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "audit" && command !== "plan") {
    throw new Error("Usage: node src/cli.mjs <audit|plan> [options]");
  }
  const options = parseCliOptions(args);
  if (command === "audit") {
    const planOnly = options.all || options.proofOfConcept || options.newRecords || options.changedRecords ||
      options.companyIds.length || options.networkIds.length || options.idsFile || options.manifest;
    if (planOnly) throw new Error("Selection and manifest options are only valid for plan.");
  }
  const source = resolveSourceDirectory({ sourceDir: options.sourceDir, repoRoot });
  const sourceData = await loadSourceData(source.directory);

  if (command === "audit") {
    const audit = buildAudit(sourceData);
    process.stdout.write(`${options.json ? JSON.stringify(audit, null, 2) : formatAudit(audit)}\n`);
    return;
  }

  const mode = determinePlanMode(options);
  const requestedKeys = [
    ...options.companyIds.map((id) => `company:${id}`),
    ...options.networkIds.map((id) => `network:${id}`),
  ];
  if (options.idsFile) {
    requestedKeys.push(...await readStableKeyArray(path.resolve(options.idsFile), "IDs file"));
  }
  const proofKeys = await readStableKeyArray(
    path.join(packageRoot, "presets/proof-of-concept-ids.json"),
    "proof-of-concept configuration",
  );
  const manifestProvided = Boolean(options.manifest);
  const manifest = manifestProvided ? await readManifest(path.resolve(options.manifest)) : new Map();
  const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets/poc-v1.json"), "utf8"));
  const plan = buildSelectionPlan({
    entities: sourceData.entities,
    validationErrors: sourceData.validationErrors,
    mode,
    requestedKeys,
    proofKeys,
    manifest,
    manifestProvided,
    includeIneligible: options.includeIneligible,
    force: options.force,
    dryRun: true,
    rendererVersion: "renderer-not-implemented",
    presetVersion: preset.version,
    repoRoot,
  });
  process.stdout.write(`${options.json ? JSON.stringify(plan, null, 2) : formatSelectionPlan(plan)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

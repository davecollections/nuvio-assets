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
import { generateBatch, formatGenerationSummary } from "./generator.mjs";
import { DEFAULT_PRESET_VERSION, RENDERER_VERSION } from "./constants.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!new Set(["audit", "plan", "generate"]).has(command)) {
    throw new Error("Usage: node src/cli.mjs <audit|plan|generate> [options]");
  }
  const options = parseCliOptions(args);
  if (command === "audit") {
    const planOnly = options.all || options.proofOfConcept || options.newRecords || options.changedRecords ||
      options.companyIds.length || options.networkIds.length || options.idsFile || options.manifest ||
      options.force || options.dryRun || options.includeIneligible || options.refreshLogoCache || options.offline || options.preset;
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
  const presetPath = resolvePresetPath(options.preset, mode);
  const preset = JSON.parse(await fs.readFile(presetPath, "utf8"));
  validatePreset(preset, presetPath);
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
    dryRun: command === "plan" || options.dryRun,
    rendererVersion: RENDERER_VERSION,
    presetVersion: preset.version,
    repoRoot,
  });
  if (command === "plan") {
    process.stdout.write(`${options.json ? JSON.stringify(plan, null, 2) : formatSelectionPlan(plan)}\n`);
    return;
  }
  const result = await generateBatch({
    plan,
    preset,
    packageRoot,
    sourceData,
    dryRun: options.dryRun,
    force: options.force,
    refreshLogoCache: options.refreshLogoCache,
    offline: options.offline,
  });
  process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatGenerationSummary(result)}\n`);
}

function resolvePresetPath(option, mode) {
  if (!option) {
    const defaultVersion = mode === "proof-of-concept" ? "poc-v1" : DEFAULT_PRESET_VERSION;
    return path.join(packageRoot, "presets", `${defaultVersion}.json`);
  }
  if (option.includes("/") || option.includes("\\") || option.toLowerCase().endsWith(".json")) {
    return path.resolve(option);
  }
  return path.join(packageRoot, "presets", `${option}.json`);
}

function validatePreset(preset, presetPath) {
  if (!preset?.version || !preset?.canvas?.width || !preset?.canvas?.height ||
      !preset?.logo?.maximumVisibleWidthPercent || !preset?.logo?.maximumVisibleHeightPercent ||
      !preset?.output?.quality) {
    throw new Error(`Preset is missing required generation settings: ${presetPath}`);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEligibilityPolicy } from "./eligibility.mjs";
import { loadSourceData } from "./load-source.mjs";
import { resolveSourceDirectory } from "./source-path.mjs";
import { readPersistentProductionState } from "./state-delta.mjs";
import { captureProtectedState, runThresholdAudit } from "./threshold-audit.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function parseMinimum(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} requires a non-negative integer.`);
  return number;
}

function parseOptions(argv) {
  const options = { preset: "production-v1", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    const match = /^(--(?:source-dir|preset|company-min-titles|network-min-titles))(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown option: ${argument}`);
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${match[1]} requires a value.`);
    const key = match[1].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = key.endsWith("MinTitles") ? parseMinimum(value, match[1]) : value;
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", `${options.preset}.json`), "utf8"));
  const eligibility = await loadEligibilityPolicy(packageRoot, {
    configuration: preset.eligibilityConfiguration,
    companyMinimumTitleCount: options.companyMinTitles,
    networkMinimumTitleCount: options.networkMinTitles,
  });
  const source = resolveSourceDirectory({ sourceDir: options.sourceDir, repoRoot });
  const sourceData = await loadSourceData(source.directory);
  const persistent = await readPersistentProductionState(packageRoot, preset.version);
  const seedConfiguration = JSON.parse(await fs.readFile(path.join(packageRoot, "config", "recognisability-seed.json"), "utf8"));
  const beforeProtectedState = await captureProtectedState(packageRoot, preset.version);
  const result = await runThresholdAudit({
    packageRoot,
    sourceData,
    eligibility,
    preset,
    stateRecords: persistent.records,
    seedConfiguration,
    beforeProtectedState,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    "Nuvio eligibility-50 audit",
    `Eligible: ${result.summary.eligibleTotals.companies} companies; ${result.summary.eligibleTotals.networks} networks; ${result.summary.eligibleTotals.combined} combined`,
    `New: ${result.summary.delta.newCompanies} companies; ${result.summary.delta.newNetworks} networks; ${result.summary.delta.newCombined} combined`,
    `Missing-logo new records: ${result.summary.delta.newMissingLogo}`,
    `Exact-logo reuse records: ${result.summary.delta.duplicateReuse}`,
    `Protected staged files: ${result.summary.preservation.after.stagingCount}; content/mtime unchanged: ${result.summary.preservation.contentFingerprintUnchanged}/${result.summary.preservation.mtimeFingerprintUnchanged}`,
    `Reports: ${result.reportsRoot}`,
    "Artwork generated: no; network requests: 0",
  ].join("\n") + "\n");
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

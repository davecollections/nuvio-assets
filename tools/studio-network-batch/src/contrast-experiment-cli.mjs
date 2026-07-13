#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runContrastExperiment } from "./contrast-experiment.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function parseOptions(argv) {
  const result = { preset: "production-v1", reuseAnalysis: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--preset" || argument === "--source-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      result[argument === "--preset" ? "preset" : "sourceDir"] = value;
      index += 1;
    } else if (argument.startsWith("--preset=")) result.preset = argument.slice(9);
    else if (argument.startsWith("--source-dir=")) result.sourceDir = argument.slice(13);
    else if (argument === "--reuse-analysis") result.reuseAnalysis = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return result;
}

const options = parseOptions(process.argv.slice(2));
runContrastExperiment({ packageRoot, repoRoot, presetName: options.preset, sourceDir: options.sourceDir, reuseAnalysis: options.reuseAnalysis })
  .then((summary) => {
    const impact = summary.fullBatchImpact;
    process.stdout.write([
      `Mixed-contrast experiment: ${summary.experimentVersion}`,
      `Analysed: ${impact.totalLogoBearing} logo-bearing records`,
      `Candidates corrected: ${summary.recommendedRule.candidateCorrectionCount}/${summary.candidates.length}`,
      `Control changes: ${summary.recommendedRule.controlChangeCount}/${summary.controls.length}`,
      `Projected: ${impact.unchanged} unchanged; ${impact.switchDarkToLight} dark->light; ${impact.switchLightToDark} light->dark; ${impact.reviewOnly} review-only`,
      `Candidate sheet: ${summary.contactSheets.candidates.outputPath}`,
      `Control sheet: ${summary.contactSheets.controls.outputPath}`,
      `Projected-change sheet: ${summary.contactSheets.projectedChanges.outputPath}`,
    ].join("\n") + "\n");
  })
  .catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });

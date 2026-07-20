import fs from "node:fs/promises";
import path from "node:path";

import {
  REPO_ROOT,
  REPRESENTATIVE_REPORT_PATH,
  RUNTIME_LOOKUP_PATH,
  createRepresentativeReport,
  generateRuntimeLookup,
  runtimeSummary,
  serialiseLookup,
  validateRuntimeFile,
  writeIfChanged,
} from "./runtime-lookup.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function resolveOutput(value, fallback) {
  return path.resolve(process.cwd(), value ?? fallback);
}

async function build() {
  const outputPath = resolveOutput(optionValue("--output"), path.join(REPO_ROOT, ...RUNTIME_LOOKUP_PATH.split("/")));
  const reportPath = resolveOutput(optionValue("--report"), path.join(REPO_ROOT, ...REPRESENTATIVE_REPORT_PATH.split("/")));
  const { lookup, assetCount } = await generateRuntimeLookup();
  const fileResult = await writeIfChanged(outputPath, serialiseLookup(lookup));
  const reportResult = await writeIfChanged(reportPath, `${JSON.stringify(createRepresentativeReport(lookup), null, 2)}\n`);
  console.log(JSON.stringify({
    ...runtimeSummary(lookup, fileResult),
    outputPath,
    assetCount,
    representativeReport: { path: reportPath, ...reportResult },
  }, null, 2));
}

async function validate() {
  const lookupPath = resolveOutput(optionValue("--lookup"), path.join(REPO_ROOT, ...RUNTIME_LOOKUP_PATH.split("/")));
  const { lookup, assetCount, fileResult } = await validateRuntimeFile({ lookupPath });
  console.log(JSON.stringify({
    ...runtimeSummary(lookup, fileResult),
    lookupPath,
    assetCount,
    deterministicSourceParity: true,
  }, null, 2));
}

const command = process.argv[2];
if (!new Set(["build", "validate"]).has(command)) {
  console.error("Usage: node src/cli.mjs <build|validate> [--output <path>] [--report <path>] [--lookup <path>]");
  process.exitCode = 1;
} else {
  try {
    await (command === "build" ? build() : validate());
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}

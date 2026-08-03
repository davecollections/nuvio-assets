#!/usr/bin/env node
import path from "node:path";

import {
  acquireFullGenerationSources,
  buildFullGenerationCandidates,
  generateFullGenerationReviewPackage,
  initialiseFullGenerationWorkspace,
  refreshMissingProfileMetadata,
  renderFullGenerationPortraits,
  renderFullGenerationTitleLogos,
  updateActualAtomicPublicationPlan,
  validateFullGeneration,
  validateFullGenerationPhysicalFiles,
} from "../src/people-v3-full-generation.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "../src/people-artwork/runtime-dependencies.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArguments(argv) {
  const options = { mode: null, runRoot: null, generatedAt: null, help: false };
  const modes = new Map([
    ["--init", "init"],
    ["--refresh-missing", "refresh"],
    ["--acquire-sources", "acquire"],
    ["--render-portraits", "portraits"],
    ["--render-title-logos", "titles"],
    ["--build-candidates", "candidates"],
    ["--physical-validation", "physical"],
    ["--review-package", "review"],
    ["--validate", "validate"],
    ["--update-plan", "plan"],
    ["--all", "all"],
  ]);
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (modes.has(argument)) {
      assert(!options.mode, "Select exactly one full-generation mode.");
      options.mode = modes.get(argument);
    } else if (argument === "--run-root") { options.runRoot = take(index, argument); index += 1; }
    else if (argument === "--generated-at") { options.generatedAt = take(index, argument); index += 1; }
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown full-generation argument: ${argument}`);
  }
  return options;
}

function help() {
  return `People v3 ignored full-generation staging

Usage:
  node scripts/people-v3-full-generation.mjs <mode> --run-root tools/people-seed/.work/people-v3-full-generation/run-YYYYMMDDTHHMMSSZ

Modes:
  --init                 Create the unique resumable workspace and protected baseline
  --refresh-missing      Refresh the 167 missing profile paths by exact TMDB Person ID
  --acquire-sources      Acquire/validate exact original-resolution TMDB profile sources
  --render-portraits     Render the 663 staged Poster/Landscape candidate pairs
  --render-title-logos   Render and replay all 1,480 production-locked title logos
  --build-candidates     Build People, runtime and presentation manifest candidates
  --physical-validation Validate all existing and candidate physical files
  --review-package       Build complete paginated owner-review sheets and exception reports
  --validate             Run complete staged-candidate and protected-parity validation
  --update-plan          Write the actual-hash atomic-publication plan and stop before publication
  --all                  Run all stages in order; safe to resume

TMDB details refresh reads TMDB_API_READ_TOKEN, TMDB_READ_ACCESS_TOKEN, or TMDB_API_KEY from the process environment. Credential values are never written.
`;
}

function summary(mode, result) {
  if (mode === "init") return { mode, runRoot: result.root, workspace: result.workspace };
  if (mode === "refresh") return { mode, runRoot: result.context.root, ...result.report };
  if (mode === "acquire") return { mode, runRoot: result.context.root, ...result.report };
  if (mode === "portraits") return { mode, runRoot: result.context.root, ...result.report, records: undefined, unresolved: result.report.unresolved };
  if (mode === "titles") return { mode, runRoot: result.context.root, replayRoot: result.replayRoot, personCount: result.report.personCount, byteIdentical: result.report.byteIdentical, metadataIdentical: result.report.metadataIdentical };
  if (mode === "candidates") return { mode, runRoot: result.context.root, report: result.report };
  if (mode === "physical") return { mode, runRoot: result.context.root, valid: result.report.valid, portraitRecordCount: result.report.portraitRecordCount, titleLogoRecordCount: result.report.titleLogoRecordCount };
  if (mode === "review") return { mode, runRoot: result.context.root, reportCounts: result.report.reportCounts, groups: result.groups };
  if (mode === "validate") return { mode, runRoot: result.context.root, ...result.report };
  if (mode === "plan") return { mode, runRoot: result.context.root, planFingerprint: result.plan.planFingerprint, growth: result.growth };
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(help()); return; }
  assert(options.mode, "Select a full-generation mode. Use --help for details.");
  assert(options.runRoot, "--run-root is required.");
  const runRoot = path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.runRoot);
  let result;
  if (options.mode === "init") result = await initialiseFullGenerationWorkspace({ runRoot, generatedAt: options.generatedAt || new Date().toISOString() });
  else if (options.mode === "refresh") result = await refreshMissingProfileMetadata({ runRoot });
  else if (options.mode === "acquire") result = await acquireFullGenerationSources({ runRoot });
  else if (options.mode === "portraits") result = await renderFullGenerationPortraits({ runRoot });
  else if (options.mode === "titles") result = await renderFullGenerationTitleLogos({ runRoot });
  else if (options.mode === "candidates") result = await buildFullGenerationCandidates({ runRoot });
  else if (options.mode === "physical") result = await validateFullGenerationPhysicalFiles({ runRoot });
  else if (options.mode === "review") result = await generateFullGenerationReviewPackage({ runRoot });
  else if (options.mode === "validate") result = await validateFullGeneration({ runRoot });
  else if (options.mode === "plan") result = await updateActualAtomicPublicationPlan({ runRoot });
  else {
    await initialiseFullGenerationWorkspace({ runRoot, generatedAt: options.generatedAt || new Date().toISOString() }).catch((error) => { if (!/already exists/u.test(error.message)) throw error; });
    await refreshMissingProfileMetadata({ runRoot });
    await acquireFullGenerationSources({ runRoot });
    await renderFullGenerationPortraits({ runRoot });
    await renderFullGenerationTitleLogos({ runRoot });
    await buildFullGenerationCandidates({ runRoot });
    await validateFullGenerationPhysicalFiles({ runRoot });
    await generateFullGenerationReviewPackage({ runRoot });
    await validateFullGeneration({ runRoot });
    result = await updateActualAtomicPublicationPlan({ runRoot });
    options.mode = "plan";
  }
  process.stdout.write(`${JSON.stringify(summary(options.mode, result), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

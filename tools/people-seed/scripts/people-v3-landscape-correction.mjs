#!/usr/bin/env node
import path from "node:path";

import {
  buildPeopleV3LandscapeCorrectionCandidates,
  buildPeopleV3LandscapeCorrectionPhysicalInventory,
  generatePeopleV3LandscapeCorrectionReviews,
  renderPeopleV3LandscapeCorrection,
  updatePeopleV3LandscapeCorrectionPlan,
  validatePeopleV3LandscapeCorrection,
} from "../src/people-v3-landscape-rerender.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "../src/people-artwork/runtime-dependencies.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parsePeopleV3LandscapeCorrectionArguments(argv) {
  const options = { mode: null, runRoot: null, help: false };
  const modes = new Map([
    ["--render", "render"],
    ["--build-candidates", "build"],
    ["--review", "review"],
    ["--physical-inventory", "physical"],
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
      assert(!options.mode, "Select exactly one Landscape correction mode.");
      options.mode = modes.get(argument);
    } else if (argument === "--run-root") {
      options.runRoot = take(index, argument);
      index += 1;
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown Landscape correction argument: ${argument}`);
  }
  return options;
}

const HELP = `People v3 ignored Landscape correction staging

Usage:
  node scripts/people-v3-landscape-correction.mjs <mode> --run-root tools/people-seed/.work/people-v3-full-generation/run-YYYYMMDDTHHMMSSZ

Modes:
  --render              Render only the 663 net-new Landscapes twice with exact-override precedence
  --build-candidates    Rebuild ignored People/runtime candidates and byte-copy the presentation candidate
  --review              Generate all-v3, before/after, chin-zone and residual-risk review sheets
  --physical-inventory  Validate and inventory 2,960 portrait and 1,480 title-logo candidate files
  --validate            Validate replay, manifests, protected bytes and review completeness
  --update-plan         Write the corrected actual-hash atomic-publication plan
  --all                 Run every stage in order and stop before publication

All modes are offline and write only beneath the existing ignored full-generation workspace.
They never render Posters or title logos and never write permanent artwork or manifests.
`;

function summary(mode, result) {
  if (mode === "render") return { mode, reportPath: result.reportPath, counts: result.report.counts, deterministicReplay: result.report.deterministicReplay };
  if (mode === "build") return { mode, bundle: result.report };
  if (mode === "review") return { mode, review: result.report };
  if (mode === "physical") return { mode, reportPath: result.reportPath, valid: result.report.valid, counts: result.report.counts };
  if (mode === "validate") return { mode, reportPath: result.reportPath, valid: result.report.valid, checks: result.report.checks };
  if (mode === "plan") return { mode, planPath: result.planPath, planFingerprint: result.plan.planFingerprint, growth: result.plan.actualGrowth };
  return result;
}

async function main() {
  const options = parsePeopleV3LandscapeCorrectionArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  assert(options.mode, "Select one Landscape correction mode. Use --help for details.");
  assert(options.runRoot, "--run-root is required.");
  const runRoot = path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.runRoot);
  let result;
  if (options.mode === "render") result = await renderPeopleV3LandscapeCorrection({ runRoot });
  else if (options.mode === "build") result = await buildPeopleV3LandscapeCorrectionCandidates({ runRoot });
  else if (options.mode === "review") result = await generatePeopleV3LandscapeCorrectionReviews({ runRoot });
  else if (options.mode === "physical") result = await buildPeopleV3LandscapeCorrectionPhysicalInventory({ runRoot });
  else if (options.mode === "validate") result = await validatePeopleV3LandscapeCorrection({ runRoot });
  else if (options.mode === "plan") result = await updatePeopleV3LandscapeCorrectionPlan({ runRoot });
  else {
    await renderPeopleV3LandscapeCorrection({ runRoot });
    await buildPeopleV3LandscapeCorrectionCandidates({ runRoot });
    await generatePeopleV3LandscapeCorrectionReviews({ runRoot });
    await buildPeopleV3LandscapeCorrectionPhysicalInventory({ runRoot });
    await validatePeopleV3LandscapeCorrection({ runRoot });
    result = await updatePeopleV3LandscapeCorrectionPlan({ runRoot });
    options.mode = "plan";
  }
  process.stdout.write(`${JSON.stringify(summary(options.mode, result), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

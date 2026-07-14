import path from "node:path";
import { fileURLToPath } from "node:url";

import { runEligibility50ReviewFocus } from "./review-focus.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

runEligibility50ReviewFocus({ packageRoot })
  .then((result) => {
    process.stdout.write(`${JSON.stringify({
      focusRoot: result.focusRoot,
      contrastCandidates: result.contrastCandidates.length,
      resolutionRecords: result.resolution.findings.length,
      fallbackPopulation: result.fallback.summary.population,
      fallbackSample: result.fallback.summary.selectedCount,
      opaqueCounts: result.opaque.counts,
      proposedActionCounts: result.actions.counts,
      preservation: result.preservation,
    }, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });

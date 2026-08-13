import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertArtworkMapCheck, checkArtworkMap } from "./artwork-map.mjs";
import { checkRegistry, refreshRegistry } from "./registry.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function usage() {
  return [
    "Usage:",
    "  node src/cli.mjs check",
    "  node src/cli.mjs artwork-check",
    "  node src/cli.mjs refresh [--check]",
  ].join("\n");
}

function refreshReport(result, writeRequested) {
  return {
    mode: writeRequested ? "refresh-write" : "refresh-check",
    upstreamRequestCount: result.requestCount,
    sourceCounts: result.sourceCounts,
    canonicalCounts: result.canonicalCounts,
    mapOnlyRegionCodes: result.diagnostics.mapOnlyRegionCodes,
    crossMediaIdentityConflicts: result.identityConflictCount,
    canonicalByteSize: result.canonicalByteSize,
    deterministicByteParity: result.deterministicByteParity,
    changed: result.changed,
    wrote: result.wrote,
    semanticChanges: result.changeSummary,
  };
}

async function main() {
  const [command, ...options] = process.argv.slice(2);
  if (command === "check" && options.length === 0) {
    process.stdout.write(`${JSON.stringify({ mode: "check", ...(await checkRegistry({ repoRoot })) }, null, 2)}\n`);
    return;
  }
  if (command === "artwork-check" && options.length === 0) {
    const report = await checkArtworkMap({ repoRoot });
    process.stdout.write(`${JSON.stringify({ mode: "artwork-check", ...report }, null, 2)}\n`);
    assertArtworkMapCheck(report);
    return;
  }
  if (command === "refresh" && (options.length === 0 || (options.length === 1 && options[0] === "--check"))) {
    const writeRequested = options[0] !== "--check";
    const result = await refreshRegistry({
      repoRoot,
      serviceToken: process.env.NUVIO_PEOPLE_SERVICE_TOKEN,
      write: writeRequested,
    });
    process.stdout.write(`${JSON.stringify(refreshReport(result, writeRequested), null, 2)}\n`);
    return;
  }
  throw new Error(usage());
}

main().catch((error) => {
  process.stderr.write(`Watch Provider registry error: ${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPeopleFoundation } from "./people-validation.mjs";
import { writeRenderMetadata } from "./people-artwork/metadata.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { parseRendererArguments, RENDERER_HELP, selectPeople } from "./people-artwork/selection.mjs";
import { resolveApprovedProfile } from "./people-artwork/source-resolution.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

async function main() {
  const options = parseRendererArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(RENDERER_HELP);
    return;
  }
  if (!options.dryRun && !options.outputDir) throw new Error("--output-dir is required unless --dry-run is used.");
  if (!options.dryRun && !options.sourceCache) throw new Error("--source-cache is required unless --dry-run is used.");
  const foundation = await readPeopleFoundation(repoRoot);
  const decisions = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "people", "portrait-source-decisions.json"), "utf8"));
  const selected = await selectPeople({
    registry: foundation.registry,
    actors: foundation.actors,
    directors: foundation.directors,
    stableKeys: options.stableKeys,
    stableKeyFile: options.stableKeyFile,
    seedPath: options.seedPath,
    tier: options.tier,
    repoRoot,
  });
  if (options.dryRun) {
    const people = selected.people.map((person) => {
      const resolution = resolveApprovedProfile(person, decisions);
      return {
        ...person,
        resolvedProfilePath: resolution.profilePath,
        sourceDecision: resolution.sourceDecision,
        wouldUseFallbackWithoutProfilePath: resolution.profilePath === null || resolution.profilePath === undefined || String(resolution.profilePath).trim() === "",
      };
    });
    process.stdout.write(`${JSON.stringify({ dryRun: true, acquisitionPerformed: false, writesPerformed: false, offline: true, networkOptInIgnoredForDryRun: options.allowNetwork, format: options.format, selection: selected.selection, people }, null, 2)}\n`);
    return;
  }
  const outputDir = path.resolve(options.outputDir);
  const result = await renderPeopleArtwork({
    people: selected.people,
    decisions,
    sourceCache: path.resolve(options.sourceCache),
    outputDir,
    format: options.format,
    offline: options.offline,
    fontDirectory: options.fontDirectory,
  });
  const metadata = await writeRenderMetadata({ metadata: result.metadata, outputDir });
  process.stdout.write(`${JSON.stringify({
    valid: true,
    offline: result.offline,
    selection: selected.selection,
    outputs: result.metadata.recordCount,
    portraitOutputs: result.metadata.records.filter((item) => !item.fallbackUsed).length,
    fallbackOutputs: result.metadata.records.filter((item) => item.fallbackUsed).length,
    metadata,
    networkAccounting: result.networkAccounting,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

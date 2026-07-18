#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPeopleFoundation } from "./people-validation.mjs";
import { validatePeopleArtworkConfiguration } from "./people-artwork-validation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

const foundation = await readPeopleFoundation(repoRoot);
const result = await validatePeopleArtworkConfiguration({ repoRoot, registry: foundation.registry });
if (result.errors.length) {
  process.stderr.write(`People artwork configuration validation failed:\n${result.errors.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ valid: true, ...result.summary }, null, 2)}\n`);
}

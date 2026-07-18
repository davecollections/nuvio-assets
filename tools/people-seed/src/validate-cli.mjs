#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  readPeopleFoundation,
  validateChangedPaths,
  validatePeopleAssetBoundary,
  validatePeopleFoundation,
} from "./people-validation.mjs";
import { validatePeopleArtworkConfiguration } from "./people-artwork-validation.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function statusPaths(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const value = line.slice(3).trim();
    return value.includes(" -> ") ? value.split(" -> ").at(-1) : value;
  });
}

const foundation = await readPeopleFoundation(repoRoot);
const result = validatePeopleFoundation(foundation);
const assetErrors = await validatePeopleAssetBoundary(repoRoot);
const artworkConfiguration = await validatePeopleArtworkConfiguration({ repoRoot, registry: foundation.registry });
const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoRoot });
const changedPathErrors = validateChangedPaths(statusPaths(stdout));
const errors = [...result.errors, ...artworkConfiguration.errors, ...assetErrors, ...changedPathErrors];

if (errors.length) {
  process.stderr.write(`People foundation validation failed with ${errors.length} issue(s):\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    valid: true,
    offline: true,
    ...result.summary,
    peopleArtworkConfiguration: artworkConfiguration.summary,
    peoplePortraitAssets: 0,
    peopleArtworkManifests: 0,
    protectedWorktreeChanges: 0,
  }, null, 2)}\n`);
}

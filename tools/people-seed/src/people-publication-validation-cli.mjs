#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PEOPLE_MANIFEST_RELATIVE_PATH, validateTrackedPeopleManifest } from "./people-publication.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function parseArguments(argv) {
  const options = { manifestPath: PEOPLE_MANIFEST_RELATIVE_PATH, explicitManifest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--manifest requires a path.");
      options.manifestPath = argv[index + 1];
      options.explicitManifest = true;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown people publication validation argument: ${argument}`);
    }
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write("Usage: people-publication-validation-cli.mjs [--manifest <repository-path>]\n");
  process.exit(0);
}

const manifestPath = path.resolve(repoRoot, options.manifestPath);
const manifestPresent = await fs.access(manifestPath).then(() => true, () => false);
if (!manifestPresent && !options.explicitManifest) {
  await fs.access(path.join(repoRoot, "schemas", "people-artwork-manifest.schema.json"));
  const unexpectedAssets = [];
  for (const formatId of ["landscape", "poster"]) {
    const directory = path.join(repoRoot, "assets", "collection_covers", "people", formatId);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    unexpectedAssets.push(...entries.map((entry) => `${formatId}/${entry.name}${entry.isDirectory() ? "/" : ""}`));
  }
  if (unexpectedAssets.length) throw new Error(`People artwork exists without a manifest: ${unexpectedAssets.join(", ")}`);
  process.stdout.write(`${JSON.stringify({
    valid: true,
    frameworkAvailable: true,
    candidatePresent: false,
    numericAssetCount: 0,
    manifestPath: PEOPLE_MANIFEST_RELATIVE_PATH,
    message: "Publication tooling is valid; no permanent people artwork candidate is currently present.",
  }, null, 2)}\n`);
  process.exit(0);
}
if (!manifestPresent) throw new Error(`Explicit people artwork manifest does not exist: ${options.manifestPath}`);

const result = await validateTrackedPeopleManifest({ repoRoot, manifestPath });
if (!result.valid) {
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    valid: true,
    frameworkAvailable: true,
    candidatePresent: true,
    manifestPath: path.relative(repoRoot, manifestPath).replaceAll("\\", "/"),
    manifestHash: result.file.hash,
    manifestFingerprint: result.file.manifestFingerprint,
    recordCount: result.manifest.recordCount,
    landscapeCount: result.manifest.landscapeCount,
    posterCount: result.manifest.posterCount,
    fallbackCount: result.manifest.fallbackCount,
  }, null, 2)}\n`);
}

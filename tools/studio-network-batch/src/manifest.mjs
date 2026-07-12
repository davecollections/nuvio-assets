import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { bufferFingerprint } from "./fingerprints.mjs";

export async function readManifest(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fsPromises.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Manifest not found: ${manifestPath}`);
    if (error instanceof SyntaxError) throw new Error(`Invalid manifest JSON: ${error.message}`);
    throw error;
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(entries)) {
    throw new Error("Manifest must be an array or an object with an entries array.");
  }
  const map = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry.stable_key !== "string") {
      throw new Error(`Manifest entry ${index} is missing stable_key.`);
    }
    if (map.has(entry.stable_key)) {
      throw new Error(`Manifest contains duplicate stable_key ${entry.stable_key}.`);
    }
    map.set(entry.stable_key, entry);
  }
  return map;
}

export function compareManifestEntry(entry, current, { repoRoot = process.cwd() } = {}) {
  const reasons = [];
  if (entry.artwork_input_hash !== current.artworkInputHash) reasons.push("artwork_input_changed");
  if (entry.renderer_version !== current.rendererVersion) reasons.push("renderer_version_changed");
  if (entry.preset_version !== current.presetVersion) reasons.push("preset_version_changed");
  if (entry.output_path !== current.outputPath) reasons.push("output_path_changed");

  const declaredOutput = entry.output_path ? path.resolve(repoRoot, entry.output_path) : null;
  if (entry.status === "generated" && declaredOutput) {
    if (!fs.existsSync(declaredOutput)) {
      reasons.push("output_missing");
    } else {
      const bytes = fs.readFileSync(declaredOutput);
      if (entry.output_hash && bufferFingerprint(bytes) !== entry.output_hash) {
        reasons.push("output_hash_mismatch");
      }
      if (Number.isSafeInteger(entry.output_bytes) && bytes.length !== entry.output_bytes) {
        reasons.push("output_bytes_mismatch");
      }
    }
  }
  return [...new Set(reasons)];
}

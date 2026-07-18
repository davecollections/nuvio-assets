import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");

function firstExisting(candidates, label) {
  const resolved = candidates.filter(Boolean).map((candidate) => path.resolve(candidate));
  const found = resolved.find((candidate) => fsSync.existsSync(candidate));
  if (!found) throw new Error(`${label} is unavailable. Checked:\n${resolved.map((item) => `- ${item}`).join("\n")}`);
  return found;
}

function moduleRoot(value, packageName) {
  if (!value) return null;
  const resolved = path.resolve(value);
  if (path.basename(resolved) === "package.json") return path.dirname(resolved);
  if (path.basename(resolved) === packageName) return resolved;
  return path.join(resolved, packageName);
}

export function loadPeopleArtworkRuntime({ sharpPath = null, skiaCanvasPath = null } = {}) {
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const sharpRoot = firstExisting([
    moduleRoot(sharpPath || process.env.NUVIO_SHARP_PATH, "sharp"),
    path.join(packageRoot, "node_modules", "sharp"),
    path.join(repoRoot, "tools", "studio-network-batch", "node_modules", "sharp"),
  ], "Sharp 0.35.3");
  const bundledSkia = userProfile
    ? path.join(userProfile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "@oai", "artifact-tool", "node_modules", "skia-canvas")
    : null;
  const skiaRoot = firstExisting([
    moduleRoot(skiaCanvasPath || process.env.NUVIO_SKIA_CANVAS_PATH, "skia-canvas"),
    path.join(packageRoot, "node_modules", "skia-canvas"),
    bundledSkia,
  ], "skia-canvas 3.0.8");

  const sharp = require(sharpRoot);
  const skia = require(skiaRoot);
  const sharpPackage = require(path.join(sharpRoot, "package.json"));
  const skiaPackage = require(path.join(skiaRoot, "package.json"));
  const versions = {
    sharp: sharpPackage.version,
    libvips: sharp.versions.vips,
    skiaCanvas: skiaPackage.version,
  };
  const expected = { sharp: "0.35.3", libvips: "8.18.3", skiaCanvas: "3.0.8" };
  for (const [name, value] of Object.entries(expected)) {
    if (versions[name] !== value) throw new Error(`People artwork parity requires ${name} ${value}; found ${versions[name]}.`);
  }
  return { sharp, Canvas: skia.Canvas, FontLibrary: skia.FontLibrary, versions, sharpRoot, skiaRoot };
}

export const PEOPLE_ARTWORK_PACKAGE_ROOT = packageRoot;
export const PEOPLE_ARTWORK_REPO_ROOT = repoRoot;

import fs from "node:fs";
import path from "node:path";

import { SOURCE_FILES } from "./constants.mjs";

function hasExpectedFiles(directory, existsSync) {
  return Object.values(SOURCE_FILES).every((relativePath) =>
    existsSync(path.join(directory, relativePath)),
  );
}

export function resolveSourceDirectory({
  sourceDir,
  env = process.env,
  cwd = process.cwd(),
  repoRoot,
  existsSync = fs.existsSync,
} = {}) {
  const explicit = sourceDir ? path.resolve(cwd, sourceDir) : null;
  const environment = env.TMDB_ID_LOOKUP_DIR
    ? path.resolve(cwd, env.TMDB_ID_LOOKUP_DIR)
    : null;
  const checkoutRoot = repoRoot ? path.resolve(repoRoot) : findCheckoutRoot(cwd);
  const sibling = path.join(path.dirname(checkoutRoot), "tmdb-id-lookup");

  const candidates = [
    ["--source-dir", explicit],
    ["TMDB_ID_LOOKUP_DIR", environment],
    ["sibling discovery", sibling],
  ].filter(([, candidate]) => candidate);

  for (const [origin, candidate] of candidates) {
    if (existsSync(candidate) && hasExpectedFiles(candidate, existsSync)) {
      return { directory: candidate, origin };
    }
    if (origin !== "sibling discovery" || existsSync(candidate)) {
      const missing = Object.values(SOURCE_FILES)
        .filter((relativePath) => !existsSync(path.join(candidate, relativePath)))
        .join(", ");
      throw new Error(
        `Source directory from ${origin} is invalid: ${candidate}. Missing: ${missing || "directory"}.`,
      );
    }
  }

  throw new Error(
    `Could not find tmdb-id-lookup. Use --source-dir or TMDB_ID_LOOKUP_DIR. Checked sibling: ${sibling}.`,
  );
}

function findCheckoutRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "assets"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

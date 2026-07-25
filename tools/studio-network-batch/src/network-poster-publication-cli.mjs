import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dryRunNetworkPosterPublication } from "./network-poster-publication.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

if (process.argv.slice(2).join(" ") !== "--dry-run") {
  throw new Error("Only --dry-run is available in this proof-only implementation task.");
}

const [plan, landscapeManifest, decisions] = await Promise.all([
  fs.readFile(path.join(packageRoot, ".work/network-poster-staging/publication-readiness/reports/dry-publication-plan.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(repoRoot, "assets/collection_covers/manifest.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(packageRoot, "config/network-poster-decisions.json"), "utf8").then(JSON.parse),
]);
const result = await dryRunNetworkPosterPublication({ repoRoot, plan, landscapeManifest, decisions });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

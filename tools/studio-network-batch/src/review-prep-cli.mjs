#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkInterAvailability } from "./font-check.mjs";
import { prepareProductionReview } from "./review-prep.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let presetVersion = "production-v1";
let json = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--json") json = true;
  else if (args[index] === "--preset") presetVersion = args[++index];
  else if (args[index].startsWith("--preset=")) presetVersion = args[index].slice("--preset=".length);
  else throw new Error(`Unknown option: ${args[index]}`);
}
const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", `${presetVersion}.json`), "utf8"));
const fontCheckResult = await checkInterAvailability({ requestedFamily: preset.fallbackText?.requiredFontFamily ?? "Inter" });
const result = await prepareProductionReview({ packageRoot, preset, fontCheckResult });
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  process.stdout.write([
    `Focused review sheets: ${result.totalSheets} under ${result.reviewSheetsRoot}`,
    `Unique needs-review entities: ${result.uniqueNeedsReview}`,
    `Review-state draft: ${result.draftPath}`,
    result.fallbackIdsPath ? `Selective fallback IDs: ${result.fallbackIdsPath}` : null,
  ].filter(Boolean).join("\n") + "\n");
}

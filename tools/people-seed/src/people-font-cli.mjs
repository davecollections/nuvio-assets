#!/usr/bin/env node
import path from "node:path";

import { acquireFont, verifyFont } from "./people-artwork/font.mjs";
import { loadPeopleArtworkRuntime } from "./people-artwork/runtime-dependencies.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const command = process.argv[2] || "verify";
  const fontDirectory = option("--font-dir");
  if (command === "acquire") {
    const result = await acquireFont({ fontDirectory });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command !== "verify") throw new Error("Use people-font-cli.mjs verify|acquire [--font-dir <ignored-cache-dir>].");
  const runtime = loadPeopleArtworkRuntime();
  const result = await verifyFont({ Canvas: runtime.Canvas, FontLibrary: runtime.FontLibrary, names: ["Céline Sciamma", "Max Ophüls", "Djibril Diop Mambéty", "F. W. Murnau"], fontDirectory: fontDirectory ? path.resolve(fontDirectory) : null });
  process.stdout.write(`${JSON.stringify({ ...result, fontPath: result.fontPath.replaceAll("\\", "/"), licencePath: result.licencePath.replaceAll("\\", "/") }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

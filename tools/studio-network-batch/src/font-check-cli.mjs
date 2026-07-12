#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkInterAvailability } from "./font-check.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const diagnosticRoot = path.join(packageRoot, ".work", "font-diagnostics");

const result = await checkInterAvailability({
  diagnosticPath: path.join(diagnosticRoot, "inter-font-diagnostic.png"),
  reportPath: path.join(diagnosticRoot, "inter-font-check.json"),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

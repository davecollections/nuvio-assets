import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertProductionFallbackFont, checkInterAvailability } from "../src/font-check.mjs";

async function temporaryDirectory(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-font-check-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

const samplesDifferent = async () => ({
  requested: Buffer.from("requested"),
  fallback: Buffer.from("fallback"),
  diagnostic: Buffer.from("diagnostic"),
});

test("Inter check confirms only a discovered font that renders differently from fallback", async (context) => {
  const directory = await temporaryDirectory(context);
  await fs.writeFile(path.join(directory, "Inter-Regular.ttf"), "fixture");
  const diagnosticPath = path.join(directory, "diagnostic.png");
  const reportPath = path.join(directory, "report.json");
  const result = await checkInterAvailability({
    fontDirectories: [directory],
    renderSamplesImpl: samplesDifferent,
    diagnosticPath,
    reportPath,
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.safeToContinueProductionFallbackRendering, true);
  assert.equal(result.discoveredFonts[0].fileName, "Inter-Regular.ttf");
  assert.equal(await fs.readFile(diagnosticPath, "utf8"), "diagnostic");
  assert.equal(JSON.parse(await fs.readFile(reportPath, "utf8")).requestedFamily, "Inter");
});

test("Inter check blocks production when the renderer cannot be confirmed", async (context) => {
  const directory = await temporaryDirectory(context);
  const result = await checkInterAvailability({ fontDirectories: [directory], renderSamplesImpl: samplesDifferent });
  assert.equal(result.confirmed, false);
  assert.equal(result.manualConfirmationRequired, true);
  assert.throws(
    () => assertProductionFallbackFont({ fallbackText: { requireConfirmedFont: true, requiredFontFamily: "Inter" } }, result),
    (error) => error.code === "required_font_unavailable" && /npm run font-check/.test(error.message),
  );
});

test("non-production fallback stacks do not require a confirmed font", () => {
  assert.doesNotThrow(() => assertProductionFallbackFont({ fallbackText: { fontFamily: "Inter, Arial" } }, null));
});

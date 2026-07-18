import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "../schema-validator.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

function csvValue(value) {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

export async function validateRenderMetadata(metadata) {
  const schemaPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "schemas", "people-artwork-render-metadata.schema.json");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const errors = validateAgainstSchema(metadata, schema, "people-artwork-render-metadata");
  if (metadata.recordCount !== metadata.records.length) errors.push("people-artwork-render-metadata.recordCount must equal records length");
  for (const record of metadata.records) {
    if (record.lineCount !== record.nameLines.length) errors.push(`${record.stableKey}/${record.formatId}: lineCount does not match nameLines`);
    if (record.nameLines.join(" ") !== record.canonicalName) errors.push(`${record.stableKey}/${record.formatId}: canonical name was not preserved`);
    if (record.fallbackUsed !== Boolean(record.fallbackReason)) errors.push(`${record.stableKey}/${record.formatId}: fallback flag and reason disagree`);
    if (record.fallbackUsed && (record.sourcePath !== null || record.sourceHash !== null || record.cropRectangle !== null)) errors.push(`${record.stableKey}/${record.formatId}: fallback metadata embeds portrait state`);
    if (!record.fallbackUsed && (!record.sourceHash || !record.cropRectangle || !record.independentlyGeneratedFromOriginalSource)) errors.push(`${record.stableKey}/${record.formatId}: portrait metadata is incomplete`);
  }
  return errors;
}

export async function writeRenderMetadata({ metadata, outputDir, jsonName = "render-metadata.json", csvName = "render-metadata.csv" }) {
  const errors = await validateRenderMetadata(metadata);
  if (errors.length) throw new Error(`Render metadata failed validation:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  const fields = [
    "stableKey", "tmdbPersonId", "canonicalName", "categoryMembership", "formatId", "fallbackUsed", "fallbackReason",
    "profilePathAttempted", "sourceStatus", "sourceDecision", "sourcePath", "sourceHash", "sourceWidth", "sourceHeight",
    "presetId", "presetHash", "fontFamily", "fontWeight", "fontHash", "requestedFontSize", "finalFontSize", "nameLines",
    "lineCount", "lineHeight", "textBounds", "safeMargins", "cropMethod", "cropRectangle", "cropRetainedAreaFraction",
    "resizeScale", "upscaleFactor", "portraitBounds", "gradientBounds", "grainSeed", "grainAmount", "canvasWidth", "canvasHeight",
    "outputPath", "outputHash", "byteCount",
  ];
  const jsonPath = path.join(outputDir, jsonName);
  const csvPath = path.join(outputDir, csvName);
  const csv = `${[fields.join(","), ...metadata.records.map((record) => fields.map((field) => csvValue(record[field])).join(","))].join("\n")}\n`;
  await Promise.all([
    atomicWrite(jsonPath, `${JSON.stringify(metadata, null, 2)}\n`),
    atomicWrite(csvPath, csv),
  ]);
  return { jsonPath, csvPath, recordCount: metadata.records.length };
}

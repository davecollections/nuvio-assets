import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "../schema-validator.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

const CONFIG_RELATIVE_PATH = "data/people/landscape-crop-overrides.json";
const SCHEMA_RELATIVE_PATH = "schemas/landscape-crop-overrides.schema.json";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateLandscapeCropOverrides(document, schema, { registry = null } = {}) {
  const errors = validateAgainstSchema(document, schema, "landscape-crop-overrides.json");
  if (document.recordCount !== document.records?.length) errors.push("landscape crop override recordCount must equal records length");
  const stableKeys = new Set();
  const personIds = new Set();
  const registryByKey = registry ? new Map(registry.records.map((record) => [record.stableKey, record])) : null;
  for (const [index, record] of (document.records || []).entries()) {
    if (stableKeys.has(record.stableKey)) errors.push(`${record.stableKey}: duplicate landscape crop override stable key`);
    if (personIds.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate landscape crop override TMDB person ID`);
    stableKeys.add(record.stableKey);
    personIds.add(record.tmdbPersonId);
    if (index > 0 && document.records[index - 1].tmdbPersonId >= record.tmdbPersonId) errors.push("landscape crop overrides must use ascending TMDB person ID order");
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: stable key and TMDB person ID differ`);
    const targetWidth = Math.round(record.cropRectangle.width * record.cropScale.x);
    const targetHeight = Math.round(record.cropRectangle.height * record.cropScale.y);
    if (targetWidth < 1 || targetHeight < 1 || record.cropOffsetX + targetWidth > 1200 || record.cropOffsetY + targetHeight > 675) errors.push(`${record.stableKey}: effective landscape portrait bounds exceed the 1200x675 canvas`);
    if (registryByKey) {
      const person = registryByKey.get(record.stableKey);
      if (!person || person.tmdbPersonId !== record.tmdbPersonId || person.canonicalName !== record.canonicalName) errors.push(`${record.stableKey}: crop override identity differs from the people registry`);
    }
  }
  return errors;
}

export async function loadLandscapeCropOverrides({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
  const schemaPath = path.join(repoRoot, SCHEMA_RELATIVE_PATH);
  const [buffer, schemaBuffer] = await Promise.all([fs.readFile(configPath), fs.readFile(schemaPath)]);
  const config = JSON.parse(buffer);
  const schema = JSON.parse(schemaBuffer);
  const errors = validateLandscapeCropOverrides(config, schema, { registry });
  if (errors.length) throw new Error(`Landscape crop overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  const configHash = sha256(buffer);
  return {
    config,
    configHash,
    configPath,
    schemaPath,
    byStableKey: new Map(config.records.map((record) => [record.stableKey, record])),
  };
}

export class LandscapeCropOverrideSourceMismatchError extends Error {
  constructor({ person, record, source }) {
    super(`crop-override-source-mismatch:${person.stableKey}: expected ${record.sourceHash}, received ${source?.sourceHash ?? "unavailable"}`);
    this.name = "LandscapeCropOverrideSourceMismatchError";
    this.code = "crop-override-source-mismatch";
    this.cropOverrideStatus = "source-mismatch";
    this.stableKey = person.stableKey;
    this.expectedSourceHash = record.sourceHash;
    this.actualSourceHash = source?.sourceHash ?? null;
  }
}

export function resolveLandscapeCropOverride({ person, source, formatId, overrideConfiguration }) {
  if (formatId !== "landscape") return { used: false, status: "not-applicable-format" };
  const record = overrideConfiguration.byStableKey.get(person.stableKey);
  if (!record || record.status !== "active") return { used: false, status: "not-configured" };
  assert(record.tmdbPersonId === person.tmdbPersonId && record.canonicalName === person.canonicalName, `${person.stableKey}: crop override identity mismatch`);
  if (!source?.available || source.sourceHash !== record.sourceHash || source.profilePathAttempted !== record.sourceProfilePath) {
    throw new LandscapeCropOverrideSourceMismatchError({ person, record, source });
  }
  return {
    used: true,
    id: record.stableKey,
    status: "active-source-match",
    configHash: overrideConfiguration.configHash,
    record,
  };
}

export const LANDSCAPE_CROP_OVERRIDE_PATH = CONFIG_RELATIVE_PATH;
export const LANDSCAPE_CROP_OVERRIDE_SCHEMA_PATH = SCHEMA_RELATIVE_PATH;

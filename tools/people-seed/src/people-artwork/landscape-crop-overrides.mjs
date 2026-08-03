import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "../schema-validator.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

const CONFIG_RELATIVE_PATH = "data/people/landscape-crop-overrides.json";
const SCHEMA_RELATIVE_PATH = "schemas/landscape-crop-overrides.schema.json";
const CHIN_SAFE_CONFIG_RELATIVE_PATH = "data/people/landscape-chin-safe-overrides.json";
const CHIN_SAFE_SCHEMA_RELATIVE_PATH = "schemas/people-landscape-chin-safe-overrides.schema.json";
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

export function validateLandscapeChinSafeOverrides(document, schema, { registry = null } = {}) {
  const errors = validateAgainstSchema(document, schema, "landscape-chin-safe-overrides.json");
  if (document?.recordCount !== document?.records?.length) errors.push("chin-safe override recordCount must equal records length");
  const registryByKey = registry ? new Map(registry.records.map((record) => [record.stableKey, record])) : null;
  const ids = new Set();
  for (const [index, record] of (document?.records || []).entries()) {
    if (ids.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate chin-safe override`);
    ids.add(record.tmdbPersonId);
    if (index > 0 && document.records[index - 1].tmdbPersonId >= record.tmdbPersonId) errors.push("chin-safe overrides must use ascending TMDB Person ID order");
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: stable key and TMDB Person ID differ`);
    if (registryByKey) {
      const person = registryByKey.get(record.stableKey);
      if (!person || person.tmdbPersonId !== record.tmdbPersonId || person.canonicalName !== record.canonicalName) errors.push(`${record.stableKey}: chin-safe override differs from the People registry`);
    }
    const targetWidth = Math.round(record.cropRectangle.width * record.cropScale.x);
    const targetHeight = Math.round(record.cropRectangle.height * record.cropScale.y);
    if (targetHeight !== 675 || ![540, 594].includes(targetWidth)) errors.push(`${record.stableKey}: chin-safe override is outside the approved zoom-out tiers`);
    if (record.cropOffsetX + targetWidth !== 1098 || record.cropOffsetY !== 0) errors.push(`${record.stableKey}: chin-safe override changed the locked right edge or top alignment`);
  }
  return errors;
}

export async function loadLandscapeChinSafeOverrides({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const configPath = path.join(repoRoot, CHIN_SAFE_CONFIG_RELATIVE_PATH);
  const schemaPath = path.join(repoRoot, CHIN_SAFE_SCHEMA_RELATIVE_PATH);
  const [buffer, schemaBuffer] = await Promise.all([fs.readFile(configPath), fs.readFile(schemaPath)]);
  const config = JSON.parse(buffer);
  const schema = JSON.parse(schemaBuffer);
  const errors = validateLandscapeChinSafeOverrides(config, schema, { registry });
  if (errors.length) throw new Error(`Landscape chin-safe overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return {
    config,
    configHash: sha256(buffer),
    configPath,
    schemaPath,
    byStableKey: new Map(config.records.map((record) => [record.stableKey, record])),
  };
}

export async function loadLandscapeCropOverrides({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, registry = null } = {}) {
  const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
  const schemaPath = path.join(repoRoot, SCHEMA_RELATIVE_PATH);
  const [buffer, schemaBuffer, chinSafe] = await Promise.all([
    fs.readFile(configPath),
    fs.readFile(schemaPath),
    loadLandscapeChinSafeOverrides({ repoRoot, registry }),
  ]);
  const baseConfig = JSON.parse(buffer);
  const schema = JSON.parse(schemaBuffer);
  const errors = validateLandscapeCropOverrides(baseConfig, schema, { registry });
  if (errors.length) throw new Error(`Landscape crop overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  const combinedRecords = [...baseConfig.records, ...chinSafe.config.records].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId);
  assert(new Set(combinedRecords.map((record) => record.stableKey)).size === combinedRecords.length, "Landscape crop override sources contain a duplicate stable key.");
  const config = {
    version: "people-landscape-crop-overrides-v2-active-set",
    status: "active",
    ordering: "tmdb-person-id-ascending",
    baseRecordCount: baseConfig.recordCount,
    chinSafeRecordCount: chinSafe.config.recordCount,
    recordCount: combinedRecords.length,
    records: combinedRecords,
  };
  const configHash = sha256(Buffer.concat([Buffer.from("people-landscape-crop-overrides-v2-active-set\0"), buffer, Buffer.from("\0"), Buffer.from(chinSafe.configHash)]));
  return {
    config,
    baseConfig,
    chinSafeConfig: chinSafe.config,
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
export const LANDSCAPE_CHIN_SAFE_OVERRIDE_PATH = CHIN_SAFE_CONFIG_RELATIVE_PATH;
export const LANDSCAPE_CHIN_SAFE_OVERRIDE_SCHEMA_PATH = CHIN_SAFE_SCHEMA_RELATIVE_PATH;

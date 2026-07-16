import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { compareEntities, outputPathFor } from "./constants.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_KEY_PATTERN = /^(company|network):[1-9]\d*$/;
const APPROVAL_FIELDS = new Set([
  "stableKey",
  "entityType",
  "tmdbId",
  "canonicalNameAtApproval",
  "publishTarget",
  "approvedOutputHash",
  "approvedByteCount",
  "width",
  "height",
  "format",
  "approvalStatus",
  "approvalSource",
  "reviewedAt",
]);

function assertDateTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date-time string.`);
  }
}

function assertWithin(child, parent, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside production staging: ${child}`);
  }
}

function expectedStableKey(approval) {
  return `${approval.entityType}:${approval.tmdbId}`;
}

export function validateCoverApprovalState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Cover approval state must be an object.");
  }
  const topFields = new Set(Object.keys(state));
  for (const field of ["version", "reviewedAt", "approvalSource", "approvalCount", "approvals"]) {
    if (!topFields.has(field)) throw new Error(`Cover approval state requires ${field}.`);
  }
  for (const field of topFields) {
    if (!["version", "reviewedAt", "approvalSource", "approvalCount", "approvals"].includes(field)) {
      throw new Error(`Cover approval state contains unsupported field ${field}.`);
    }
  }
  if (state.version !== "studio-network-cover-approvals-v1") {
    throw new Error(`Unsupported cover approval state version: ${state.version}.`);
  }
  assertDateTime(state.reviewedAt, "Cover approval reviewedAt");
  if (typeof state.approvalSource !== "string" || !state.approvalSource.trim()) {
    throw new Error("Cover approval state requires a non-empty approvalSource.");
  }
  if (!Array.isArray(state.approvals) || state.approvalCount !== state.approvals.length) {
    throw new Error("Cover approvalCount must equal the approvals array length.");
  }
  const seen = new Set();
  let previous = null;
  for (const [index, approval] of state.approvals.entries()) {
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      throw new Error(`Cover approvals[${index}] must be an object.`);
    }
    const fields = new Set(Object.keys(approval));
    for (const field of APPROVAL_FIELDS) {
      if (!fields.has(field)) throw new Error(`Cover approvals[${index}] requires ${field}.`);
    }
    for (const field of fields) {
      if (!APPROVAL_FIELDS.has(field)) throw new Error(`Cover approvals[${index}] contains unsupported field ${field}.`);
    }
    if (!STABLE_KEY_PATTERN.test(approval.stableKey ?? "") || expectedStableKey(approval) !== approval.stableKey) {
      throw new Error(`Cover approvals[${index}] has inconsistent identity fields.`);
    }
    if (!Number.isSafeInteger(approval.tmdbId) || approval.tmdbId < 1) {
      throw new Error(`Cover approvals[${index}] has an invalid TMDB ID.`);
    }
    if (typeof approval.canonicalNameAtApproval !== "string" || !approval.canonicalNameAtApproval.trim()) {
      throw new Error(`Cover approvals[${index}] requires a canonical name.`);
    }
    if (approval.publishTarget !== outputPathFor(approval)) {
      throw new Error(`Cover approvals[${index}] has an invalid publish target.`);
    }
    if (!HASH_PATTERN.test(approval.approvedOutputHash ?? "")) {
      throw new Error(`Cover approvals[${index}] has an invalid output hash.`);
    }
    if (!Number.isSafeInteger(approval.approvedByteCount) || approval.approvedByteCount < 1) {
      throw new Error(`Cover approvals[${index}] has an invalid byte count.`);
    }
    if (approval.width !== 1200 || approval.height !== 675 || approval.format !== "webp") {
      throw new Error(`Cover approvals[${index}] is not a 1200x675 WebP approval.`);
    }
    if (approval.approvalStatus !== "approved") {
      throw new Error(`Cover approvals[${index}] is not approved.`);
    }
    if (approval.approvalSource !== state.approvalSource || approval.reviewedAt !== state.reviewedAt) {
      throw new Error(`Cover approvals[${index}] does not match the state approval metadata.`);
    }
    assertDateTime(approval.reviewedAt, `Cover approvals[${index}].reviewedAt`);
    if (seen.has(approval.stableKey)) throw new Error(`Duplicate cover approval ${approval.stableKey}.`);
    if (previous && compareEntities(previous, approval) >= 0) {
      throw new Error("Cover approvals must be ordered by entity type and numeric TMDB ID.");
    }
    seen.add(approval.stableKey);
    previous = approval;
  }
  return state;
}

export function validateCoverApprovalStateAgainstSchema(state, schema) {
  validateCoverApprovalState(state);
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error("Cover approval schema must define a closed object.");
  }
  if (schema.properties?.version?.const !== state.version) {
    throw new Error("Cover approval state version does not match the schema.");
  }
  const requiredTopFields = ["version", "reviewedAt", "approvalSource", "approvalCount", "approvals"];
  if (JSON.stringify(schema.required) !== JSON.stringify(requiredTopFields)) {
    throw new Error("Cover approval schema has unexpected top-level required fields.");
  }
  const itemSchema = schema.properties?.approvals?.items;
  if (!itemSchema || itemSchema.type !== "object" || itemSchema.additionalProperties !== false) {
    throw new Error("Cover approval schema must define closed approval entries.");
  }
  if (JSON.stringify(itemSchema.required) !== JSON.stringify([...APPROVAL_FIELDS])) {
    throw new Error("Cover approval schema required fields differ from the durable approval model.");
  }
  if (itemSchema.properties?.width?.const !== 1200
    || itemSchema.properties?.height?.const !== 675
    || itemSchema.properties?.format?.const !== "webp"
    || itemSchema.properties?.approvalStatus?.const !== "approved") {
    throw new Error("Cover approval schema does not enforce the production output contract.");
  }
  return state;
}

export function createCoverApprovalState({ records, reviewedAt, approvalSource } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error("Cover approval generation requires production records.");
  assertDateTime(reviewedAt, "Cover approval reviewedAt");
  if (typeof approvalSource !== "string" || !approvalSource.trim()) {
    throw new Error("Cover approval generation requires a non-empty approvalSource.");
  }
  const unresolved = records.filter((record) => record.reviewStatus === "needs-review" || (record.reviewReasons ?? []).length);
  if (unresolved.length) {
    throw new Error(`Cover approvals require zero unresolved reviews; found ${unresolved.length} records.`);
  }
  const approvals = [...records].sort(compareEntities).map((record) => ({
    stableKey: record.stableKey,
    entityType: record.entityType,
    tmdbId: record.tmdbId,
    canonicalNameAtApproval: record.name,
    publishTarget: outputPathFor(record),
    approvedOutputHash: record.outputHash,
    approvedByteCount: record.outputBytes,
    width: record.outputWidth,
    height: record.outputHeight,
    format: record.outputFormat,
    approvalStatus: "approved",
    approvalSource,
    reviewedAt,
  }));
  return validateCoverApprovalState({
    version: "studio-network-cover-approvals-v1",
    reviewedAt,
    approvalSource,
    approvalCount: approvals.length,
    approvals,
  });
}

async function mapBounded(items, concurrency, operation) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function validateCoverApprovalStateAgainstStaging({
  state,
  records,
  stagingRoot,
  concurrency = 8,
} = {}) {
  validateCoverApprovalState(state);
  const recordsByKey = new Map(records.map((record) => [record.stableKey, record]));
  if (recordsByKey.size !== records.length || state.approvals.length !== records.length) {
    throw new Error("Cover approval state and persistent production records have different identity counts.");
  }
  const validations = await mapBounded(state.approvals, concurrency, async (approval) => {
    const record = recordsByKey.get(approval.stableKey);
    if (!record) throw new Error(`Cover approval has no production record: ${approval.stableKey}.`);
    if (record.name !== approval.canonicalNameAtApproval) throw new Error(`Canonical name mismatch for ${approval.stableKey}.`);
    if (record.outputHash !== approval.approvedOutputHash) throw new Error(`Production output hash mismatch for ${approval.stableKey}.`);
    if (record.outputBytes !== approval.approvedByteCount) throw new Error(`Production byte-count mismatch for ${approval.stableKey}.`);
    if (record.outputWidth !== approval.width || record.outputHeight !== approval.height || record.outputFormat !== approval.format) {
      throw new Error(`Production output metadata mismatch for ${approval.stableKey}.`);
    }
    assertWithin(record.outputPath, stagingRoot, `Cover approval ${approval.stableKey}`);
    const buffer = await fs.readFile(record.outputPath);
    if (buffer.length !== approval.approvedByteCount) throw new Error(`Staged byte-count mismatch for ${approval.stableKey}.`);
    if (bufferFingerprint(buffer) !== approval.approvedOutputHash) throw new Error(`Staged hash mismatch for ${approval.stableKey}.`);
    const { info } = await sharp(buffer, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (info.width !== 1200 || info.height !== 675 || metadata.format !== "webp") {
      throw new Error(`Staged output is not a decodable 1200x675 WebP for ${approval.stableKey}.`);
    }
    return { stableKey: approval.stableKey, bytes: buffer.length, hash: approval.approvedOutputHash };
  });
  return {
    approvalCount: state.approvals.length,
    productionRecordCount: records.length,
    decodedCount: validations.length,
    totalBytes: validations.reduce((sum, item) => sum + item.bytes, 0),
    exactIdentityCoverage: true,
    exactHashCoverage: true,
    exactByteCoverage: true,
    exactDimensionsAndFormat: true,
  };
}

import fs from "node:fs/promises";

const SHA256 = /^[a-f0-9]{64}$/;
const APPROVED_BACKGROUND_IDS = [48, 197, 274, 298, 553, 1028, 1073, 1977, 5428, 7774, 8020];
const ROOT_FIELDS = ["version", "orientation", "presetVersion", "backgroundDecisions", "fallbackApprovals"];
const BACKGROUND_FIELDS = [
  "stableKey", "entityType", "tmdbId", "name", "sourceLogoPath", "sourceLogoSha256", "background",
  "approvedOutputSha256", "approvedOutputBytes", "approvalHash",
];
const FALLBACK_FIELDS = [
  "stableKey", "entityType", "tmdbId", "name", "fallbackName", "background", "fontFamily", "fontSize",
  "lineHeight", "approvedOutputSha256", "approvedOutputBytes", "approvalHash",
];

function fail(message) {
  throw new Error(`Invalid network poster decisions: ${message}`);
}

function assertExactFields(record, fields, label) {
  const actual = Object.keys(record);
  if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) {
    fail(`${label} fields or field order drifted.`);
  }
}

function validateCommon(record) {
  if (record.entityType !== "network") fail(`${record.stableKey} must bind entityType network.`);
  if (record.stableKey !== `network:${record.tmdbId}`) fail(`${record.stableKey} does not bind its TMDB ID.`);
  if (!Number.isInteger(record.tmdbId) || record.tmdbId < 1) fail(`${record.stableKey} has an invalid TMDB ID.`);
  if (typeof record.name !== "string" || record.name.length === 0) fail(`${record.stableKey} has an invalid name.`);
  for (const field of ["approvedOutputSha256", "approvalHash"]) {
    if (!SHA256.test(record[field] ?? "")) fail(`${record.stableKey} has an invalid ${field}.`);
  }
  if (!Number.isInteger(record.approvedOutputBytes) || record.approvedOutputBytes < 1) {
    fail(`${record.stableKey} has an invalid approvedOutputBytes.`);
  }
}

export function validateNetworkPosterDecisions(value) {
  assertExactFields(value, ROOT_FIELDS, "root");
  if (value?.version !== "network-poster-decisions-v1") fail("unsupported version.");
  if (value.orientation !== "poster") fail("orientation must be poster.");
  if (value.presetVersion !== "network-poster-variant-b-proof-v1") fail("preset version drifted.");
  if (!Array.isArray(value.backgroundDecisions) || !Array.isArray(value.fallbackApprovals)) fail("decision arrays are required.");

  const keys = new Set();
  for (const record of value.backgroundDecisions) {
    assertExactFields(record, BACKGROUND_FIELDS, record.stableKey ?? "background decision");
    validateCommon(record);
    if (!record.sourceLogoPath?.startsWith("/") || !SHA256.test(record.sourceLogoSha256 ?? "")) {
      fail(`${record.stableKey} must bind an exact source path and SHA-256.`);
    }
    if (!["dark", "light"].includes(record.background)) fail(`${record.stableKey} has an invalid background.`);
    if (keys.has(record.stableKey)) fail(`duplicate ${record.stableKey}.`);
    keys.add(record.stableKey);
  }
  if (value.backgroundDecisions.map((record) => record.tmdbId).join(",") !== APPROVED_BACKGROUND_IDS.join(",")) {
    fail("background decision scope or ordering drifted.");
  }
  if (value.backgroundDecisions.filter((record) => record.background === "light").length !== 10 ||
    value.backgroundDecisions.find((record) => record.tmdbId === 1073)?.background !== "dark") {
    fail("approved light/dark background decisions drifted.");
  }
  for (const record of value.fallbackApprovals) {
    assertExactFields(record, FALLBACK_FIELDS, record.stableKey ?? "fallback approval");
    validateCommon(record);
    if (record.fontFamily !== "Inter") fail(`${record.stableKey} must use Inter.`);
    if (keys.has(record.stableKey)) fail(`duplicate ${record.stableKey}.`);
    keys.add(record.stableKey);
  }
  if (value.fallbackApprovals.length !== 1 || value.fallbackApprovals[0].tmdbId !== 184) {
    fail("fallback approval scope drifted.");
  }
  return value;
}

export async function readNetworkPosterDecisions(filePath) {
  return validateNetworkPosterDecisions(JSON.parse(await fs.readFile(filePath, "utf8")));
}

export function resolveNetworkPosterDecision(config, {
  stableKey,
  tmdbId,
  sourceLogoPath,
  sourceLogoSha256,
  orientation = "poster",
}) {
  validateNetworkPosterDecisions(config);
  if (orientation !== "poster") return { status: "not-applicable", decision: null };
  const decision = config.backgroundDecisions.find((item) => item.stableKey === stableKey);
  if (!decision) return { status: "automatic", decision: null };
  if (decision.tmdbId !== tmdbId || decision.sourceLogoPath !== sourceLogoPath || decision.sourceLogoSha256 !== sourceLogoSha256) {
    return {
      status: "stale",
      decision: null,
      reason: "Poster decision source path or SHA-256 no longer matches.",
    };
  }
  return { status: "resolved", decision };
}

export function resolveNetworkPosterFallback(config, { stableKey, tmdbId, name, orientation = "poster" }) {
  validateNetworkPosterDecisions(config);
  if (orientation !== "poster") return { status: "not-applicable", approval: null };
  const approval = config.fallbackApprovals.find((item) => item.stableKey === stableKey);
  if (!approval) return { status: "unapproved", approval: null };
  if (approval.tmdbId !== tmdbId || approval.name !== name || approval.fallbackName !== name) {
    return { status: "stale", approval: null, reason: "Fallback identity or name no longer matches." };
  }
  return { status: "resolved", approval };
}

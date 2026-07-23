import fs from "node:fs/promises";
import path from "node:path";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const EXPECTED_FIELDS = new Set([
  "stableKey",
  "entityType",
  "tmdbId",
  "sourceLogoPath",
  "sourceLogoHash",
  "sourceVisibleBounds",
  "visibleDimensions",
  "placement",
  "scalePercent",
  "background",
  "outputHash",
  "outputBytes",
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertExactFields(value, expected, label) {
  const fields = Object.keys(value);
  const unexpected = fields.filter((field) => !expected.has(field));
  const missing = [...expected].filter((field) => !fields.includes(field));
  if (unexpected.length || missing.length) {
    throw new Error(`${label} fields are invalid (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`);
  }
}

function assertHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
}

function assertRectangle(value, label, { allowZeroOrigin = true } = {}) {
  assertObject(value, label);
  assertExactFields(value, new Set(["left", "top", "width", "height"]), label);
  for (const field of ["left", "top", "width", "height"]) {
    const minimum = allowZeroOrigin && (field === "left" || field === "top") ? 0 : 1;
    if (!Number.isSafeInteger(value[field]) || value[field] < minimum) throw new Error(`${label}.${field} is invalid.`);
  }
}

function assertDimensions(value, label) {
  assertObject(value, label);
  assertExactFields(value, new Set(["width", "height"]), label);
  if (!Number.isSafeInteger(value.width) || value.width < 1 || !Number.isSafeInteger(value.height) || value.height < 1) {
    throw new Error(`${label} must contain positive integer dimensions.`);
  }
}

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDecision(decision, index) {
  const label = `Logo fit decisions[${index}]`;
  assertObject(decision, label);
  assertExactFields(decision, EXPECTED_FIELDS, label);
  if (decision.entityType !== "company" || decision.stableKey !== `company:${decision.tmdbId}` || !Number.isSafeInteger(decision.tmdbId) || decision.tmdbId < 1) {
    throw new Error(`${label} must identify one positive TMDB company ID.`);
  }
  if (typeof decision.sourceLogoPath !== "string" || !/^\/[A-Za-z0-9_-]+\.(?:png|webp|svg)$/.test(decision.sourceLogoPath)) {
    throw new Error(`${label}.sourceLogoPath is invalid.`);
  }
  assertHash(decision.sourceLogoHash, `${label}.sourceLogoHash`);
  assertRectangle(decision.sourceVisibleBounds, `${label}.sourceVisibleBounds`);
  assertDimensions(decision.visibleDimensions, `${label}.visibleDimensions`);
  assertObject(decision.placement, `${label}.placement`);
  assertExactFields(decision.placement, new Set(["left", "top"]), `${label}.placement`);
  if (!Number.isSafeInteger(decision.placement.left) || decision.placement.left < 50 ||
      !Number.isSafeInteger(decision.placement.top) || decision.placement.top < 50) {
    throw new Error(`${label}.placement must retain at least 50 pixels of top and left margin.`);
  }
  if (decision.placement.left !== Math.floor((1200 - decision.visibleDimensions.width) / 2) ||
      decision.placement.top !== Math.floor((675 - decision.visibleDimensions.height) / 2)) {
    throw new Error(`${label}.placement must centre the configured visible dimensions on 1200x675.`);
  }
  if (1200 - decision.placement.left - decision.visibleDimensions.width < 50 ||
      675 - decision.placement.top - decision.visibleDimensions.height < 50) {
    throw new Error(`${label} does not retain the required safe margins.`);
  }
  if (decision.scalePercent !== 125) throw new Error(`${label}.scalePercent must be 125.`);
  if (!new Set(["dark", "light"]).has(decision.background)) throw new Error(`${label}.background must be dark or light.`);
  assertHash(decision.outputHash, `${label}.outputHash`);
  if (!Number.isSafeInteger(decision.outputBytes) || decision.outputBytes < 1) throw new Error(`${label}.outputBytes is invalid.`);
}

export function validateLogoFitDecisionConfiguration(configuration) {
  assertObject(configuration, "Logo fit decision configuration");
  assertExactFields(configuration, new Set(["version", "scope", "decisions"]), "Logo fit decision configuration");
  if (configuration.version !== "compact-logo-fit-v1") throw new Error("Logo fit decision version is unsupported.");
  if (!Array.isArray(configuration.scope) || !Array.isArray(configuration.decisions)) {
    throw new Error("Logo fit decision configuration requires scope and decisions arrays.");
  }
  const seen = new Set();
  let previousId = 0;
  for (const [index, decision] of configuration.decisions.entries()) {
    validateDecision(decision, index);
    if (seen.has(decision.stableKey)) throw new Error(`Duplicate logo fit decision for ${decision.stableKey}.`);
    if (decision.tmdbId <= previousId) throw new Error("Logo fit decisions must be ordered by numeric TMDB company ID.");
    seen.add(decision.stableKey);
    previousId = decision.tmdbId;
  }
  if (configuration.scope.length !== configuration.decisions.length ||
      configuration.scope.some((stableKey, index) => stableKey !== configuration.decisions[index].stableKey)) {
    throw new Error("Logo fit decision scope must exactly match the ordered decisions.");
  }
  return configuration;
}

export async function loadLogoFitDecisionConfiguration(packageRoot, relativePath = "config/logo-fit-decisions.json") {
  const filePath = path.resolve(packageRoot, relativePath);
  const relative = path.relative(path.resolve(packageRoot), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Logo fit decision configuration must remain inside the package.");
  const configuration = validateLogoFitDecisionConfiguration(JSON.parse(await fs.readFile(filePath, "utf8")));
  return {
    ...configuration,
    filePath,
    byStableKey: new Map(configuration.decisions.map((decision) => [decision.stableKey, decision])),
  };
}

export function resolveLogoFitDecision(configuration, { stableKey, sourceLogoPath, sourceLogoHash, sourceVisibleBounds } = {}) {
  const decision = configuration?.byStableKey?.get(stableKey) ?? null;
  if (!decision) return null;
  if (decision.sourceLogoPath !== sourceLogoPath || decision.sourceLogoHash !== sourceLogoHash ||
      !sameObject(decision.sourceVisibleBounds, sourceVisibleBounds)) {
    throw new Error(`Stale logo fit decision for ${stableKey}; source binding changed.`);
  }
  return decision;
}

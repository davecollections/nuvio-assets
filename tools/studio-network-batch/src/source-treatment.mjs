import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { bufferFingerprint } from "./fingerprints.mjs";
import { compareStableKeys } from "./mixed-contrast.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_KEY_PATTERN = /^(company|network):[1-9]\d*$/;
const TREATMENT_TYPES = new Set(["manual-source", "owner-approved-text", "safe-source-crop"]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateCropBounds(bounds, label) {
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const field of ["left", "top", "width", "height"]) {
    if (!Number.isSafeInteger(bounds[field]) || bounds[field] < (field === "width" || field === "height" ? 1 : 0)) {
      throw new Error(`${label}.${field} is invalid.`);
    }
  }
}

function validateTreatment(entry, index) {
  const label = `Source treatments[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object.`);
  if (!STABLE_KEY_PATTERN.test(entry.stableKey ?? "")) throw new Error(`${label}.stableKey is invalid.`);
  assertNonEmptyString(entry.treatmentId, `${label}.treatmentId`);
  const expectedPrefix = `${entry.stableKey.replace(":", "-")}__`;
  if (!entry.treatmentId.startsWith(expectedPrefix)) {
    throw new Error(`${label}.treatmentId must start with ${expectedPrefix}.`);
  }
  if (!TREATMENT_TYPES.has(entry.type)) throw new Error(`${label}.type is unsupported.`);
  assertNonEmptyString(entry.canonicalName, `${label}.canonicalName`);
  assertNonEmptyString(entry.originalTmdbLogoPath, `${label}.originalTmdbLogoPath`);
  assertHash(entry.originalTmdbSourceHash, `${label}.originalTmdbSourceHash`);
  if (!new Set(["dark", "light"]).has(entry.selectedBackground)) {
    throw new Error(`${label}.selectedBackground must be dark or light.`);
  }
  assertNonEmptyString(entry.ownerDecision, `${label}.ownerDecision`);

  if (entry.type === "owner-approved-text") {
    assertNonEmptyString(entry.text, `${label}.text`);
    if (entry.text !== entry.canonicalName) throw new Error(`${label}.text must match canonicalName exactly.`);
    if (entry.fontFamily !== "Inter") throw new Error(`${label}.fontFamily must be Inter.`);
    return;
  }

  assertHash(entry.sourceHash, `${label}.sourceHash`);
  if (!Number.isSafeInteger(entry.sourceWidth) || entry.sourceWidth < 1 ||
      !Number.isSafeInteger(entry.sourceHeight) || entry.sourceHeight < 1) {
    throw new Error(`${label} requires positive source dimensions.`);
  }
  assertNonEmptyString(entry.provenanceType, `${label}.provenanceType`);
  assertNonEmptyString(entry.provenanceConfidence, `${label}.provenanceConfidence`);
  assertNonEmptyString(entry.licenceOrRightsNote, `${label}.licenceOrRightsNote`);
  assertNonEmptyString(entry.sourcePageUrl, `${label}.sourcePageUrl`);
  assertNonEmptyString(entry.directAssetUrl, `${label}.directAssetUrl`);

  if (entry.type === "manual-source") {
    assertNonEmptyString(entry.sourcePath, `${label}.sourcePath`);
    return;
  }

  validateCropBounds(entry.cropBounds, `${label}.cropBounds`);
  if (entry.encoding !== "png-compression-9") throw new Error(`${label}.encoding must be png-compression-9.`);
  if (!Number.isFinite(entry.threshold) || entry.threshold < 0) throw new Error(`${label}.threshold is invalid.`);
  if (!Number.isSafeInteger(entry.padding) || entry.padding < 0) throw new Error(`${label}.padding is invalid.`);
}

export function validateSourceTreatmentConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new Error("Source treatment configuration must be an object.");
  }
  assertNonEmptyString(configuration.version, "Source treatment version");
  if (!Array.isArray(configuration.scope) || !Array.isArray(configuration.treatments)) {
    throw new Error("Source treatment configuration requires scope and treatments arrays.");
  }
  const seen = new Set();
  let previous = null;
  for (const [index, entry] of configuration.treatments.entries()) {
    validateTreatment(entry, index);
    if (seen.has(entry.stableKey)) throw new Error(`Duplicate source treatment for ${entry.stableKey}.`);
    if (previous && compareStableKeys(previous, entry.stableKey) >= 0) {
      throw new Error("Source treatments must be ordered by entity type and numeric TMDB ID.");
    }
    seen.add(entry.stableKey);
    previous = entry.stableKey;
  }
  if (configuration.scope.length !== configuration.treatments.length ||
      configuration.scope.some((stableKey, index) => stableKey !== configuration.treatments[index].stableKey)) {
    throw new Error("Source treatment scope must exactly match the ordered treatment stable keys.");
  }
  return configuration;
}

export async function loadSourceTreatmentConfiguration(packageRoot, preset) {
  const relativePath = preset.sourceTreatments;
  if (!relativePath) return { version: null, scope: [], treatments: [], byStableKey: new Map(), filePath: null };
  const filePath = path.resolve(packageRoot, relativePath);
  if (!isWithin(filePath, packageRoot)) throw new Error(`Source treatment configuration must remain inside the package: ${filePath}`);
  let configuration;
  try {
    configuration = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: null, scope: [], treatments: [], byStableKey: new Map(), filePath };
    }
    throw new Error(`Could not read source treatments ${filePath}: ${error.message}`);
  }
  validateSourceTreatmentConfiguration(configuration);
  return {
    ...configuration,
    filePath,
    byStableKey: new Map(configuration.treatments.map((entry) => [entry.stableKey, entry])),
  };
}

function treatmentFingerprint(version, treatment) {
  return bufferFingerprint(Buffer.from(JSON.stringify(["nuvio-source-treatment-v1", version, treatment])));
}

function recordMetadata(configuration, treatment, originalSource, effectiveSource) {
  const treatmentHash = treatmentFingerprint(configuration.version, treatment);
  return {
    treatmentId: treatment.treatmentId,
    treatmentType: treatment.type,
    treatmentVersion: configuration.version,
    treatmentHash,
    treatmentStatus: "applied",
    treatmentOwnerDecision: treatment.ownerDecision,
    treatmentSelectedBackground: treatment.selectedBackground,
    treatmentSourceHash: effectiveSource?.sourceHash ?? treatmentHash,
    treatmentSourcePageUrl: treatment.sourcePageUrl ?? null,
    treatmentDirectAssetUrl: treatment.directAssetUrl ?? null,
    treatmentProvenanceType: treatment.provenanceType ?? "owner-approved-text",
    treatmentProvenanceConfidence: treatment.provenanceConfidence ?? "owner-approved",
    treatmentLicenceOrRightsNote: treatment.licenceOrRightsNote ?? null,
    treatmentDerivation: treatment.type === "safe-source-crop" ? {
      cropBounds: treatment.cropBounds,
      threshold: treatment.threshold,
      padding: treatment.padding,
      backgroundRgbaApproximation: treatment.backgroundRgbaApproximation,
      encoding: treatment.encoding,
    } : treatment.derivation ?? null,
    originalTmdbLogoPath: treatment.originalTmdbLogoPath,
    originalTmdbSourcePath: originalSource.cachePath,
    originalTmdbSourceHash: originalSource.sourceHash,
    originalTmdbSourceUrl: originalSource.url ?? null,
  };
}

async function manualSource(packageRoot, treatment) {
  const manualRoot = path.join(packageRoot, "manual-sources");
  const sourcePath = path.resolve(packageRoot, treatment.sourcePath);
  if (!isWithin(sourcePath, manualRoot)) throw new Error(`Manual source must remain below manual-sources: ${sourcePath}`);
  const buffer = await fs.readFile(sourcePath);
  const sourceHash = bufferFingerprint(buffer);
  if (sourceHash !== treatment.sourceHash) throw new Error(`Manual source hash changed for ${treatment.stableKey}.`);
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  if (metadata.width !== treatment.sourceWidth || metadata.height !== treatment.sourceHeight) {
    throw new Error(`Manual source dimensions changed for ${treatment.stableKey}.`);
  }
  return {
    input: sourcePath,
    sourcePath,
    sourceHash,
    sourceFormat: metadata.format,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
  };
}

async function croppedSource(originalSource, treatment) {
  const buffer = await sharp(originalSource.cachePath, { failOn: "error" })
    .rotate()
    .extract(treatment.cropBounds)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const sourceHash = bufferFingerprint(buffer);
  if (sourceHash !== treatment.sourceHash) throw new Error(`Safe crop hash changed for ${treatment.stableKey}.`);
  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== treatment.sourceWidth || metadata.height !== treatment.sourceHeight) {
    throw new Error(`Safe crop dimensions changed for ${treatment.stableKey}.`);
  }
  return {
    input: buffer,
    sourcePath: null,
    sourceHash,
    sourceFormat: metadata.format,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
  };
}

export async function resolveSourceTreatment({ packageRoot, configuration, entity, originalSource } = {}) {
  const treatment = configuration?.byStableKey?.get(entity.stableKey);
  if (!treatment) return null;
  if (entity.name !== treatment.canonicalName) {
    throw new Error(`Canonical name changed for ${entity.stableKey}; source treatment owner review is required.`);
  }
  if (entity.logoPath !== treatment.originalTmdbLogoPath) {
    throw new Error(`TMDB logo path changed for ${entity.stableKey}; source treatment owner review is required.`);
  }
  if (!originalSource || originalSource.sourceHash !== treatment.originalTmdbSourceHash) {
    throw new Error(`TMDB source hash changed for ${entity.stableKey}; source treatment owner review is required.`);
  }

  let effectiveSource = null;
  let renderMode = "text";
  if (treatment.type === "manual-source") {
    effectiveSource = await manualSource(packageRoot, treatment);
    renderMode = "logo";
  } else if (treatment.type === "safe-source-crop") {
    effectiveSource = await croppedSource(originalSource, treatment);
    renderMode = "logo";
  }
  return {
    treatment,
    renderMode,
    effectiveSource,
    metadata: recordMetadata(configuration, treatment, originalSource, effectiveSource),
  };
}

export function sourceTreatmentBackgroundDecision(resolved, preset) {
  const treatment = resolved.treatment;
  const sourceHash = resolved.effectiveSource?.sourceHash ?? resolved.metadata.treatmentHash;
  return {
    selectedBackground: treatment.selectedBackground,
    reviewReasons: [],
    metadata: {
      backgroundDecisionVersion: preset.backgroundDecision?.version ?? null,
      backgroundDecisionSource: "owner-approved-source-treatment",
      backgroundDecisionReason: treatment.ownerDecision,
      backgroundDecisionSourceLogoHash: sourceHash,
      aggregateSelectedBackground: treatment.selectedBackground,
      automaticBackgroundDecision: null,
      manualBackgroundDecision: {
        status: "source-treatment-applied",
        configuredBackground: treatment.selectedBackground,
        configuredSourceLogoHash: sourceHash,
      },
      mixedContrastReviewResolution: {
        status: "not-applicable",
        approvedBackground: treatment.selectedBackground,
        configuredSourceLogoHash: sourceHash,
      },
      mixedContrastMetrics: null,
    },
  };
}

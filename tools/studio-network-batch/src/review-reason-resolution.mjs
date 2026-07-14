import fs from "node:fs/promises";
import path from "node:path";

import { compareStableKeys } from "./mixed-contrast.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REASON_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STABLE_KEY_PATTERN = /^(company|network):[1-9]\d*$/;

function compareResolutions(left, right) {
  const stableKeyOrder = compareStableKeys(left.stableKey, right.stableKey);
  return stableKeyOrder || left.reason.localeCompare(right.reason);
}

function assertWithinPackage(filePath, packageRoot) {
  const relative = path.relative(path.resolve(packageRoot), path.resolve(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Review reason resolutions must remain inside the package directory: ${filePath}`);
  }
}

export function validateReviewReasonResolutionConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new Error("Review reason resolution configuration must be an object.");
  }
  if (typeof configuration.version !== "string" || !configuration.version.trim()) {
    throw new Error("Review reason resolution configuration requires a non-empty version.");
  }
  if (!Array.isArray(configuration.groups)) {
    throw new Error("Review reason resolution groups must be a JSON array.");
  }
  const seen = new Set();
  let previousReason = null;
  for (const [groupIndex, group] of configuration.groups.entries()) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error(`Review reason resolution groups[${groupIndex}] must be an object.`);
    }
    if (!REASON_PATTERN.test(group.reason ?? "")) {
      throw new Error(`Review reason resolution groups[${groupIndex}] has an invalid reason.`);
    }
    if (previousReason && previousReason.localeCompare(group.reason) >= 0) {
      throw new Error("Review reason resolution groups must be ordered by reason.");
    }
    if (typeof group.approvalReason !== "string" || !group.approvalReason.trim()) {
      throw new Error(`Review reason resolution groups[${groupIndex}] requires a non-empty approvalReason.`);
    }
    if (!Array.isArray(group.bindings)) {
      throw new Error(`Review reason resolution groups[${groupIndex}].bindings must be an array.`);
    }
    let previousStableKey = null;
    for (const [bindingIndex, binding] of group.bindings.entries()) {
      if (!Array.isArray(binding) || ![2, 3].includes(binding.length)) {
        throw new Error(`Review reason resolution groups[${groupIndex}].bindings[${bindingIndex}] must contain stableKey, outputHash, and optional sourceLogoHash.`);
      }
      const [stableKey, outputHash, sourceLogoHash] = binding;
      if (!STABLE_KEY_PATTERN.test(stableKey ?? "")) {
        throw new Error(`Review reason resolution groups[${groupIndex}].bindings[${bindingIndex}] has an invalid stableKey.`);
      }
      if (!HASH_PATTERN.test(outputHash ?? "")) {
        throw new Error(`Review reason resolution groups[${groupIndex}].bindings[${bindingIndex}] has an invalid outputHash.`);
      }
      if (sourceLogoHash !== undefined && !HASH_PATTERN.test(sourceLogoHash ?? "")) {
        throw new Error(`Review reason resolution groups[${groupIndex}].bindings[${bindingIndex}] has an invalid sourceLogoHash.`);
      }
      if (previousStableKey && compareStableKeys(previousStableKey, stableKey) >= 0) {
        throw new Error(`Bindings for ${group.reason} must be ordered by entity type and numeric TMDB ID.`);
      }
      const key = `${stableKey}|${group.reason}`;
      if (seen.has(key)) throw new Error(`Review reason resolutions contain duplicate ${key}.`);
      seen.add(key);
      previousStableKey = stableKey;
    }
    previousReason = group.reason;
  }
  return configuration;
}

function expandResolutions(configuration) {
  return configuration.groups
    .flatMap((group) => group.bindings.map(([stableKey, outputHash, sourceLogoHash]) => ({
      stableKey,
      reason: group.reason,
      outputHash,
      ...(sourceLogoHash === undefined ? {} : { sourceLogoHash }),
      approvalReason: group.approvalReason,
    })))
    .sort(compareResolutions);
}

export async function loadReviewReasonResolutionConfiguration(packageRoot, preset) {
  const relativePath = preset.review?.reasonResolutions;
  if (!relativePath) {
    return { version: null, groups: [], resolutions: [], byStableKey: new Map() };
  }
  const filePath = path.resolve(packageRoot, relativePath);
  assertWithinPackage(filePath, packageRoot);
  let configuration;
  try {
    configuration = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read review reason resolutions ${filePath}: ${error.message}`);
  }
  validateReviewReasonResolutionConfiguration(configuration);
  const resolutions = expandResolutions(configuration);
  const byStableKey = new Map();
  for (const resolution of resolutions) {
    const current = byStableKey.get(resolution.stableKey) ?? [];
    current.push(resolution);
    byStableKey.set(resolution.stableKey, current);
  }
  return { ...configuration, resolutions, byStableKey };
}

function resolutionStatus(resolution, record) {
  if (resolution.outputHash !== record.outputHash) return "stale-output";
  if (resolution.sourceLogoHash !== undefined && resolution.sourceLogoHash !== record.sourceHash) {
    return "stale-source";
  }
  return "resolved";
}

export function applyReviewReasonResolutions(record, reviewReasons, configuration) {
  const configured = configuration?.byStableKey?.get(record.stableKey) ?? [];
  const resolutionsByReason = new Map(configured.map((resolution) => [resolution.reason, resolution]));
  const unresolvedReasons = [];
  const resolvedReviewReasons = [];
  const reviewReasonResolutionStatuses = configured.map((resolution) => ({
    reason: resolution.reason,
    status: resolutionStatus(resolution, record),
    outputHash: resolution.outputHash,
    sourceLogoHash: resolution.sourceLogoHash ?? null,
    approvalReason: resolution.approvalReason,
  }));
  const statusByReason = new Map(reviewReasonResolutionStatuses.map((status) => [status.reason, status]));
  for (const reason of [...new Set(reviewReasons ?? [])].sort()) {
    const resolution = resolutionsByReason.get(reason);
    const status = statusByReason.get(reason);
    if (resolution && status?.status === "resolved") {
      resolvedReviewReasons.push({
        reason,
        resolutionVersion: configuration.version,
        outputHash: resolution.outputHash,
        sourceLogoHash: resolution.sourceLogoHash ?? null,
        approvalReason: resolution.approvalReason,
      });
    } else {
      unresolvedReasons.push(reason);
    }
  }
  return {
    unresolvedReasons,
    resolvedReviewReasons,
    reviewReasonResolutionStatuses,
  };
}

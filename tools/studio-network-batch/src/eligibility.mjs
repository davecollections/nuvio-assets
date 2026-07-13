import fs from "node:fs/promises";
import path from "node:path";

export const CORE_MINIMUM_TITLE_COUNT = 100;
export const DEFAULT_ELIGIBILITY_CONFIGURATION = "config/eligibility.json";

function validateMinimum(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function validateEligibilityPolicy(value) {
  const eligibility = value?.eligibility ?? value;
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) {
    throw new Error("Eligibility configuration must contain an eligibility object.");
  }
  return Object.freeze({
    version: value?.version ?? "eligibility-override",
    companyMinimumTitleCount: validateMinimum(
      eligibility.companyMinimumTitleCount,
      "companyMinimumTitleCount",
    ),
    networkMinimumTitleCount: validateMinimum(
      eligibility.networkMinimumTitleCount,
      "networkMinimumTitleCount",
    ),
  });
}

export async function loadEligibilityPolicy(packageRoot, {
  configuration = DEFAULT_ELIGIBILITY_CONFIGURATION,
  companyMinimumTitleCount,
  networkMinimumTitleCount,
} = {}) {
  const configurationPath = path.resolve(packageRoot, configuration);
  const parsed = JSON.parse(await fs.readFile(configurationPath, "utf8"));
  const configured = validateEligibilityPolicy(parsed);
  return Object.freeze({
    ...configured,
    configurationPath,
    companyMinimumTitleCount: companyMinimumTitleCount === undefined
      ? configured.companyMinimumTitleCount
      : validateMinimum(companyMinimumTitleCount, "--company-min-titles"),
    networkMinimumTitleCount: networkMinimumTitleCount === undefined
      ? configured.networkMinimumTitleCount
      : validateMinimum(networkMinimumTitleCount, "--network-min-titles"),
    overridesApplied: companyMinimumTitleCount !== undefined || networkMinimumTitleCount !== undefined,
  });
}

export function minimumTitleCountFor(entityOrType, policy) {
  const entityType = typeof entityOrType === "string" ? entityOrType : entityOrType?.entityType;
  if (entityType === "company") return policy.companyMinimumTitleCount;
  if (entityType === "network") return policy.networkMinimumTitleCount;
  throw new Error(`Unsupported entity type for eligibility: ${entityType}`);
}

export function isAutomaticallyEligible(entity, policy) {
  return entity.titleCount >= minimumTitleCountFor(entity, policy);
}

export function classifyEligibilityTier(entity, policy, {
  curatedExceptionKeys = new Set(),
  explicit = false,
} = {}) {
  if (entity.titleCount >= CORE_MINIMUM_TITLE_COUNT) return "core";
  if (isAutomaticallyEligible(entity, policy)) return "expanded-threshold";
  if (curatedExceptionKeys.has(entity.stableKey)) return "curated-exception";
  return explicit ? "explicit" : null;
}

export function eligibilityRuleSummary(policy) {
  return `companies titleCount >= ${policy.companyMinimumTitleCount}; networks titleCount >= ${policy.networkMinimumTitleCount}`;
}

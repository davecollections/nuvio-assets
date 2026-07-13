import {
  CORE_MINIMUM_TITLE_COUNT,
  eligibilityRuleSummary,
  isAutomaticallyEligible,
} from "./eligibility.mjs";

function duplicates(items, valueFor) {
  const groups = new Map();
  for (const item of items) {
    const value = valueFor(item);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item.stableKey);
  }
  const values = [...groups.entries()]
    .filter(([, stableKeys]) => stableKeys.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, stableKeys]) => ({ value, stableKeys: stableKeys.sort() }));
  return {
    groups: values.length,
    records: values.reduce((sum, group) => sum + group.stableKeys.length, 0),
    values,
  };
}

function metrics(entities, validationErrorCount, eligibility, totalRecords = entities.length) {
  const eligible = entities.filter((entity) => isAutomaticallyEligible(entity, eligibility));
  const withLogos = eligible.filter((entity) => entity.logoPath);
  return {
    totalRecords,
    eligibleRecords: eligible.length,
    exactly100Records: entities.filter((entity) => entity.titleCount === CORE_MINIMUM_TITLE_COUNT).length,
    eligibleWithLogos: withLogos.length,
    eligibleWithoutLogos: eligible.length - withLogos.length,
    duplicateExactLogoPaths: duplicates(withLogos, (entity) => entity.logoPath),
    duplicateNormalisedNames: duplicates(eligible, (entity) =>
      entity.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
    ),
    validationErrors: validationErrorCount,
  };
}

export function buildAudit(sourceData, { eligibility } = {}) {
  if (!eligibility) throw new Error("Eligibility policy is required for audit.");
  const companies = sourceData.entities.filter((entity) => entity.entityType === "company");
  const networks = sourceData.entities.filter((entity) => entity.entityType === "network");
  const companyErrors = sourceData.validationErrors.filter(
    (error) => error.entityType === "company",
  ).length;
  const networkErrors = sourceData.validationErrors.length - companyErrors;

  return {
    generatedAt: new Date().toISOString(),
    sourceDirectory: sourceData.sourceDirectory,
    eligibility: {
      version: eligibility.version,
      companyMinimumTitleCount: eligibility.companyMinimumTitleCount,
      networkMinimumTitleCount: eligibility.networkMinimumTitleCount,
    },
    eligibilityRule: eligibilityRuleSummary(eligibility),
    company: metrics(companies, companyErrors, eligibility, sourceData.rawRecordCounts?.company),
    network: metrics(networks, networkErrors, eligibility, sourceData.rawRecordCounts?.network),
    combined: metrics(sourceData.entities, sourceData.validationErrors.length, eligibility, sourceData.rawRecordCounts?.combined),
    validationErrors: sourceData.validationErrors,
  };
}

export function formatAudit(audit) {
  const lines = [
    "Nuvio studio/network source audit",
    `Source: ${audit.sourceDirectory}`,
    `Eligibility: ${audit.eligibilityRule}`,
    "",
    "Type       Total  Eligible  Exactly 100  With logo  No logo  Dup logos  Dup names  Errors",
  ];
  for (const [label, key] of [
    ["Companies", "company"],
    ["Networks", "network"],
    ["Combined", "combined"],
  ]) {
    const value = audit[key];
    lines.push(
      `${label.padEnd(10)} ${String(value.totalRecords).padStart(6)}  ${String(value.eligibleRecords).padStart(8)}  ${String(value.exactly100Records).padStart(11)}  ${String(value.eligibleWithLogos).padStart(9)}  ${String(value.eligibleWithoutLogos).padStart(7)}  ${String(value.duplicateExactLogoPaths.groups).padStart(9)}  ${String(value.duplicateNormalisedNames.groups).padStart(9)}  ${String(value.validationErrors).padStart(6)}`,
    );
  }
  lines.push("", "Duplicate counts are eligible duplicate groups; JSON output includes their members.");
  return lines.join("\n");
}

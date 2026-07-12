const LOGO_PATH_PATTERN = /^\/[A-Za-z0-9._-]+\.(?:png|jpe?g|svg|webp)$/i;

export function isValidLogoPath(value) {
  return value === "" || LOGO_PATH_PATTERN.test(value);
}

function optionalString(record, key, label, errors) {
  const value = record[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    errors.push(`${label} must be a string when supplied`);
    return "";
  }
  return value.trim();
}

export function normaliseCompactRecord(record, entityType) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { entity: null, errors: ["record must be an object"] };
  }

  if (typeof record.i !== "number" || !Number.isSafeInteger(record.i) || record.i <= 0) {
    errors.push("i must be a positive safe integer TMDB ID");
  }

  const name = typeof record.n === "string" ? record.n.trim() : "";
  if (!name) errors.push("n must be a non-blank name");

  const titleCount = record.t === undefined ? 0 : record.t;
  if (
    typeof titleCount !== "number" ||
    !Number.isSafeInteger(titleCount) ||
    titleCount < 0
  ) {
    errors.push("t must be a non-negative safe integer title count");
  }

  const logoPath = optionalString(record, "l", "l", errors);
  if (logoPath && !isValidLogoPath(logoPath)) {
    errors.push("l must be an empty value or a relative TMDB image path");
  }

  const parentCompany =
    entityType === "company" ? optionalString(record, "p", "p", errors) : "";
  const originCountry = optionalString(record, "c", "c", errors);
  const headquarters = optionalString(record, "h", "h", errors);

  if (entityType !== "company" && entityType !== "network") {
    errors.push(`unsupported entity type: ${entityType}`);
  }

  if (errors.length) return { entity: null, errors };

  return {
    entity: {
      entityType,
      tmdbId: record.i,
      stableKey: `${entityType}:${record.i}`,
      name,
      titleCount,
      logoPath,
      parentCompany,
      originCountry,
      headquarters,
    },
    errors: [],
  };
}

export function normaliseCompactRecords(records, entityType) {
  const entities = [];
  const validationErrors = [];
  const seenIds = new Set();

  records.forEach((record, index) => {
    const result = normaliseCompactRecord(record, entityType);
    if (result.errors.length) {
      validationErrors.push({
        entityType,
        index,
        tmdbId: record && typeof record === "object" ? record.i ?? null : null,
        code: "invalid_record",
        messages: result.errors,
      });
      return;
    }

    if (seenIds.has(result.entity.tmdbId)) {
      validationErrors.push({
        entityType,
        index,
        tmdbId: result.entity.tmdbId,
        code: "duplicate_id",
        messages: [`duplicate TMDB ID ${result.entity.tmdbId} within ${entityType} records`],
      });
      return;
    }

    seenIds.add(result.entity.tmdbId);
    entities.push(result.entity);
  });

  return { entities, validationErrors };
}

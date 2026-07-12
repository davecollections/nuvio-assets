import fs from "node:fs/promises";
import path from "node:path";

import { SOURCE_FILES, compareEntities } from "./constants.mjs";
import { normaliseCompactRecords } from "./normalise.mjs";

async function readSourceArray(sourceDirectory, entityType) {
  const filePath = path.join(sourceDirectory, SOURCE_FILES[entityType]);
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing ${entityType} source JSON: ${filePath}`);
    }
    throw new Error(`Could not read ${entityType} source JSON ${filePath}: ${error.message}`);
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected a top-level array in ${filePath}.`);
  }
  return { filePath, records: value };
}

export async function loadSourceData(sourceDirectory) {
  const [companies, networks] = await Promise.all([
    readSourceArray(sourceDirectory, "company"),
    readSourceArray(sourceDirectory, "network"),
  ]);
  const companyResult = normaliseCompactRecords(companies.records, "company");
  const networkResult = normaliseCompactRecords(networks.records, "network");

  return {
    sourceDirectory,
    sourceFiles: {
      company: companies.filePath,
      network: networks.filePath,
    },
    rawRecordCounts: {
      company: companies.records.length,
      network: networks.records.length,
      combined: companies.records.length + networks.records.length,
    },
    entities: [...companyResult.entities, ...networkResult.entities].sort(compareEntities),
    validationErrors: [
      ...companyResult.validationErrors,
      ...networkResult.validationErrors,
    ],
  };
}

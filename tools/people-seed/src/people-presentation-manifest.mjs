import fs from "node:fs/promises";
import path from "node:path";

import { sha256, stableStringify } from "./people-publication.mjs";
import { validateAgainstSchema } from "./schema-validator.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "./people-artwork/runtime-dependencies.mjs";
import {
  PEOPLE_TITLE_LOGO_PUBLIC_ROOT,
  TITLE_LOGO_OPTION_IDS,
} from "./people-artwork/title-logo.mjs";

export const PEOPLE_PRESENTATION_MANIFEST_VERSION = "people-presentation-manifest-v1";
export const PEOPLE_PRESENTATION_MANIFEST_SCHEMA_PATH = "schemas/people-presentation-manifest.schema.json";
export const PEOPLE_PRESENTATION_MANIFEST_PUBLIC_PATH = "assets/collection_covers/people/presentation-manifest.json";
export const PEOPLE_SHARED_HERO_PATH = "assets/collection_covers/people/people hero backdrop.jpg";
export const PEOPLE_RAW_URL_ROOT = "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

export function presentationManifestFingerprintPayload(manifest) {
  const {
    generatedAt: _generatedAt,
    publishedAt: _publishedAt,
    manifestFingerprint: _manifestFingerprint,
    ...payload
  } = manifest;
  return payload;
}

export function calculatePresentationManifestFingerprint(manifest) {
  return sha256(stableStringify(presentationManifestFingerprintPayload(manifest)));
}

export async function inspectSharedPeopleHero({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT, sharp } = {}) {
  const heroPath = path.join(repoRoot, PEOPLE_SHARED_HERO_PATH);
  const buffer = await fs.readFile(heroPath);
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  assert(metadata.format === "jpeg" && Number.isInteger(metadata.width) && Number.isInteger(metadata.height), "Shared People hero must be a decodable JPEG.");
  return {
    repositoryPath: PEOPLE_SHARED_HERO_PATH,
    heroBackdropUrl: `${PEOPLE_RAW_URL_ROOT}${PEOPLE_SHARED_HERO_PATH.replaceAll(" ", "%20")}`,
    sha256: sha256(buffer),
    dimensions: { width: metadata.width, height: metadata.height },
    byteCount: buffer.length,
  };
}

export function buildPeoplePresentationManifest({ titleLogoMetadata, titleLogoOptionId, permanentSelection = false, sharedHero, generatedAt, status = "proof-candidate" } = {}) {
  assert(titleLogoMetadata?.recordCount > 0 && Array.isArray(titleLogoMetadata.records), "Title-logo metadata is required to build a presentation manifest.");
  assert(TITLE_LOGO_OPTION_IDS.includes(titleLogoOptionId), "An explicit D1/D2 title-logo proof option is required to build a presentation manifest proof.");
  assert(status === "proof-candidate" ? permanentSelection === false : permanentSelection === true, "Permanent title-logo selection status differs from the presentation-manifest stage.");
  const selectedRecords = titleLogoMetadata.records.filter((record) => record.optionId === titleLogoOptionId);
  assert(selectedRecords.length > 0 && selectedRecords.length === titleLogoMetadata.personCount, "Title-logo option records are incomplete.");
  const records = [...selectedRecords]
    .sort((left, right) => left.tmdbPersonId - right.tmdbPersonId)
    .map((record) => ({
      stableKey: record.stableKey,
      tmdbPersonId: record.tmdbPersonId,
      canonicalName: record.canonicalName,
      categories: [...record.categories],
      titleLogoPath: `${PEOPLE_TITLE_LOGO_PUBLIC_ROOT}/${record.tmdbPersonId}.png`,
      titleLogoUrl: `${PEOPLE_RAW_URL_ROOT}${PEOPLE_TITLE_LOGO_PUBLIC_ROOT}/${record.tmdbPersonId}.png`,
      titleLogoSha256: record.outputHash,
      dimensions: { width: record.canvasWidth, height: record.canvasHeight },
      byteCount: record.byteCount,
      ownerReviewStatus: record.ownerReviewStatus,
      distributionStatus: status === "proof-candidate" ? "proof-only" : status,
    }));
  const manifest = {
    version: PEOPLE_PRESENTATION_MANIFEST_VERSION,
    status,
    schemaPath: PEOPLE_PRESENTATION_MANIFEST_SCHEMA_PATH,
    generatedAt,
    ordering: "tmdb-person-id-ascending",
    recordCount: records.length,
    titleLogoCount: records.length,
    sharedHero,
    titleLogoOptionId,
    permanentSelection,
    rendererVersion: titleLogoMetadata.rendererVersion,
    titleLogoPreset: {
      id: titleLogoMetadata.presetId,
      sha256: titleLogoMetadata.presetHash,
      width: selectedRecords[0].canvasWidth,
      height: selectedRecords[0].canvasHeight,
    },
    fontEvidence: {
      family: titleLogoMetadata.records[0].fontFamily,
      weight: titleLogoMetadata.records[0].fontWeight,
      fontSha256: titleLogoMetadata.fontHash,
      fontLockSha256: titleLogoMetadata.fontLockHash,
      licenceSha256: titleLogoMetadata.records[0].licenceHash,
    },
    collectionFontEvidence: {
      family: selectedRecords[0].collectionFontFamily,
      style: "normal",
      weight: selectedRecords[0].collectionFontWeight,
      fontSha256: titleLogoMetadata.collectionFontHash,
      fontLockSha256: titleLogoMetadata.collectionFontLockHash,
      licence: selectedRecords[0].collectionLicence,
      licenceSha256: titleLogoMetadata.collectionLicenceHash,
      metadataSha256: titleLogoMetadata.collectionMetadataHash,
      sourceRevision: selectedRecords[0].collectionSourceRevision,
      usage: "COLLECTION only",
    },
    fingerprintExcludes: ["generatedAt", "publishedAt", "manifestFingerprint"],
    manifestFingerprint: null,
    records,
  };
  manifest.manifestFingerprint = calculatePresentationManifestFingerprint(manifest);
  return manifest;
}

function exactExpectedRecord(person) {
  return [person.tmdbPersonId, person.stableKey, person.canonicalName, person.categoryMembership];
}

export function validatePeoplePresentationManifest(manifest, schema, { expectedPeople = null, expectedHero = null } = {}) {
  const errors = validateAgainstSchema(manifest, schema, "people-presentation-manifest.json");
  if (manifest?.recordCount !== manifest?.records?.length) errors.push("presentation manifest recordCount must equal records length");
  if (manifest?.titleLogoCount !== manifest?.records?.length) errors.push("presentation manifest titleLogoCount must equal records length");
  if (manifest?.status === "proof-candidate" && manifest?.permanentSelection !== false) errors.push("presentation proof must not select a permanent title-logo option");
  const ids = new Set();
  const paths = new Set();
  for (const [index, record] of (Array.isArray(manifest?.records) ? manifest.records : []).entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (ids.has(record.tmdbPersonId)) errors.push(`${record.tmdbPersonId}: duplicate presentation identity`);
    if (paths.has(record.titleLogoPath)) errors.push(`${record.titleLogoPath}: duplicate presentation title-logo path`);
    ids.add(record.tmdbPersonId);
    paths.add(record.titleLogoPath);
    if (index > 0 && manifest.records[index - 1]?.tmdbPersonId >= record.tmdbPersonId) errors.push("presentation records must use ascending TMDB Person ID order");
    if (record.stableKey !== `person:${record.tmdbPersonId}`) errors.push(`${record.stableKey}: presentation stable key and TMDB Person ID differ`);
    if (record.titleLogoPath !== `${PEOPLE_TITLE_LOGO_PUBLIC_ROOT}/${record.tmdbPersonId}.png`) errors.push(`${record.stableKey}: presentation title-logo path differs from exact identity path`);
    if (record.titleLogoUrl !== `${PEOPLE_RAW_URL_ROOT}${record.titleLogoPath}`) errors.push(`${record.stableKey}: presentation title-logo URL differs from repository path`);
    const categoryOrder = ["actor", "director"].filter((category) => record.categories?.includes(category));
    if (stableStringify(categoryOrder) !== stableStringify(record.categories)) errors.push(`${record.stableKey}: presentation categories are not deterministic`);
  }
  if (manifest?.manifestFingerprint !== calculatePresentationManifestFingerprint(manifest)) errors.push("presentation manifest fingerprint does not match deterministic content");
  if (expectedPeople) {
    const expected = [...expectedPeople].sort((left, right) => left.tmdbPersonId - right.tmdbPersonId).map(exactExpectedRecord);
    const actual = (manifest.records || []).map((record) => [record.tmdbPersonId, record.stableKey, record.canonicalName, record.categories]);
    if (stableStringify(actual) !== stableStringify(expected)) errors.push("presentation records differ from the exact selected People identities and categories");
  }
  if (expectedHero && stableStringify(manifest?.sharedHero) !== stableStringify(expectedHero)) errors.push("presentation shared hero differs from exact inspected hero evidence");
  return errors;
}

export async function loadPeoplePresentationManifestSchema({ repoRoot = PEOPLE_ARTWORK_REPO_ROOT } = {}) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, PEOPLE_PRESENTATION_MANIFEST_SCHEMA_PATH), "utf8"));
}

export async function writePeoplePresentationManifestCandidate({ manifest, outputPath, schema, expectedPeople, expectedHero } = {}) {
  const errors = validatePeoplePresentationManifest(manifest, schema, { expectedPeople, expectedHero });
  if (errors.length) throw new Error(`People presentation manifest failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  await atomicWrite(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { outputPath, byteCount: Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`), manifestFingerprint: manifest.manifestFingerprint };
}

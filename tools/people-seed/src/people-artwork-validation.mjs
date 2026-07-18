import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "./schema-validator.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const APPROVED_OVERRIDES = Object.freeze({
  "person:5064": "/pSyM9cteYYWUBDalJzMPLH0SLgB.jpg",
  "person:8725": "/g3scfKWRDJIFsuphfv3Ylo2GyGH.jpg",
  "person:13566": "/sI3vtDTeGcV0uhumtZmYmfcOBav.jpg",
  "person:56208": "/szuJZR2uAyGnbhku6WjEM7JX8hK.jpg",
});
const RETAINED = new Set(["person:9076", "person:14353", "person:1079380"]);
const PRESET_FILES = [
  "people-landscape-cormorant-v1.json",
  "people-poster-cormorant-v1.json",
  "people-text-fallback-landscape-v2.json",
  "people-text-fallback-poster-v1.json",
];

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function readPeopleArtworkConfiguration(repoRoot) {
  const packageRoot = path.join(repoRoot, "tools", "people-seed");
  const [decisionsRaw, decisionSchemaRaw, metadataSchemaRaw, fontLockRaw, ...presetBuffers] = await Promise.all([
    fs.readFile(path.join(repoRoot, "data", "people", "portrait-source-decisions.json")),
    fs.readFile(path.join(repoRoot, "schemas", "portrait-source-decisions.schema.json")),
    fs.readFile(path.join(repoRoot, "schemas", "people-artwork-render-metadata.schema.json")),
    fs.readFile(path.join(packageRoot, "config", "cormorant-garamond-700.json")),
    ...PRESET_FILES.map((name) => fs.readFile(path.join(packageRoot, "presets", name))),
  ]);
  const presetRecords = Object.fromEntries(PRESET_FILES.map((name, index) => {
    const buffer = presetBuffers[index];
    const preset = JSON.parse(buffer);
    return [preset.id, { path: `tools/people-seed/presets/${name}`, hash: sha256(buffer), preset }];
  }));
  return {
    decisions: JSON.parse(decisionsRaw),
    decisionSchema: JSON.parse(decisionSchemaRaw),
    metadataSchema: JSON.parse(metadataSchemaRaw),
    fontLock: JSON.parse(fontLockRaw),
    presetRecords,
  };
}

export async function validatePeopleArtworkConfiguration({ repoRoot, registry }) {
  const configuration = await readPeopleArtworkConfiguration(repoRoot);
  const { decisions, decisionSchema, metadataSchema, fontLock, presetRecords } = configuration;
  const errors = validateAgainstSchema(decisions, decisionSchema, "portrait-source-decisions.json");
  if (decisions.recordCount !== decisions.records.length) errors.push("portrait-source-decisions recordCount does not match records length");
  if (decisions.records.length !== 7) errors.push("portrait-source decisions must contain exactly seven records");
  if (!decisions.records.every((item, index, records) => index === 0 || records[index - 1].tmdbPersonId < item.tmdbPersonId)) errors.push("portrait-source decisions must use numeric TMDB-ID ordering");
  const overrides = decisions.records.filter((item) => item.decision === "use-owner-selected");
  const retained = decisions.records.filter((item) => item.decision === "retain-registry-source");
  if (overrides.length !== 4) errors.push("portrait-source decisions must contain exactly four owner-selected overrides");
  if (retained.length !== 3) errors.push("portrait-source decisions must contain exactly three retained registry sources");
  if (!same(Object.fromEntries(overrides.map((item) => [item.stableKey, item.approvedProfilePath])), APPROVED_OVERRIDES)) errors.push("approved portrait override paths changed");
  if (!retained.every((item) => RETAINED.has(item.stableKey) && item.approvedProfilePath === item.registryProfilePath)) errors.push("retained registry-source decisions changed");
  const registryByKey = new Map(registry.records.map((item) => [item.stableKey, item]));
  for (const decision of decisions.records) {
    const person = registryByKey.get(decision.stableKey);
    if (!person || person.tmdbPersonId !== decision.tmdbPersonId || person.canonicalName !== decision.canonicalName) errors.push(`${decision.stableKey}: decision identity binding differs from the people registry`);
    if (person && person.profilePath !== decision.registryProfilePath) errors.push(`${decision.stableKey}: decision registryProfilePath differs from people-registry.json`);
  }

  const expectedPresetIds = PRESET_FILES.map((name) => name.replace(/\.json$/u, ""));
  if (!same(Object.keys(presetRecords), expectedPresetIds)) errors.push("tracked people preset IDs changed");
  for (const [presetId, record] of Object.entries(presetRecords)) {
    const preset = record.preset;
    if (preset.publicationAuthorised !== false || preset.status !== "production-candidate") errors.push(`${presetId}: preset must remain an unpublished production candidate`);
    if (preset.typography.family !== "Cormorant Garamond" || preset.typography.weight !== 700 || preset.typography.fontHash !== fontLock.fontSha256) errors.push(`${presetId}: font lock mismatch`);
    if (preset.renderer.sharp !== "0.35.3" || preset.renderer.libvips !== "8.18.3" || preset.renderer.skiaCanvas !== "3.0.8") errors.push(`${presetId}: renderer version lock mismatch`);
  }
  const portraitLandscape = presetRecords["people-landscape-cormorant-v1"].preset;
  const portraitPoster = presetRecords["people-poster-cormorant-v1"].preset;
  const fallbackLandscape = presetRecords["people-text-fallback-landscape-v2"].preset;
  const fallbackPoster = presetRecords["people-text-fallback-poster-v1"].preset;
  if (portraitLandscape.canvas.width !== 1200 || portraitLandscape.canvas.height !== 675 || portraitLandscape.typography.requestedFontSize !== 84 || portraitLandscape.typography.sizePolicy !== "R1-current-T2-nominal") errors.push("portrait landscape R1 configuration changed");
  if (portraitPoster.canvas.width !== 1000 || portraitPoster.canvas.height !== 1500 || portraitPoster.typography.requestedFontSize !== 114 || portraitPoster.typography.sizePolicy !== "R2-current-T2-plus-6-percent") errors.push("portrait poster R2 configuration changed");
  if (fallbackLandscape.typography.requestedFontSize !== 96 || fallbackLandscape.typography.lineHeight !== 87) errors.push("landscape fallback 96 px configuration changed");
  if (fallbackPoster.typography.requestedFontSize !== 114 || fallbackPoster.typography.lineHeight !== 100) errors.push("poster fallback 114 px configuration changed");
  if (fontLock.fontSha256 !== "b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0" || fontLock.licenceSha256 !== "60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956" || fontLock.weight !== 700) errors.push("Cormorant Garamond font lock changed");
  if (metadataSchema.properties?.version?.const !== "people-artwork-render-metadata-v1") errors.push("people artwork metadata contract version changed");

  const sourceCode = await fs.readFile(path.join(repoRoot, "tools", "people-seed", "src", "people-artwork", "source-resolution.mjs"), "utf8");
  if (/person\/images|person-images|search\/person|person\/\{person_id\}/iu.test(sourceCode)) errors.push("people renderer contains a prohibited TMDB metadata or person-images endpoint");
  if (!sourceCode.includes("https://image.tmdb.org/t/p/original/")) errors.push("people renderer exact TMDB image-CDN derivation is missing");

  return {
    errors,
    summary: {
      sourceDecisionCount: decisions.records.length,
      ownerSelectedCount: overrides.length,
      retainedRegistryCount: retained.length,
      presetHashes: Object.fromEntries(Object.entries(presetRecords).map(([id, record]) => [id, record.hash])),
      metadataContract: "schemas/people-artwork-render-metadata.schema.json",
      fontHash: fontLock.fontSha256,
      licenceHash: fontLock.licenceSha256,
      offlineDefault: true,
    },
    configuration,
  };
}

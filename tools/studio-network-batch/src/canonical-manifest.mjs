import crypto from "node:crypto";

export const CANONICAL_MANIFEST_V1 = "studio-network-canonical-manifest-v1";
export const CANONICAL_MANIFEST_V2 = "studio-network-canonical-manifest-v2";
export const POSTER_PUBLIC_PATH = "assets/collection_covers/networks/poster";

const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^studio-network-posters-v2-\d{4}-\d{2}-\d{2}$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function inventoryFingerprint(records) {
  return sha256(records
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((record) => `${record.path}|${record.bytes}|${record.sha256}`)
    .join("\n"));
}

export function posterApprovalHash(record) {
  return sha256(JSON.stringify(stableValue({
    decisionBinding: record.decisionBinding,
    outputHash: record.outputHash,
    ownerApprovalBasis: record.approvalBasis,
    presetVersion: record.presetVersion,
    rendererVersion: record.rendererVersion,
  })));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid canonical manifest: ${message}`);
}

function validateLandscape(manifest) {
  assert(Array.isArray(manifest.entries) && Array.isArray(manifest.publicationMetadata), "landscape sections are required.");
  assert(manifest.entries.length === manifest.entryCount, "entryCount does not match entries.");
  assert(manifest.publicationMetadata.length === manifest.entryCount, "publicationMetadata count does not match entries.");
  assert(manifest.companyCount + manifest.networkCount === manifest.entryCount, "entity counts do not sum to entryCount.");
  const keys = new Set();
  const paths = new Set();
  for (const entry of manifest.entries) {
    assert(entry.stable_key === `${entry.entity_type}:${entry.tmdb_id}`, `${entry.stable_key} has invalid identity.`);
    assert(!keys.has(entry.stable_key), `duplicate landscape ${entry.stable_key}.`);
    keys.add(entry.stable_key);
    assert(SHA256.test(entry.output_hash), `${entry.stable_key} has invalid output hash.`);
    assert(!paths.has(entry.output_path), `duplicate landscape path ${entry.output_path}.`);
    paths.add(entry.output_path);
  }
  const publicationKeys = new Set();
  for (const record of manifest.publicationMetadata) {
    assert(record.stableKey === `${record.entityType}:${record.tmdbId}`, `${record.stableKey} publication identity is invalid.`);
    assert(keys.has(record.stableKey), `${record.stableKey} publication metadata has no entry.`);
    assert(!publicationKeys.has(record.stableKey), `duplicate publication metadata ${record.stableKey}.`);
    publicationKeys.add(record.stableKey);
  }
  assert(publicationKeys.size === keys.size, "landscape publication coverage is incomplete.");
}

export function validateCanonicalManifest(manifest) {
  assert([CANONICAL_MANIFEST_V1, CANONICAL_MANIFEST_V2].includes(manifest?.version), "unsupported version.");
  validateLandscape(manifest);
  if (manifest.version === CANONICAL_MANIFEST_V1) return manifest;

  assert(RELEASE_ID.test(manifest.releaseId ?? ""), "v2 releaseId is invalid.");
  assert(!Number.isNaN(Date.parse(manifest.publishedAt)), "v2 publishedAt is invalid.");
  assert(manifest.posterEntrySchema === "tools/studio-network-batch/schemas/network-poster-publication-entry.schema.json", "poster entry schema path drifted.");
  assert(Array.isArray(manifest.posterPublicationMetadata), "posterPublicationMetadata is required.");
  assert(manifest.posterCount === manifest.networkCount, "every network must have one poster.");
  assert(manifest.posterPublicationMetadata.length === manifest.posterCount, "posterCount does not match metadata.");
  assert(manifest.landscapeAssetCount === manifest.entryCount, "landscapeAssetCount does not match entryCount.");
  assert(manifest.totalAssetCount === manifest.landscapeAssetCount + manifest.posterCount, "totalAssetCount is invalid.");

  const networkKeys = new Set(manifest.entries.filter((entry) => entry.entity_type === "network").map((entry) => entry.stable_key));
  const posterKeys = new Set();
  const posterPaths = new Set();
  const posterInventory = [];
  for (const poster of manifest.posterPublicationMetadata) {
    assert(Object.keys(poster).join(",") === [
      "stableKey", "entityType", "tmdbId", "canonicalName", "orientation", "publishPath", "outputHash",
      "byteCount", "width", "height", "format", "background", "renderMode", "sourceLogoPath", "sourceHash",
      "normalizedPixelHash", "decisionBinding", "approvalBasis", "approvalHash", "rendererVersion",
      "presetVersion", "releaseId", "publishedAt", "status",
    ].join(","), `${poster.stableKey} poster fields or order drifted.`);
    assert(poster.entityType === "network" && poster.stableKey === `network:${poster.tmdbId}`, `${poster.stableKey} has invalid identity.`);
    assert(networkKeys.has(poster.stableKey), `${poster.stableKey} is not a landscape network.`);
    assert(!posterKeys.has(poster.stableKey), `duplicate poster ${poster.stableKey}.`);
    posterKeys.add(poster.stableKey);
    assert(poster.orientation === "poster", `${poster.stableKey} has invalid orientation.`);
    assert(poster.publishPath === `${POSTER_PUBLIC_PATH}/${poster.tmdbId}.webp`, `${poster.stableKey} has invalid path.`);
    assert(!posterPaths.has(poster.publishPath), `duplicate poster path ${poster.publishPath}.`);
    posterPaths.add(poster.publishPath);
    assert(SHA256.test(poster.outputHash) && SHA256.test(poster.approvalHash), `${poster.stableKey} has invalid hash.`);
    assert(Number.isInteger(poster.byteCount) && poster.byteCount > 0, `${poster.stableKey} has invalid byte count.`);
    assert(poster.width === 1000 && poster.height === 1500 && poster.format === "webp", `${poster.stableKey} has invalid format.`);
    assert(["dark", "light"].includes(poster.background), `${poster.stableKey} has invalid background.`);
    assert(poster.releaseId === manifest.releaseId && poster.publishedAt === manifest.publishedAt, `${poster.stableKey} release binding drifted.`);
    assert(poster.approvalHash === posterApprovalHash(poster), `${poster.stableKey} approval hash drifted.`);
    assert(poster.decisionBinding?.stableKey === poster.stableKey &&
      poster.decisionBinding?.tmdbId === poster.tmdbId &&
      poster.decisionBinding?.orientation === "poster" &&
      poster.decisionBinding?.background === poster.background,
    `${poster.stableKey} decision identity binding drifted.`);
    if (poster.renderMode === "fallback-text") {
      assert(poster.sourceLogoPath === null && poster.sourceHash === null, `${poster.stableKey} fallback has a source.`);
      assert(poster.decisionBinding.kind === "approved-poster-fallback-v1" &&
        poster.decisionBinding.fallbackName === poster.canonicalName, `${poster.stableKey} fallback decision drifted.`);
    } else {
      assert(poster.renderMode === "generated-logo" &&
        poster.decisionBinding.kind === "poster-background-decision-v1", `${poster.stableKey} render decision drifted.`);
      assert(typeof poster.sourceLogoPath === "string" && SHA256.test(poster.sourceHash), `${poster.stableKey} source binding is missing.`);
      assert(poster.decisionBinding.sourceLogoPath === poster.sourceLogoPath && poster.decisionBinding.sourceLogoSha256 === poster.sourceHash, `${poster.stableKey} decision is stale.`);
    }
    posterInventory.push({
      path: poster.publishPath.replace("assets/collection_covers/", ""),
      bytes: poster.byteCount,
      sha256: poster.outputHash,
    });
  }
  assert(posterKeys.size === networkKeys.size && [...networkKeys].every((key) => posterKeys.has(key)), "network/poster coverage is incomplete.");
  assert(inventoryFingerprint(posterInventory) === manifest.posterAssetFingerprint, "poster asset fingerprint drifted.");
  assert(manifest.posterStagingContentFingerprint === manifest.posterAssetFingerprint, "poster staging fingerprint drifted.");
  const approvalState = sha256(JSON.stringify(stableValue(manifest.posterPublicationMetadata.map((poster) => ({
    stableKey: poster.stableKey,
    approvalHash: poster.approvalHash,
    outputHash: poster.outputHash,
  })))));
  assert(approvalState === manifest.posterApprovalStateHash, "poster approval-state hash drifted.");
  return manifest;
}

export function createCanonicalManifestV2({
  landscapeManifest,
  posterRecords,
  releaseId,
  publishedAt,
  landscapeInventory,
}) {
  assert(landscapeManifest?.version === CANONICAL_MANIFEST_V1, "input must be the canonical v1 manifest.");
  validateCanonicalManifest(landscapeManifest);
  assert(RELEASE_ID.test(releaseId ?? ""), "releaseId must match studio-network-posters-v2-YYYY-MM-DD.");
  assert(!Number.isNaN(Date.parse(publishedAt)), "publishedAt must be an ISO timestamp.");

  const posterPublicationMetadata = posterRecords
    .slice()
    .sort((left, right) => left.tmdbId - right.tmdbId)
    .map((record) => ({
      stableKey: record.stableKey,
      entityType: "network",
      tmdbId: record.tmdbId,
      canonicalName: record.name,
      orientation: "poster",
      publishPath: `${POSTER_PUBLIC_PATH}/${record.tmdbId}.webp`,
      outputHash: record.candidateSha256,
      byteCount: record.candidateBytes,
      width: 1000,
      height: 1500,
      format: "webp",
      background: record.background,
      renderMode: record.renderMode,
      sourceLogoPath: record.sourceLogoPath,
      sourceHash: record.sourceSha256,
      normalizedPixelHash: record.normalizedPixelSha256,
      decisionBinding: record.decisionBinding,
      approvalBasis: record.ownerApprovalBasis,
      approvalHash: record.approvalHash,
      rendererVersion: record.rendererVersion,
      presetVersion: record.presetVersion,
      releaseId,
      publishedAt,
      status: "published",
    }));
  const posterInventory = posterPublicationMetadata.map((poster) => ({
    path: poster.publishPath.replace("assets/collection_covers/", ""),
    bytes: poster.byteCount,
    sha256: poster.outputHash,
  }));
  const posterFingerprint = inventoryFingerprint(posterInventory);
  const landscapeFingerprint = inventoryFingerprint(landscapeInventory);
  assert(landscapeFingerprint === landscapeManifest.publishedAssetFingerprint,
    "landscape inventory fingerprint differs from the v1 manifest.");
  const posterApprovalStateHash = sha256(JSON.stringify(stableValue(posterPublicationMetadata.map((poster) => ({
    stableKey: poster.stableKey,
    approvalHash: poster.approvalHash,
    outputHash: poster.outputHash,
  })))));
  const manifest = {
    ...landscapeManifest,
    version: CANONICAL_MANIFEST_V2,
    releaseId,
    publishedAt,
    posterEntrySchema: "tools/studio-network-batch/schemas/network-poster-publication-entry.schema.json",
    posterApprovalStateHash,
    landscapeAssetFingerprint: landscapeFingerprint,
    posterStagingContentFingerprint: posterFingerprint,
    posterAssetFingerprint: posterFingerprint,
    publishedAssetFingerprint: inventoryFingerprint([...landscapeInventory, ...posterInventory]),
    landscapeAssetCount: landscapeInventory.length,
    posterCount: posterPublicationMetadata.length,
    totalAssetCount: landscapeInventory.length + posterPublicationMetadata.length,
    posterPublicationMetadata,
  };
  return validateCanonicalManifest(manifest);
}

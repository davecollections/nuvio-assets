import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const PROFILE_PATH = /^\/[A-Za-z0-9_-]+\.jpg$/u;
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

export const FALLBACK_REASONS = Object.freeze([
  "no-profile-path",
  "source-not-cached",
  "source-fetch-failed",
  "source-http-invalid",
  "source-content-type-invalid",
  "source-empty",
  "source-decode-failed",
  "source-dimensions-invalid",
  "source-validation-failed",
]);

export class SourceFailure extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "SourceFailure";
    this.reason = reason;
    this.details = details;
  }
}

export function deriveOriginalTmdbImageUrl(profilePath) {
  if (!PROFILE_PATH.test(profilePath || "")) throw new SourceFailure("source-validation-failed", `Invalid TMDB profile path: ${profilePath}`);
  return `https://image.tmdb.org/t/p/original/${profilePath.slice(1)}`;
}

export function resolveApprovedProfile(person, decisions) {
  const decision = decisions.records.find((item) => item.stableKey === person.stableKey) || null;
  if (decision) {
    if (decision.tmdbPersonId !== person.tmdbPersonId || decision.canonicalName !== person.canonicalName) {
      throw new SourceFailure("source-validation-failed", `${person.stableKey}: portrait decision identity binding drifted.`);
    }
    if (decision.registryProfilePath !== person.profilePath) {
      throw new SourceFailure("source-validation-failed", `${person.stableKey}: registry profile path no longer matches the approved decision.`);
    }
  }
  const profilePath = decision?.decision === "use-owner-selected"
    ? decision.approvedProfilePath
    : person.profilePath;
  return {
    profilePath,
    sourceDecision: decision?.decision || "registry-default",
    decision,
  };
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function readSourceCacheIndex(sourceCache) {
  const indexPath = path.join(path.resolve(sourceCache), "index.json");
  if (!(await exists(indexPath))) return { version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries: [] };
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  if (index.version !== "people-portrait-source-cache-v1" || !Array.isArray(index.entries)) {
    throw new SourceFailure("source-validation-failed", `Invalid source cache index: ${indexPath}`);
  }
  return index;
}

function resolveCacheFile(sourceCache, sourceFile) {
  if (!sourceFile || path.isAbsolute(sourceFile)) return sourceFile;
  return path.resolve(sourceCache, sourceFile);
}

async function validateSourceFile({ entry, sourceCache, expectedHash, sharp }) {
  const sourcePath = resolveCacheFile(sourceCache, entry.sourceFile);
  if (!sourcePath || !(await exists(sourcePath))) throw new SourceFailure("source-not-cached", `Cached portrait is absent: ${sourcePath || "unbound"}`);
  const buffer = await fs.readFile(sourcePath);
  if (buffer.length === 0) throw new SourceFailure("source-empty", `Cached portrait is empty: ${sourcePath}`);
  const sourceHash = sha256(buffer);
  if (entry.sourceHash && sourceHash !== entry.sourceHash) {
    throw new SourceFailure("source-validation-failed", `Cached portrait hash differs from its index binding: ${sourcePath}`);
  }
  if (expectedHash && sourceHash !== expectedHash) {
    throw new SourceFailure("source-validation-failed", `Cached portrait hash differs from the owner-approved source hash: ${sourcePath}`);
  }
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch (error) {
    throw new SourceFailure("source-decode-failed", `Cached portrait cannot be decoded: ${sourcePath}`, { error: error.message });
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) {
    throw new SourceFailure("source-dimensions-invalid", `Cached portrait dimensions are invalid: ${sourcePath}`);
  }
  if ((entry.width && entry.width !== metadata.width) || (entry.height && entry.height !== metadata.height)) {
    throw new SourceFailure("source-validation-failed", `Cached portrait dimensions differ from the index binding: ${sourcePath}`);
  }
  return {
    sourcePath,
    sourceHash,
    width: metadata.width,
    height: metadata.height,
    exifOrientation: metadata.orientation || entry.exifOrientation || 1,
    format: metadata.format,
    byteCount: buffer.length,
  };
}

async function atomicWrite(filePath, buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath);
}

async function fetchExactPortrait({ profilePath, fetchImpl, attempts, stableKey, retryDelay = async () => {} }) {
  const url = deriveOriginalTmdbImageUrl(profilePath);
  let lastFailure = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": "NuvioPeopleRenderer/1.0 (exact resolved TMDB portrait)" },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch (error) {
      attempts.push({ stableKey, profilePath, url, attempt, status: null, contentType: null, outcome: "fetch-failed", error: error.message });
      lastFailure = new SourceFailure("source-fetch-failed", `Portrait fetch failed for ${profilePath}`, { error: error.message });
      if (attempt < 2) { await retryDelay(300 * attempt); continue; }
      throw lastFailure;
    }
    const contentType = response.headers.get("content-type") || "";
    attempts.push({ stableKey, profilePath, url, attempt, status: response.status, contentType, outcome: response.ok ? "response-received" : "http-invalid" });
    if (!response.ok) {
      lastFailure = new SourceFailure("source-http-invalid", `Portrait CDN returned HTTP ${response.status} for ${profilePath}`);
      if (TRANSIENT_HTTP.has(response.status) && attempt < 2) { await retryDelay(300 * attempt); continue; }
      throw lastFailure;
    }
    if (!/^image\//iu.test(contentType)) throw new SourceFailure("source-content-type-invalid", `Portrait CDN returned ${contentType || "no content type"} for ${profilePath}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new SourceFailure("source-empty", `Portrait CDN returned empty bytes for ${profilePath}`);
    return { buffer, url, contentType };
  }
  throw lastFailure || new SourceFailure("source-fetch-failed", `Portrait fetch failed for ${profilePath}`);
}

async function normalizeDownloadedPortrait(buffer, sharp) {
  let rawMetadata;
  try { rawMetadata = await sharp(buffer, { failOn: "error" }).metadata(); } catch (error) {
    throw new SourceFailure("source-decode-failed", "Downloaded portrait cannot be decoded.", { error: error.message });
  }
  if (!Number.isInteger(rawMetadata.width) || !Number.isInteger(rawMetadata.height) || rawMetadata.width <= 0 || rawMetadata.height <= 0) {
    throw new SourceFailure("source-dimensions-invalid", "Downloaded portrait dimensions are invalid.");
  }
  let normalized;
  try {
    normalized = await sharp(buffer, { failOn: "error" }).rotate().toColorspace("srgb").png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  } catch (error) {
    throw new SourceFailure("source-decode-failed", "Downloaded portrait normalization failed.", { error: error.message });
  }
  const metadata = await sharp(normalized, { failOn: "error" }).metadata();
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) {
    throw new SourceFailure("source-dimensions-invalid", "Normalized portrait dimensions are invalid.");
  }
  return { normalized, metadata, rawMetadata };
}

async function acquireExactSource({ person, profilePath, expectedHash, sourceCache, sharp, fetchImpl, attempts, retryDelay }) {
  const response = await fetchExactPortrait({ profilePath, fetchImpl, attempts, stableKey: person.stableKey, retryDelay });
  const normalized = await normalizeDownloadedPortrait(response.buffer, sharp);
  const rawHash = sha256(response.buffer);
  const normalizedHash = sha256(normalized.normalized);
  if (expectedHash && rawHash !== expectedHash && normalizedHash !== expectedHash) {
    throw new SourceFailure("source-validation-failed", `${person.stableKey}: acquired exact portrait does not match the owner-approved raw or normalized source hash.`);
  }
  const fileName = profilePath.slice(1);
  const normalizedName = `${person.tmdbPersonId}-${sha256(profilePath).slice(0, 12)}.png`;
  const rawPath = path.join(path.resolve(sourceCache), "raw", String(person.tmdbPersonId), fileName);
  const normalizedPath = path.join(path.resolve(sourceCache), "normalized", normalizedName);
  const approvedRaw = Boolean(expectedHash && rawHash === expectedHash);
  const selectedPath = approvedRaw ? rawPath : normalizedPath;
  const selectedHash = approvedRaw ? rawHash : normalizedHash;
  const selectedMetadata = approvedRaw ? normalized.rawMetadata : normalized.metadata;
  await atomicWrite(rawPath, response.buffer);
  if (!approvedRaw) await atomicWrite(normalizedPath, normalized.normalized);
  const entry = {
    stableKey: person.stableKey,
    profilePath,
    sourceFile: path.relative(path.resolve(sourceCache), selectedPath).replaceAll("\\", "/"),
    sourceHash: selectedHash,
    width: selectedMetadata.width,
    height: selectedMetadata.height,
    exifOrientation: approvedRaw ? selectedMetadata.orientation || 1 : 1,
    cacheKind: approvedRaw ? "owner-approved-raw-original-cdn-source" : "normalized-original-cdn-source",
    rawFile: path.relative(path.resolve(sourceCache), rawPath).replaceAll("\\", "/"),
    rawHash,
    sourceUrl: response.url,
  };
  return entry;
}

export async function resolvePortraitSource({ person, decisions, sourceCache, offline = true, sharp, fetchImpl = fetch, retryDelay } = {}) {
  const attempts = [];
  let resolved;
  try { resolved = resolveApprovedProfile(person, decisions); } catch (error) {
    return { available: false, fallbackReason: error.reason || "source-validation-failed", sourceStatus: "decision-invalid", profilePathAttempted: null, sourceDecision: "registry-default", decision: null, attempts };
  }
  const { profilePath, sourceDecision, decision } = resolved;
  if (profilePath === null || profilePath === undefined || String(profilePath).trim() === "") {
    return { available: false, fallbackReason: "no-profile-path", sourceStatus: "no-profile-path", profilePathAttempted: profilePath || null, sourceDecision, decision, attempts };
  }
  if (!PROFILE_PATH.test(profilePath)) {
    return { available: false, fallbackReason: "source-validation-failed", sourceStatus: "profile-path-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
  let index;
  try { index = await readSourceCacheIndex(sourceCache); } catch (error) {
    return { available: false, fallbackReason: error.reason || "source-validation-failed", sourceStatus: "cache-index-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
  let entry = index.entries.find((item) => item.stableKey === person.stableKey && item.profilePath === profilePath) || null;
  if (entry) {
    try {
      const validated = await validateSourceFile({ entry, sourceCache, expectedHash: decision?.approvedSourceHash || null, sharp });
      return { available: true, fallbackReason: null, sourceStatus: "validated-cache-hit", profilePathAttempted: profilePath, sourceDecision, decision, cacheEntry: entry, ...validated, attempts };
    } catch (error) {
      if (offline) return { available: false, fallbackReason: error.reason || "source-validation-failed", sourceStatus: "cached-source-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
    }
  } else if (offline) {
    return { available: false, fallbackReason: "source-not-cached", sourceStatus: "source-not-cached", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
  try {
    entry = await acquireExactSource({ person, profilePath, expectedHash: decision?.approvedSourceHash || null, sourceCache, sharp, fetchImpl, attempts, retryDelay });
    const entries = index.entries.filter((item) => !(item.stableKey === person.stableKey && item.profilePath === profilePath));
    entries.push(entry);
    entries.sort((left, right) => left.stableKey.localeCompare(right.stableKey) || left.profilePath.localeCompare(right.profilePath));
    const updated = { version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries };
    await atomicWrite(path.join(path.resolve(sourceCache), "index.json"), Buffer.from(`${JSON.stringify(updated, null, 2)}\n`));
    const validated = await validateSourceFile({ entry, sourceCache, expectedHash: decision?.approvedSourceHash || null, sharp });
    return { available: true, fallbackReason: null, sourceStatus: "network-acquired-exact-profile-path", profilePathAttempted: profilePath, sourceDecision, decision, cacheEntry: entry, ...validated, attempts };
  } catch (error) {
    return { available: false, fallbackReason: error.reason || "source-fetch-failed", sourceStatus: "source-acquisition-failed", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
}

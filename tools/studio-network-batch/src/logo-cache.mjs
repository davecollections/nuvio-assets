import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import sharp from "sharp";

import { atomicWrite } from "./atomic.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";
import { PipelineError } from "./pipeline-error.mjs";
import { TMDB_IMAGE_BASE_URL } from "./constants.mjs";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function logoUrlFor(logoPath) {
  if (typeof logoPath !== "string" || !logoPath.startsWith("/")) {
    throw new PipelineError("invalid_logo_path", `Invalid TMDB logo path: ${logoPath}`);
  }
  return `${TMDB_IMAGE_BASE_URL}${logoPath}`;
}

export function logoCacheKey(logoPath) {
  return createHash("sha256").update(logoUrlFor(logoPath), "utf8").digest("hex");
}

function safeExtension(logoPath) {
  const extension = path.posix.extname(logoPath).toLowerCase();
  return /^\.(?:png|jpe?g|svg|webp)$/.test(extension) ? extension : ".img";
}

export function logoCachePath(cacheDirectory, logoPath) {
  return path.join(cacheDirectory, `${logoCacheKey(logoPath)}${safeExtension(logoPath)}`);
}

async function inspectImage(buffer, sourcePath) {
  if (!buffer.length) throw new PipelineError("empty_response", "Logo response was empty.");
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).rotate().metadata();
  } catch (error) {
    throw new PipelineError("decode_failed", `Sharp could not decode ${sourcePath}: ${error.message}`, { cause: error });
  }
  if (!metadata.width || !metadata.height) {
    throw new PipelineError("zero_size_image", `Decoded logo has invalid dimensions: ${sourcePath}`);
  }
  return metadata;
}

async function readValidCache(cachePath) {
  try {
    const buffer = await fs.readFile(cachePath);
    const metadata = await inspectImage(buffer, cachePath);
    return { buffer, metadata };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createLogoDownloader({
  cacheDirectory,
  fetchImpl = globalThis.fetch,
  offline = false,
  sharpImpl = sharp,
  timeoutMs = 20_000,
  retries = 2,
  retryDelayMs = 500,
  userAgent = "NuvioStudioNetworkBatch/0.2 (local artwork utility)",
  sleep = wait,
} = {}) {
  if (!cacheDirectory) throw new Error("cacheDirectory is required");
  if (!offline && typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const inRun = new Map();

  async function download(logoPath, { refresh = false } = {}) {
    if (inRun.has(logoPath)) {
      const existing = await inRun.get(logoPath);
      return { ...existing, reused: true, reuseKind: "in-run" };
    }
    const promise = downloadOnce(logoPath, { refresh });
    inRun.set(logoPath, promise);
    try {
      return await promise;
    } catch (error) {
      inRun.delete(logoPath);
      throw error;
    }
  }

  async function downloadOnce(logoPath, { refresh }) {
    const url = logoUrlFor(logoPath);
    const cachePath = logoCachePath(cacheDirectory, logoPath);
    if (offline && refresh) {
      throw new PipelineError("offline_cache_refresh_forbidden", `Offline mode cannot refresh the logo cache: ${logoPath}`);
    }
    if (!refresh) {
      const cached = await readValidCache(cachePath);
      if (cached) {
        return describe(cached.buffer, cached.metadata, { logoPath, url, cachePath, reused: true, reuseKind: "cache" });
      }
    }
    if (offline) {
      throw new PipelineError("offline_cache_miss", `Offline generation requires a valid cached logo: ${cachePath}`);
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: { "user-agent": userAgent, accept: "image/*" },
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new PipelineError("http_failure", `TMDB image request failed with HTTP ${response.status}: ${url}`);
          if (!TRANSIENT_STATUS.has(response.status) || attempt === retries) throw error;
          lastError = error;
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        const contentType = response.headers?.get?.("content-type") ?? "";
        if (contentType && !contentType.toLowerCase().startsWith("image/")) {
          throw new PipelineError("unsupported_content_type", `Expected an image response but received ${contentType}: ${url}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new PipelineError("empty_response", `TMDB returned an empty logo: ${url}`);
        let metadata;
        try {
          metadata = await sharpImpl(buffer, { failOn: "error" }).rotate().metadata();
        } catch (error) {
          throw new PipelineError("decode_failed", `Sharp could not decode downloaded logo ${url}: ${error.message}`, { cause: error });
        }
        if (!metadata.width || !metadata.height) throw new PipelineError("zero_size_image", `Downloaded logo has zero dimensions: ${url}`);
        await atomicWrite(cachePath, buffer);
        return describe(buffer, metadata, { logoPath, url, cachePath, reused: false, reuseKind: null });
      } catch (error) {
        const normalised = error.name === "AbortError"
          ? new PipelineError("download_timeout", `TMDB logo request timed out after ${timeoutMs} ms: ${url}`, { cause: error })
          : error instanceof PipelineError
            ? error
            : new PipelineError("download_failed", `TMDB logo request failed: ${url}: ${error.message}`, { cause: error });
        lastError = normalised;
        const retryable = normalised.code === "download_timeout" || normalised.code === "download_failed";
        if (!retryable || attempt === retries) throw normalised;
      } finally {
        clearTimeout(timer);
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
    throw lastError;
  }

  return { download };
}

function describe(buffer, metadata, fields) {
  return {
    ...fields,
    sourceHash: bufferFingerprint(buffer),
    sourceFormat: metadata.format ?? "unknown",
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    sourceBytes: buffer.length,
  };
}

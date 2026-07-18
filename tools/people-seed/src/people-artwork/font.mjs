import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

const lockPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "config", "cormorant-garamond-700.json");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function readFontLock() {
  return JSON.parse(await fs.readFile(lockPath, "utf8"));
}

export function parseFvar(buffer) {
  const numTables = buffer.readUInt16BE(4);
  let offset = null;
  let length = null;
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    if (buffer.toString("ascii", record, record + 4) === "fvar") {
      offset = buffer.readUInt32BE(record + 8);
      length = buffer.readUInt32BE(record + 12);
      break;
    }
  }
  if (offset === null) throw new Error("Cormorant Garamond fvar table is unavailable.");
  const axesOffset = buffer.readUInt16BE(offset + 4);
  const axisCount = buffer.readUInt16BE(offset + 8);
  const axisSize = buffer.readUInt16BE(offset + 10);
  const axes = [];
  for (let index = 0; index < axisCount; index += 1) {
    const axis = offset + axesOffset + index * axisSize;
    axes.push({
      tag: buffer.toString("ascii", axis, axis + 4),
      minimum: buffer.readInt32BE(axis + 4) / 65536,
      default: buffer.readInt32BE(axis + 8) / 65536,
      maximum: buffer.readInt32BE(axis + 12) / 65536,
    });
  }
  return { fvarOffset: offset, fvarLength: length, axes };
}

function runFamilies(metrics) {
  return [...new Set((metrics.lines || []).flatMap((line) => (line.runs || []).map((run) => run.family)))];
}

export async function discoverFontCache({ fontDirectory = null } = {}) {
  const lock = await readFontLock();
  const candidates = [
    fontDirectory,
    process.env.NUVIO_PEOPLE_FONT_DIR,
    path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, ".work", "fonts", lock.cacheDirectoryName),
    path.join(PEOPLE_ARTWORK_REPO_ROOT, lock.legacyApprovedCache),
  ].filter(Boolean).map((item) => path.resolve(item));
  for (const directory of candidates) {
    const fontPath = path.join(directory, lock.fontFileName);
    const licencePath = path.join(directory, lock.licenceFileName);
    if (await exists(fontPath) && await exists(licencePath)) return { directory, fontPath, licencePath, candidates };
  }
  throw new Error(`Approved Cormorant Garamond cache is unavailable. Run npm --prefix tools/people-seed run acquire-people-font -- --font-dir <ignored-cache-dir>. Checked:\n${candidates.map((item) => `- ${item}`).join("\n")}`);
}

export async function verifyFont({ Canvas, FontLibrary, names = [], fontDirectory = null } = {}) {
  const lock = await readFontLock();
  const cache = await discoverFontCache({ fontDirectory });
  const [fontBuffer, licenceBuffer] = await Promise.all([fs.readFile(cache.fontPath), fs.readFile(cache.licencePath)]);
  const fontHash = sha256(fontBuffer);
  const licenceHash = sha256(licenceBuffer);
  if (fontHash !== lock.fontSha256) throw new Error(`Cormorant font hash mismatch: ${fontHash}`);
  if (licenceHash !== lock.licenceSha256) throw new Error(`Cormorant licence hash mismatch: ${licenceHash}`);
  const variation = parseFvar(fontBuffer);
  const weightAxis = variation.axes.find((axis) => axis.tag === lock.weightAxis.tag);
  if (!weightAxis || weightAxis.minimum > lock.weight || weightAxis.maximum < lock.weight) {
    throw new Error("Cormorant Garamond genuine weight 700 is unavailable.");
  }
  FontLibrary.reset();
  const loaded = FontLibrary.use(lock.registrationAlias, cache.fontPath);
  if (!FontLibrary.has(lock.registrationAlias)) throw new Error("Exact cached Cormorant font registration failed.");
  const glyphCoverage = [];
  for (const text of [...new Set(names)].sort((left, right) => left.localeCompare(right))) {
    const canvas = new Canvas(3200, 300);
    const context = canvas.getContext("2d");
    context.font = `${lock.weight} 96px "${lock.registrationAlias}"`;
    const families = runFamilies(context.measureText(text));
    const covered = families.length > 0 && families.every((family) => family === lock.family);
    if (!covered) throw new Error(`Required glyph fallback detected for ${text}: ${families.join(", ")}`);
    glyphCoverage.push({ text, families, covered });
  }
  return {
    valid: true,
    family: lock.family,
    registrationAlias: lock.registrationAlias,
    weight: lock.weight,
    genuineWeight700: true,
    fontHash,
    licenceHash,
    variation,
    glyphCoverage,
    fontPath: cache.fontPath,
    licencePath: cache.licencePath,
    loaded,
  };
}

async function atomicWrite(filePath, buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath);
}

async function downloadExact(url, expectedHash, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "NuvioPeopleFontAcquisition/1.0" },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Font acquisition HTTP ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`Font acquisition returned empty bytes: ${url}`);
  const actualHash = sha256(buffer);
  if (actualHash !== expectedHash) throw new Error(`Font acquisition hash mismatch for ${url}: ${actualHash}`);
  return buffer;
}

export async function acquireFont({ fontDirectory, fetchImpl = fetch } = {}) {
  if (!fontDirectory) throw new Error("Explicit --font-dir is required for font acquisition.");
  const lock = await readFontLock();
  const destination = path.resolve(fontDirectory);
  const [fontBuffer, licenceBuffer] = await Promise.all([
    downloadExact(lock.fontSourceUrl, lock.fontSha256, fetchImpl),
    downloadExact(lock.licenceSourceUrl, lock.licenceSha256, fetchImpl),
  ]);
  const fontPath = path.join(destination, lock.fontFileName);
  const licencePath = path.join(destination, lock.licenceFileName);
  await Promise.all([atomicWrite(fontPath, fontBuffer), atomicWrite(licencePath, licenceBuffer)]);
  return { acquired: true, networkRequests: 2, destination, fontPath, licencePath, fontHash: lock.fontSha256, licenceHash: lock.licenceSha256 };
}

export { runFamilies };

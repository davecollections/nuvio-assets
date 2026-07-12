import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { bufferFingerprint } from "./fingerprints.mjs";

export const INTER_SAMPLE_TEXT = "Inter diagnostic: Il1| MW@%& 0123456789 agQy Äé—";
export const NON_PRODUCTION_FONT_STACK = "Inter, Segoe UI, Arial, Helvetica, sans-serif";

export function defaultWindowsFontDirectories(environment = process.env) {
  return [
    "C:\\Windows\\Fonts",
    environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : null,
  ].filter(Boolean);
}

async function discoverInterFonts(fontDirectories) {
  const discovered = [];
  for (const directory of fontDirectories) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EACCES") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/inter/i.test(entry.name) || !/\.(otf|ttf|ttc|woff2?)$/i.test(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      const statistics = await fs.stat(filePath);
      discovered.push({ directory, fileName: entry.name, filePath, bytes: statistics.size });
    }
  }
  return discovered.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderFontSample(fontFamily, sharpImpl = sharp) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="180">
    <rect width="100%" height="100%" fill="#08141C"/>
    <text x="34" y="116" fill="#E4E7E9" font-family="${escapeXml(fontFamily)}" font-size="64" font-weight="600">${escapeXml(INTER_SAMPLE_TEXT)}</text>
  </svg>`);
  return sharpImpl(svg).png({ compressionLevel: 9 }).toBuffer();
}

async function renderSamples({ requestedFamily, fallbackFamily, sharpImpl = sharp } = {}) {
  const requested = await renderFontSample(requestedFamily, sharpImpl);
  const fallback = await renderFontSample(fallbackFamily, sharpImpl);
  const diagnosticSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="540">
    <rect width="100%" height="100%" fill="#08141C"/>
    <text x="34" y="44" fill="#8FA1AC" font-family="Arial, sans-serif" font-size="22">Requested: ${escapeXml(requestedFamily)}</text>
    <text x="34" y="128" fill="#E4E7E9" font-family="${escapeXml(requestedFamily)}" font-size="58" font-weight="600">${escapeXml(INTER_SAMPLE_TEXT)}</text>
    <text x="34" y="214" fill="#8FA1AC" font-family="Arial, sans-serif" font-size="22">Fallback comparison: ${escapeXml(fallbackFamily)}</text>
    <text x="34" y="298" fill="#E4E7E9" font-family="${escapeXml(fallbackFamily)}" font-size="58" font-weight="600">${escapeXml(INTER_SAMPLE_TEXT)}</text>
    <text x="34" y="384" fill="#8FA1AC" font-family="Arial, sans-serif" font-size="22">Explicit Segoe UI comparison</text>
    <text x="34" y="468" fill="#E4E7E9" font-family="Segoe UI" font-size="58" font-weight="600">${escapeXml(INTER_SAMPLE_TEXT)}</text>
  </svg>`);
  const diagnostic = await sharpImpl(diagnosticSvg).png({ compressionLevel: 9 }).toBuffer();
  return { requested, fallback, diagnostic };
}

export async function checkInterAvailability({
  requestedFamily = "Inter",
  fallbackFamily = "Segoe UI, Arial, Helvetica, sans-serif",
  fontDirectories = defaultWindowsFontDirectories(),
  renderSamplesImpl = renderSamples,
  sharpImpl = sharp,
  diagnosticPath = null,
  reportPath = null,
} = {}) {
  const discoveredFonts = await discoverInterFonts(fontDirectories);
  const samples = await renderSamplesImpl({ requestedFamily, fallbackFamily, sharpImpl });
  const requestedHash = bufferFingerprint(samples.requested);
  const fallbackHash = bufferFingerprint(samples.fallback);
  const requestedDiffersFromFallback = requestedHash !== fallbackHash;
  const confirmed = discoveredFonts.length > 0 && requestedDiffersFromFallback;
  const result = {
    requestedFamily,
    fallbackComparisonFamily: fallbackFamily,
    fontDirectories,
    discoveredFonts,
    renderer: {
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
      pango: sharp.versions.pango,
      fontconfig: sharp.versions.fontconfig,
      rsvg: sharp.versions.rsvg,
    },
    renderComparison: { requestedHash, fallbackHash, requestedDiffersFromFallback },
    confirmed,
    appearsAvailableToRenderer: confirmed,
    safeToContinueProductionFallbackRendering: confirmed,
    manualConfirmationRequired: !confirmed,
    diagnosticPath,
    conclusion: confirmed
      ? "Inter was discovered in a Windows font directory and rendered differently from the fallback-only stack."
      : "Inter could not be confirmed for Sharp/libvips/Pango; production-v1 fallback rendering is blocked.",
  };
  if (diagnosticPath) await atomicWrite(diagnosticPath, samples.diagnostic);
  if (reportPath) await atomicWriteJson(reportPath, result);
  return result;
}

export function assertProductionFallbackFont(preset, result) {
  if (!preset.fallbackText?.requireConfirmedFont) return;
  const required = preset.fallbackText.requiredFontFamily ?? "Inter";
  if (!result?.confirmed || result.requestedFamily !== required) {
    const error = new Error(
      `Production fallback rendering requires confirmed ${required}. Run npm run font-check, install/enable the font outside this repository, then retry only the fallback IDs.`,
    );
    error.code = "required_font_unavailable";
    throw error;
  }
}

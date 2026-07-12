import path from "node:path";
import fs from "node:fs/promises";

import sharp from "sharp";

import { atomicWrite } from "./atomic.mjs";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(value, maximum) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function labelSvg(item, width, height) {
  const name = escapeXml(truncate(item.name, 38));
  const identity = escapeXml(`${item.tmdbId} · ${item.entityType}`);
  const detail = escapeXml(`${item.backgroundPreset ?? "n/a"} · ${item.renderStatus ?? item.status}`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#33383D"/>
    <text x="10" y="22" fill="#FFFFFF" font-family="Segoe UI,Arial,sans-serif" font-size="16" font-weight="600">${name}</text>
    <text x="10" y="43" fill="#D9DDE0" font-family="Segoe UI,Arial,sans-serif" font-size="13">${identity}</text>
    <text x="10" y="61" fill="#BAC1C6" font-family="Segoe UI,Arial,sans-serif" font-size="12">${detail}</text>
  </svg>`);
}

async function coverThumbnail(item, width, height, sharpImpl) {
  if (item.outputPath) {
    try {
      const source = await fs.readFile(item.outputPath);
      return await sharpImpl(source).resize(width, height, { fit: "fill" }).png().toBuffer();
    } catch {
      // A visible failure tile is more useful than aborting the whole review sheet.
    }
  }
  const message = escapeXml(item.errorCode ?? "NO OUTPUT");
  return sharpImpl(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#5A1E24"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF" font-family="Segoe UI,Arial,sans-serif" font-size="22">${message}</text>
  </svg>`)).png().toBuffer();
}

export async function createContactSheet(items, outputPath, {
  columns = 5,
  thumbnailWidth = 300,
  thumbnailHeight = 169,
  labelHeight = 72,
  gap = 16,
  margin = 40,
  sharpImpl = sharp,
} = {}) {
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const cellHeight = thumbnailHeight + labelHeight;
  const width = margin * 2 + columns * thumbnailWidth + (columns - 1) * gap;
  const height = margin * 2 + rows * cellHeight + (rows - 1) * gap;
  const composites = [];
  for (const [index, item] of items.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (thumbnailWidth + gap);
    const top = margin + row * (cellHeight + gap);
    composites.push({ input: await coverThumbnail(item, thumbnailWidth, thumbnailHeight, sharpImpl), left, top });
    composites.push({ input: labelSvg(item, thumbnailWidth, labelHeight), left, top: top + thumbnailHeight });
  }
  const buffer = await sharpImpl({
    create: { width, height, channels: 4, background: "#555B60" },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  await atomicWrite(outputPath, buffer);
  return { outputPath, width, height, items: items.length, bytes: buffer.length };
}

export function primaryContactSheetPath(packageRoot, presetVersion) {
  return path.join(packageRoot, ".work", "contact-sheets", presetVersion, "primary.png");
}

export function variantContactSheetPath(packageRoot, presetVersion) {
  return path.join(packageRoot, ".work", "contact-sheets", presetVersion, "variants.png");
}

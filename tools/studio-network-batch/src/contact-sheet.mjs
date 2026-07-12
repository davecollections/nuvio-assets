import path from "node:path";
import fs from "node:fs/promises";

import sharp from "sharp";

import { atomicWrite } from "./atomic.mjs";
import { compareEntities } from "./constants.mjs";

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
  const defaultLines = [
    item.name,
    `${item.tmdbId} · ${item.entityType}`,
    `${item.backgroundPreset ?? "n/a"} · ${item.renderStatus ?? item.status}${item.reviewStatus === "needs-review" ? " · needs-review" : ""}`,
  ];
  const lines = (item.contactSheetLabelLines ?? defaultLines).map((line) => truncate(String(line), 54));
  const text = lines.map((line, index) => {
    const y = index === 0 ? 21 : 21 + index * 17;
    const colour = index === 0 ? "#FFFFFF" : index === 1 ? "#D9DDE0" : "#BAC1C6";
    const size = index === 0 ? 15 : 11;
    const weight = index === 0 ? ' font-weight="600"' : "";
    return `<text x="10" y="${y}" fill="${colour}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}"${weight}>${escapeXml(line)}</text>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#33383D"/>
    ${text}
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

export function orderContactSheetItems(items) {
  return [...items].sort((left, right) =>
    compareEntities(left, right) || String(left.variantName ?? "").localeCompare(String(right.variantName ?? "")),
  );
}

export function paginateContactSheetItems(items, { pageSize = 64 } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("Contact-sheet page size must be a positive integer.");
  const ordered = orderContactSheetItems(items);
  const pages = [];
  for (let index = 0; index < ordered.length; index += pageSize) {
    pages.push(ordered.slice(index, index + pageSize));
  }
  return pages;
}

export function pagedContactSheetPath(packageRoot, presetVersion, group, pageNumber) {
  const digits = String(pageNumber).padStart(2, "0");
  return path.join(
    packageRoot,
    ".work",
    "contact-sheets",
    presetVersion,
    group,
    `${group}-page-${digits}.png`,
  );
}

export async function createPagedContactSheets(items, packageRoot, presetVersion, options = {}) {
  const { rows = 8, ...sheetOptions } = options;
  const columns = sheetOptions.columns ?? 8;
  const pageSize = columns * rows;
  const definitions = [
    ["companies", items.filter((item) => item.entityType === "company")],
    ["networks", items.filter((item) => item.entityType === "network")],
    ["combined", items],
  ];
  const groups = {};
  for (const [group, groupItems] of definitions) {
    const pages = paginateContactSheetItems(groupItems, { pageSize });
    groups[group] = [];
    for (const [index, pageItems] of pages.entries()) {
      const outputPath = pagedContactSheetPath(packageRoot, presetVersion, group, index + 1);
      const result = await createContactSheet(pageItems, outputPath, { columns, ...sheetOptions });
      groups[group].push({
        ...result,
        pageNumber: index + 1,
        stableKeys: pageItems.map((item) => item.stableKey),
        tmdbIds: pageItems.map((item) => item.tmdbId),
      });
    }
  }
  return {
    pageSize,
    totalSheets: Object.values(groups).reduce((sum, pages) => sum + pages.length, 0),
    groups,
  };
}

export function primaryContactSheetPath(packageRoot, presetVersion) {
  return path.join(packageRoot, ".work", "contact-sheets", presetVersion, "primary.png");
}

export function variantContactSheetPath(packageRoot, presetVersion) {
  return path.join(packageRoot, ".work", "contact-sheets", presetVersion, "variants.png");
}

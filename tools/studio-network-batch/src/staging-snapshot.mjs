import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function walkFiles(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) result.push(entryPath);
    }
  }
  await visit(directory);
  return result.sort((left, right) => left.localeCompare(right));
}

export async function snapshotProductionDirectory(directory) {
  const files = await walkFiles(directory);
  const records = [];
  for (const filePath of files) {
    const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    records.push({
      path: path.relative(directory, filePath).replaceAll("\\", "/"),
      bytes: buffer.length,
      sha256: hash(buffer),
      mtimeMs: stat.mtimeMs,
    });
  }
  return {
    count: records.length,
    combinedFingerprint: hash(records.map((record) => `${record.path}|${record.bytes}|${record.sha256}`).join("\n")),
    mtimeFingerprint: hash(records.map((record) => `${record.path}|${record.mtimeMs}`).join("\n")),
    records,
  };
}

export function compareProductionSnapshots(before, after) {
  const beforeByPath = new Map(before.records.map((record) => [record.path, record]));
  const afterByPath = new Map(after.records.map((record) => [record.path, record]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();
  const changed = [];
  const unchanged = [];
  for (const filePath of paths) {
    const left = beforeByPath.get(filePath);
    const right = afterByPath.get(filePath);
    const contentChanged = !left || !right || left.bytes !== right.bytes || left.sha256 !== right.sha256;
    const mtimeChanged = !left || !right || left.mtimeMs !== right.mtimeMs;
    (contentChanged || mtimeChanged ? changed : unchanged).push({
      path: filePath,
      before: left ?? null,
      after: right ?? null,
      contentChanged,
      mtimeChanged,
    });
  }
  return { changed, unchanged };
}

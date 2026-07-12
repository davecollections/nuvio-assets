import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TRANSIENT_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_ERRORS.has(error.code) || attempt >= 5) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

export async function atomicWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, data);
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

import fs from "node:fs/promises";

export async function readStableKeyArray(filePath, label = "IDs file") {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} not found: ${filePath}`);
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${label}: ${error.message}`);
    throw error;
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must be a JSON array of stable-key strings.`);
  }
  return parsed;
}

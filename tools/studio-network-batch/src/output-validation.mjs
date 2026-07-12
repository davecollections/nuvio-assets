import fs from "node:fs/promises";

import sharp from "sharp";

import { bufferFingerprint } from "./fingerprints.mjs";
import { PipelineError } from "./pipeline-error.mjs";

export async function validateOutput(filePath, preset, { sharpImpl = sharp } = {}) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new PipelineError("output_missing", `Output does not exist: ${filePath}`);
    throw error;
  }
  if (!buffer.length) throw new PipelineError("invalid_output", `Output is empty: ${filePath}`);
  let metadata;
  try {
    metadata = await sharpImpl(buffer, { failOn: "error" }).metadata();
  } catch (error) {
    throw new PipelineError("invalid_output", `Sharp cannot decode output ${filePath}: ${error.message}`, { cause: error });
  }
  if (
    metadata.width !== preset.canvas.width ||
    metadata.height !== preset.canvas.height ||
    metadata.format !== "webp"
  ) {
    throw new PipelineError(
      "invalid_output",
      `Expected ${preset.canvas.width}x${preset.canvas.height} WebP but received ${metadata.width}x${metadata.height} ${metadata.format}: ${filePath}`,
    );
  }
  return {
    outputHash: bufferFingerprint(buffer),
    outputBytes: buffer.length,
    outputWidth: metadata.width,
    outputHeight: metadata.height,
    outputFormat: metadata.format,
  };
}

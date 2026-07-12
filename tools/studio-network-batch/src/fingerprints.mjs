import { createHash } from "node:crypto";

import {
  DEFAULT_PRESET_VERSION,
  DEFAULT_RENDERER_VERSION,
} from "./constants.mjs";

function hashFields(namespace, fields) {
  const canonical = JSON.stringify([namespace, ...fields]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function sourceRecordFingerprint(entity) {
  return hashFields("nuvio-source-record-v1", [
    entity.entityType,
    entity.tmdbId,
    entity.name,
    entity.titleCount,
    entity.logoPath,
  ]);
}

export function artworkInputFingerprint(
  entity,
  {
    rendererVersion = DEFAULT_RENDERER_VERSION,
    presetVersion = DEFAULT_PRESET_VERSION,
    fallbackTextUsed = !entity.logoPath,
  } = {},
) {
  return hashFields("nuvio-artwork-input-v1", [
    entity.entityType,
    entity.tmdbId,
    entity.logoPath,
    fallbackTextUsed ? entity.name : null,
    rendererVersion,
    presetVersion,
  ]);
}

export function bufferFingerprint(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

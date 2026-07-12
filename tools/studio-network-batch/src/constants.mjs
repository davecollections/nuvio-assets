export const ELIGIBILITY_THRESHOLD = 100;

export const SOURCE_FILES = Object.freeze({
  company: "data/companies.min.json",
  network: "data/tv-networks.min.json",
});

export const ENTITY_ORDER = Object.freeze({ company: 0, network: 1 });

export const DEFAULT_RENDERER_VERSION = "renderer-not-implemented";
export const DEFAULT_PRESET_VERSION = "poc-v1";

export function outputPathFor(entity) {
  const folder = entity.entityType === "company" ? "companies" : "networks";
  return `assets/collection_covers/${folder}/${entity.tmdbId}.webp`;
}

export function compareEntities(left, right) {
  return (
    ENTITY_ORDER[left.entityType] - ENTITY_ORDER[right.entityType] ||
    left.tmdbId - right.tmdbId
  );
}

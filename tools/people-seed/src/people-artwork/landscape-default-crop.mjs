import crypto from "node:crypto";

export const PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID = "people-landscape-default-chin-safe-v1";

export const PEOPLE_LANDSCAPE_TIER_1_SLIGHT = Object.freeze({
  id: "tier-1-slight",
  targetWidth: 594,
  targetHeight: 675,
  targetRight: 1098,
  targetTop: 0,
});

const POLICY_DOCUMENT = Object.freeze({
  version: "people-landscape-default-crop-policy-v1",
  id: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
  scope: "net-new-people-landscapes-only",
  exactOverridePrecedence: true,
  defaultTier: PEOPLE_LANDSCAPE_TIER_1_SLIGHT,
  sourceBoundFallback: "maximum-safe-source-area",
});

export const PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH = crypto
  .createHash("sha256")
  .update(JSON.stringify(POLICY_DOCUMENT))
  .digest("hex");

const round = (value, places = 6) => Number(value.toFixed(places));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function orientedDimensions(source) {
  return [5, 6, 7, 8].includes(source?.exifOrientation)
    ? { width: source.height, height: source.width }
    : { width: source?.width, height: source?.height };
}

function treatmentRecord({ person, source, presetRecord, cropRectangle, tier, sourceBoundLimited }) {
  const target = PEOPLE_LANDSCAPE_TIER_1_SLIGHT;
  return {
    stableKey: person.stableKey,
    tmdbPersonId: person.tmdbPersonId,
    canonicalName: person.canonicalName,
    format: "landscape",
    status: "active",
    sourceProfilePath: source.profilePathAttempted,
    sourceHash: source.sourceHash,
    basePresetId: presetRecord.preset.id,
    basePresetHash: presetRecord.presetHash,
    cropStrategy: sourceBoundLimited
      ? "net-new-tier-1-source-bound-maximum-v1"
      : "net-new-tier-1-slight-landscape-v1",
    cropRectangle,
    cropScale: {
      x: round(target.targetWidth / cropRectangle.width),
      y: round(target.targetHeight / cropRectangle.height),
    },
    cropOffsetX: target.targetRight - target.targetWidth,
    cropOffsetY: target.targetTop,
    reason: "owner-reviewed-complete-set-chin-jaw-beard-breathing-room",
    prototypeTier: tier,
  };
}

export function resolvePeopleLandscapeDefaultCrop({ person, source, formatId, presetRecord, policyId = PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID } = {}) {
  assert(policyId === PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID, `Unsupported People Landscape default crop policy: ${policyId}`);
  if (formatId !== "landscape") return { used: false, treatmentKind: "default-policy", status: "not-applicable-format", policyId, policyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH };
  if (!source?.available) return { used: false, treatmentKind: "default-policy", status: "source-unavailable-fallback", policyId, policyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH };
  assert(presetRecord?.preset?.id === "people-landscape-cormorant-v1", `${person.stableKey}: the net-new Landscape crop policy requires the locked Landscape preset.`);
  const oriented = orientedDimensions(source);
  assert(Number.isInteger(oriented.width) && oriented.width > 0 && Number.isInteger(oriented.height) && oriented.height > 0, `${person.stableKey}: invalid oriented source dimensions.`);
  const tier = PEOPLE_LANDSCAPE_TIER_1_SLIGHT;
  const requiredHeight = Math.round(oriented.width * tier.targetHeight / tier.targetWidth);
  let sourceBoundLimited = requiredHeight > oriented.height;
  let cropRectangle;
  if (!sourceBoundLimited) {
    cropRectangle = { left: 0, top: 0, width: oriented.width, height: requiredHeight };
  } else {
    const maximumWidth = Math.max(1, Math.min(oriented.width, Math.round(oriented.height * tier.targetWidth / tier.targetHeight)));
    cropRectangle = { left: Math.floor((oriented.width - maximumWidth) / 2), top: 0, width: maximumWidth, height: oriented.height };
  }
  const record = treatmentRecord({ person, source, presetRecord, cropRectangle, tier: tier.id, sourceBoundLimited });
  return {
    used: true,
    treatmentKind: "default-policy",
    id: policyId,
    status: sourceBoundLimited ? "source-bound-maximum" : "active-tier-1-slight",
    configHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    policyId,
    policyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    sourceBoundLimited,
    record,
  };
}

export function peopleLandscapeDefaultCropPolicyDocument() {
  return structuredClone(POLICY_DOCUMENT);
}

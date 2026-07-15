import { applyReviewReasonResolutions } from "./review-reason-resolution.mjs";
import { compareStableKeys } from "./mixed-contrast.mjs";

export const FINAL_REVIEW_EXCEPTION_KEYS = Object.freeze([
  "company:12852",
  "company:23761",
  "company:24546",
  "network:1795",
]);

export const SAFE_FINAL_REVIEW_ACTIONS = Object.freeze([
  "approve-reason-as-is",
  "retain-current-background",
]);

const BACKGROUND_REVIEW_REASON = "mixed-contrast-background-review";

function actionPair(action) {
  return `${action.stableKey}|${action.reason}`;
}

function countBy(items, selector) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function compareActions(left, right) {
  return compareStableKeys(left.stableKey, right.stableKey) || left.reason.localeCompare(right.reason);
}

export function reconcileFinalReviewActions({
  proposedActions,
  records,
  draftEntries,
  expectedActionCounts = null,
  exceptionKeys = FINAL_REVIEW_EXCEPTION_KEYS,
} = {}) {
  if (!Array.isArray(proposedActions) || !Array.isArray(records) || !Array.isArray(draftEntries)) {
    throw new Error("Final review reconciliation requires proposal, production-record, and draft-entry arrays.");
  }
  const recordsByKey = new Map(records.map((record) => [record.stableKey, record]));
  const draftByKey = new Map(draftEntries.map((entry) => [entry.stableKey, entry]));
  const liveReasons = new Map(records.flatMap((record) => (record.reviewReasons ?? []).map((reason) => [
    `${record.stableKey}|${reason}`,
    { record, reason },
  ])));
  const seen = new Set();
  const liveActions = [];
  const historicalActions = [];

  for (const action of proposedActions) {
    const pair = actionPair(action);
    if (seen.has(pair)) throw new Error(`Duplicate proposed action ${pair}.`);
    seen.add(pair);
    const live = liveReasons.get(pair);
    if (!live) {
      historicalActions.push(action);
      continue;
    }
    if (!SAFE_FINAL_REVIEW_ACTIONS.includes(action.proposedAction)) {
      throw new Error(`Live final-review action ${pair} is not authorised: ${action.proposedAction}.`);
    }
    if (exceptionKeys.includes(action.stableKey)) {
      throw new Error(`Resolved exception key unexpectedly remains live: ${pair}.`);
    }
    const { record } = live;
    if (action.canonicalName !== record.name) throw new Error(`Canonical name changed for ${pair}.`);
    if (action.outputHash !== record.outputHash) throw new Error(`Staged output hash changed for ${pair}.`);
    if ((action.sourceHash ?? null) !== (record.sourceHash ?? null)) throw new Error(`Source hash changed for ${pair}.`);
    if (action.proposedAction === "retain-current-background"
      && (action.currentBackground !== record.selectedBackground || action.recommendedBackground !== record.selectedBackground)) {
      throw new Error(`Retain-current background no longer matches production for ${pair}.`);
    }
    const draftEntry = draftByKey.get(action.stableKey);
    if (!draftEntry || draftEntry.outputHash !== action.outputHash || !(draftEntry.reasons ?? []).includes(action.reason)) {
      throw new Error(`Current review draft does not contain the exact hash-bound reason ${pair}.`);
    }
    liveActions.push(action);
  }

  const liveActionPairs = new Set(liveActions.map(actionPair));
  const uncoveredReasons = [...liveReasons.keys()].filter((pair) => !liveActionPairs.has(pair)).sort();
  if (uncoveredReasons.length) {
    throw new Error(`Current review reasons lack an owner-approved proposal: ${uncoveredReasons.join(", ")}`);
  }
  const actionCounts = countBy(liveActions, (action) => action.proposedAction);
  if (expectedActionCounts && JSON.stringify(actionCounts) !== JSON.stringify(expectedActionCounts)) {
    throw new Error(`Live action counts differ from the owner-approved scope: ${JSON.stringify(actionCounts)}.`);
  }
  const exceptionRows = historicalActions.filter((action) => exceptionKeys.includes(action.stableKey));
  const unexpectedHistorical = historicalActions.filter((action) => !exceptionKeys.includes(action.stableKey));
  if (unexpectedHistorical.length) {
    throw new Error(`Proposal rows disappeared outside the four completed exceptions: ${unexpectedHistorical.map(actionPair).join(", ")}`);
  }
  return {
    liveActions: liveActions.sort(compareActions),
    historicalActions: historicalActions.sort(compareActions),
    liveActionCount: liveActions.length,
    liveRecordCount: new Set(liveActions.map((action) => action.stableKey)).size,
    historicalActionCount: historicalActions.length,
    historicalExceptionRows: exceptionRows.length,
    actionCounts,
    reasonCounts: countBy(liveActions, (action) => action.reason),
  };
}

function addReasonBindings(configuration, actions) {
  const updated = structuredClone(configuration);
  updated.version = "final-review-reason-resolutions-v1";
  const groupsByReason = new Map(updated.groups.map((group) => [group.reason, group]));
  for (const action of actions) {
    if (action.reason === BACKGROUND_REVIEW_REASON) continue;
    const group = groupsByReason.get(action.reason);
    if (!group) throw new Error(`No review-reason resolution group exists for ${action.reason}.`);
    if (group.bindings.some(([stableKey]) => stableKey === action.stableKey)) {
      throw new Error(`A review-reason resolution already exists for ${actionPair(action)}.`);
    }
    group.bindings.push([
      action.stableKey,
      action.outputHash,
      ...(action.sourceHash ? [action.sourceHash] : []),
    ]);
  }
  for (const group of updated.groups) {
    group.bindings.sort(([left], [right]) => compareStableKeys(left, right));
  }
  return updated;
}

function addBackgroundResolutions(configuration, actions, recordsByKey) {
  const updated = structuredClone(configuration);
  const existingByKey = new Map(updated.map((entry) => [entry.stableKey, entry]));
  const retainedKeys = [...new Set(actions
    .filter((action) => action.proposedAction === "retain-current-background")
    .map((action) => action.stableKey))]
    .sort(compareStableKeys);
  for (const stableKey of retainedKeys) {
    const record = recordsByKey.get(stableKey);
    if (!record?.sourceHash) throw new Error(`Retained background ${stableKey} has no source hash.`);
    if (existingByKey.has(stableKey)) {
      throw new Error(`A background review resolution already exists for ${stableKey}.`);
    }
    const entry = {
      stableKey,
      backgroundPreset: record.selectedBackground,
      sourceLogoHash: record.sourceHash,
      reason: "Owner approved final publication-readiness background",
      name: record.name,
    };
    updated.push(entry);
    existingByKey.set(stableKey, entry);
  }
  updated.sort((left, right) => compareStableKeys(left.stableKey, right.stableKey));
  return updated;
}

export function buildFinalReviewResolutionConfigurations({
  liveActions,
  records,
  reasonConfiguration,
  backgroundResolutions,
} = {}) {
  const recordsByKey = new Map(records.map((record) => [record.stableKey, record]));
  const nextReasonConfiguration = addReasonBindings(reasonConfiguration, liveActions);
  const nextBackgroundResolutions = addBackgroundResolutions(backgroundResolutions, liveActions, recordsByKey);
  return {
    reasonConfiguration: nextReasonConfiguration,
    backgroundResolutions: nextBackgroundResolutions,
    addedReasonBindings: liveActions.filter((action) => action.reason !== BACKGROUND_REVIEW_REASON).length,
    addedBackgroundResolutions: nextBackgroundResolutions.length - backgroundResolutions.length,
  };
}

function backgroundResolutionStatus(record, configuration) {
  const resolution = configuration?.resolutionByKey?.get(record.stableKey);
  if (!resolution) return { status: "not-configured", resolution: null };
  if (resolution.sourceLogoHash !== record.sourceHash) return { status: "stale-source", resolution };
  if (resolution.backgroundPreset !== record.selectedBackground) return { status: "background-mismatch", resolution };
  return { status: "resolved", resolution };
}

export function applyReviewResolutionsInMemory(records, reasonConfiguration, backgroundConfiguration) {
  return records.map((record) => {
    const generic = applyReviewReasonResolutions(record, record.reviewReasons ?? [], reasonConfiguration);
    const background = backgroundResolutionStatus(record, backgroundConfiguration);
    const unresolvedReasons = generic.unresolvedReasons.filter((reason) =>
      reason !== BACKGROUND_REVIEW_REASON || background.status !== "resolved",
    );
    const newlyResolved = [...generic.resolvedReviewReasons];
    if ((record.reviewReasons ?? []).includes(BACKGROUND_REVIEW_REASON) && background.status === "resolved") {
      newlyResolved.push({
        reason: BACKGROUND_REVIEW_REASON,
        resolutionVersion: backgroundConfiguration.version,
        outputHash: record.outputHash,
        sourceLogoHash: background.resolution.sourceLogoHash,
        approvalReason: background.resolution.reason,
      });
    }
    const existingResolved = new Map((record.resolvedReviewReasons ?? []).map((item) => [item.reason, item]));
    for (const item of newlyResolved) existingResolved.set(item.reason, item);
    const unresolvedStatus = unresolvedReasons.length
      || (record.reviewStatus === "needs-review" && !(record.reviewReasons ?? []).length)
      ? "needs-review"
      : "unreviewed";
    return {
      ...record,
      reviewReasons: unresolvedReasons,
      reviewStatus: unresolvedStatus,
      resolvedReviewReasons: [...existingResolved.values()].sort((left, right) => left.reason.localeCompare(right.reason)),
      effectiveReviewResolution: {
        persistentReasonCount: (record.reviewReasons ?? []).length,
        effectiveReasonCount: unresolvedReasons.length,
        backgroundResolutionStatus: background.status,
      },
    };
  });
}

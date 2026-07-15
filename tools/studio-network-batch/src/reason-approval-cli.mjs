#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteJson } from "./atomic.mjs";
import { loadBackgroundDecisionConfiguration, validateBackgroundDecisionConfiguration } from "./background-decision.mjs";
import {
  applyReviewResolutionsInMemory,
  buildFinalReviewResolutionConfigurations,
  reconcileFinalReviewActions,
} from "./reason-approval.mjs";
import {
  loadReviewReasonResolutionConfiguration,
  validateReviewReasonResolutionConfiguration,
} from "./review-reason-resolution.mjs";
import { readCurrentProductionRecords } from "./review-prep.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.slice(2).includes("--apply");
for (const argument of process.argv.slice(2)) {
  if (argument !== "--apply" && argument !== "--json") throw new Error(`Unknown option: ${argument}`);
}

const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", "production-v1.json"), "utf8"));
const reportsRoot = path.join(packageRoot, ".work", "reports", preset.version);
const reviewRoot = path.join(packageRoot, ".work", "reviews", preset.version);
const proposalPath = path.join(packageRoot, ".work", "publication-readiness", "proposed-actions", "reason-level-actions.json");
const [records, draftEntries, proposalDocument, reasonLoaded, backgroundLoaded] = await Promise.all([
  readCurrentProductionRecords(reportsRoot),
  fs.readFile(path.join(reviewRoot, "review-state-draft.json"), "utf8").then(JSON.parse),
  fs.readFile(proposalPath, "utf8").then(JSON.parse),
  loadReviewReasonResolutionConfiguration(packageRoot, preset),
  loadBackgroundDecisionConfiguration(packageRoot, preset),
]);

const reconciliation = reconcileFinalReviewActions({
  proposedActions: proposalDocument.actions,
  records,
  draftEntries,
  expectedActionCounts: {
    "approve-reason-as-is": 154,
    "retain-current-background": 121,
  },
});
if (reconciliation.liveActionCount !== 275 || reconciliation.liveRecordCount !== 233) {
  throw new Error(`Final review scope must contain exactly 275 reason rows across 233 records.`);
}

const reasonConfiguration = {
  version: reasonLoaded.version,
  groups: reasonLoaded.groups.map(({ reason, approvalReason, bindings }) => ({ reason, approvalReason, bindings })),
};
const updates = buildFinalReviewResolutionConfigurations({
  liveActions: reconciliation.liveActions,
  records,
  reasonConfiguration,
  backgroundResolutions: backgroundLoaded.reviewResolutions,
});
validateReviewReasonResolutionConfiguration(updates.reasonConfiguration);
validateBackgroundDecisionConfiguration({
  manualDecisions: backgroundLoaded.manualDecisions,
  reviewResolutions: updates.backgroundResolutions,
});

const reasonPath = path.resolve(packageRoot, preset.review.reasonResolutions);
const backgroundPath = path.resolve(packageRoot, preset.backgroundDecision.reviewResolutions);
if (apply) {
  await Promise.all([
    atomicWriteJson(reasonPath, updates.reasonConfiguration),
    atomicWriteJson(backgroundPath, updates.backgroundResolutions),
  ]);
}

const effectiveReasonConfiguration = apply
  ? await loadReviewReasonResolutionConfiguration(packageRoot, preset)
  : {
      ...updates.reasonConfiguration,
      resolutions: updates.reasonConfiguration.groups.flatMap((group) => group.bindings.map(([stableKey, outputHash, sourceLogoHash]) => ({
        stableKey,
        reason: group.reason,
        outputHash,
        sourceLogoHash,
        approvalReason: group.approvalReason,
      }))),
    };
if (!effectiveReasonConfiguration.byStableKey) {
  effectiveReasonConfiguration.byStableKey = new Map();
  for (const resolution of effectiveReasonConfiguration.resolutions) {
    const values = effectiveReasonConfiguration.byStableKey.get(resolution.stableKey) ?? [];
    values.push(resolution);
    effectiveReasonConfiguration.byStableKey.set(resolution.stableKey, values);
  }
}
const effectiveBackgroundConfiguration = apply
  ? await loadBackgroundDecisionConfiguration(packageRoot, preset)
  : {
      version: backgroundLoaded.version,
      resolutionByKey: new Map(updates.backgroundResolutions.map((entry) => [entry.stableKey, entry])),
    };
const effectiveRecords = applyReviewResolutionsInMemory(records, effectiveReasonConfiguration, effectiveBackgroundConfiguration);
const effectivePendingRecords = effectiveRecords.filter((record) => record.reviewStatus === "needs-review");
const effectiveUnresolvedReasons = effectivePendingRecords.reduce((sum, record) => sum + record.reviewReasons.length, 0);
if (effectivePendingRecords.length || effectiveUnresolvedReasons) {
  throw new Error(`Reason approvals leave ${effectivePendingRecords.length} records and ${effectiveUnresolvedReasons} reasons unresolved.`);
}

const result = {
  applied: apply,
  proposalRows: proposalDocument.actions.length,
  liveActionCount: reconciliation.liveActionCount,
  liveRecordCount: reconciliation.liveRecordCount,
  historicalActionCount: reconciliation.historicalActionCount,
  actionCounts: reconciliation.actionCounts,
  reasonCounts: reconciliation.reasonCounts,
  addedReasonBindings: updates.addedReasonBindings,
  addedBackgroundResolutions: updates.addedBackgroundResolutions,
  totalReasonBindings: updates.reasonConfiguration.groups.reduce((sum, group) => sum + group.bindings.length, 0),
  totalBackgroundResolutions: updates.backgroundResolutions.length,
  effectivePendingRecords: effectivePendingRecords.length,
  effectiveUnresolvedReasons,
  productionStateWritten: false,
  stagingWritten: false,
  publicationWritten: false,
};
await atomicWriteJson(
  path.join(packageRoot, ".work", "final-review-approval", "reports", apply ? "reason-approval-applied.json" : "reason-approval-verified.json"),
  { ...result, reconciliation },
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);


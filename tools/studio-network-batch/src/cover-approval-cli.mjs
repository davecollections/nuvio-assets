#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite, atomicWriteJson } from "./atomic.mjs";
import { loadBackgroundDecisionConfiguration } from "./background-decision.mjs";
import {
  createCoverApprovalState,
  validateCoverApprovalState,
  validateCoverApprovalStateAgainstSchema,
  validateCoverApprovalStateAgainstStaging,
} from "./cover-approval.mjs";
import { buildPublishPlan } from "./publish-plan.mjs";
import { applyReviewResolutionsInMemory } from "./reason-approval.mjs";
import { loadReviewReasonResolutionConfiguration } from "./review-reason-resolution.mjs";
import { readCurrentProductionRecords } from "./review-prep.mjs";
import { compareProductionSnapshots, snapshotProductionDirectory } from "./staging-snapshot.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function parseOptions(args) {
  const options = { write: false, json: false, reviewedAt: null, approvalSource: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--reviewed-at") options.reviewedAt = args[++index];
    else if (argument.startsWith("--reviewed-at=")) options.reviewedAt = argument.slice("--reviewed-at=".length);
    else if (argument === "--approval-source") options.approvalSource = args[++index];
    else if (argument.startsWith("--approval-source=")) options.approvalSource = argument.slice("--approval-source=".length);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.write && (!options.reviewedAt || !options.approvalSource)) {
    throw new Error("--write requires --reviewed-at and --approval-source.");
  }
  return options;
}

function countsBy(items, selector) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function completionCsv(state, recordsByKey) {
  const header = [
    "stableKey", "entityType", "tmdbId", "canonicalNameAtApproval", "renderStatus", "selectedBackground",
    "publishTarget", "approvedOutputHash", "approvedByteCount", "width", "height", "format", "approvalStatus",
    "approvalSource", "reviewedAt",
  ];
  const rows = state.approvals.map((approval) => {
    const record = recordsByKey.get(approval.stableKey);
    return [
      approval.stableKey, approval.entityType, approval.tmdbId, approval.canonicalNameAtApproval,
      record.renderStatus, record.selectedBackground, approval.publishTarget, approval.approvedOutputHash,
      approval.approvedByteCount, approval.width, approval.height, approval.format, approval.approvalStatus,
      approval.approvalSource, approval.reviewedAt,
    ];
  });
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function dashboard(summary) {
  const modes = Object.entries(summary.coverage.renderModes).map(([name, count]) => `- ${name}: ${count}`).join("\n");
  const backgrounds = Object.entries(summary.coverage.backgrounds).map(([name, count]) => `- ${name}: ${count}`).join("\n");
  return `# Final studio/network review approval

Status: **complete and ready for the separate publish stage**. No final asset or manifest was written.

## Completion

- Review before: ${summary.review.before.pendingRecords} pending records / ${summary.review.before.unresolvedReasons} unresolved reasons
- Review after: ${summary.review.after.pendingRecords} pending records / ${summary.review.after.unresolvedReasons} unresolved reasons
- Owner-approved reason rows applied: ${summary.reasonApprovals.total} (${summary.reasonApprovals.approveReasonAsIs} approve-as-is; ${summary.reasonApprovals.retainCurrentBackground} retain-current-background)
- Durable cover approvals: ${summary.coverApprovals.count}
- Dry publish-plan entries: ${summary.dryPublishPlan.approvedCount}; issues: ${summary.dryPublishPlan.issueCount}; writes: ${summary.dryPublishPlan.writesPerformed}

## Coverage

- Companies: ${summary.coverage.entityTypes.company}
- Networks: ${summary.coverage.entityTypes.network}

Generation modes:

${modes}

Backgrounds:

${backgrounds}

## Preservation evidence

- Staged count: ${summary.preservation.stagedCount}
- Content fingerprint: \`${summary.preservation.contentFingerprint}\`
- Mtime fingerprint: \`${summary.preservation.mtimeFingerprint}\`
- Changed staged paths: ${summary.preservation.changedStagedPaths}
- Persistent production-state hash unchanged: ${summary.preservation.persistentStateUnchanged}
- Network calls: ${summary.network.calls}

## Publication boundary

The plan is validation-only. It did not write \`assets/collection_covers/companies\`, \`assets/collection_covers/networks\`, or a canonical manifest. Superseded ignored review/contact-sheet cleanup is still not implemented: \`review-prep\` does not prune pages that fall out of the current index, and the publish-plan module has no cleanup phase. Historical evidence remains untouched pending an explicit retention/pruning policy.

## Artifacts

- Cover approval state: \`${summary.artifacts.coverApprovalState}\`
- Completion JSON: \`${summary.artifacts.completionJson}\`
- Completion CSV: \`${summary.artifacts.completionCsv}\`
- Dry publish plan: \`${summary.artifacts.dryPublishPlan}\`
- Preservation verification: \`${summary.artifacts.preservationVerification}\`
`;
}

const options = parseOptions(process.argv.slice(2));
const preset = JSON.parse(await fs.readFile(path.join(packageRoot, "presets", "production-v1.json"), "utf8"));
const reportsRoot = path.join(packageRoot, ".work", "reports", preset.version);
const reviewRoot = path.join(packageRoot, ".work", "reviews", preset.version);
const finalRoot = path.join(packageRoot, ".work", "final-review-approval");
const completionRoot = path.join(finalRoot, "reports");
const approvalPath = path.join(packageRoot, "config", "review-state.json");
const stagingRoot = path.join(packageRoot, ".work", "staging", preset.version);
const baselinePath = path.join(finalRoot, "baseline", "protected-state-before.json");
const stagingBeforePath = path.join(finalRoot, "baseline", "staging-before.json");

const [persistentRecords, reasonConfiguration, backgroundConfiguration, baseline, stagingBefore, approvalSchema] = await Promise.all([
  readCurrentProductionRecords(reportsRoot),
  loadReviewReasonResolutionConfiguration(packageRoot, preset),
  loadBackgroundDecisionConfiguration(packageRoot, preset),
  fs.readFile(baselinePath, "utf8").then(JSON.parse),
  fs.readFile(stagingBeforePath, "utf8").then(JSON.parse),
  fs.readFile(path.join(packageRoot, "schemas", "review-state.schema.json"), "utf8").then(JSON.parse),
]);
const effectiveRecords = applyReviewResolutionsInMemory(persistentRecords, reasonConfiguration, backgroundConfiguration);
const pendingRecords = effectiveRecords.filter((record) => record.reviewStatus === "needs-review");
const unresolvedReasons = pendingRecords.reduce((sum, record) => sum + (record.reviewReasons ?? []).length, 0);
if (pendingRecords.length || unresolvedReasons) {
  throw new Error(`Cover approval is blocked by ${pendingRecords.length} pending records and ${unresolvedReasons} reasons.`);
}

let state;
if (options.write) {
  state = createCoverApprovalState({
    records: effectiveRecords,
    reviewedAt: options.reviewedAt,
    approvalSource: options.approvalSource,
  });
  await atomicWriteJson(approvalPath, state);
} else {
  state = validateCoverApprovalState(JSON.parse(await fs.readFile(approvalPath, "utf8")));
}
if (state.approvalCount !== 2366) throw new Error(`Expected 2,366 cover approvals, found ${state.approvalCount}.`);
validateCoverApprovalStateAgainstSchema(state, approvalSchema);

const validation = await validateCoverApprovalStateAgainstStaging({
  state,
  records: effectiveRecords,
  stagingRoot,
});
const publishPlan = await buildPublishPlan({ records: effectiveRecords, reviewEntries: state.approvals, repoRoot });
if (!publishPlan.dryRun || publishPlan.writesPerformed || publishPlan.approvedCount !== 2366 || publishPlan.issueCount) {
  throw new Error(`Dry publish plan failed validation: ${publishPlan.approvedCount} entries, ${publishPlan.issueCount} issues.`);
}

const [stagingAfter, persistentStateBuffer, reviewDraft, checklist] = await Promise.all([
  snapshotProductionDirectory(stagingRoot),
  fs.readFile(path.join(reportsRoot, "run-state.json")),
  fs.readFile(path.join(reviewRoot, "review-state-draft.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(reviewRoot, "review-checklist.csv"), "utf8"),
]);
const stagingComparison = compareProductionSnapshots(stagingBefore, stagingAfter);
if (stagingComparison.changed.length) throw new Error(`Production staging changed at ${stagingComparison.changed.length} paths.`);
const persistentStateHash = createHash("sha256").update(persistentStateBuffer).digest("hex");
const baselineStateHash = baseline.protectedFiles.find((item) => item.path.endsWith("run-state.json"))?.sha256;
if (persistentStateHash !== baselineStateHash) throw new Error("Persistent production state changed during final review approval.");
if (reviewDraft.length) throw new Error(`Review-state draft is not empty: ${reviewDraft.length} entries.`);
const checklistDataRows = checklist.trim().split(/\r?\n/).slice(1).filter(Boolean).length;
if (checklistDataRows) throw new Error(`Review checklist is not empty: ${checklistDataRows} data rows.`);

const recordsByKey = new Map(effectiveRecords.map((record) => [record.stableKey, record]));
const reasonSummary = JSON.parse(await fs.readFile(path.join(completionRoot, "reason-approval-applied.json"), "utf8"));
const completionJsonPath = path.join(completionRoot, "review-completion.json");
const completionCsvPath = path.join(completionRoot, "review-completion.csv");
const dryPublishPlanPath = path.join(completionRoot, "dry-publish-plan.json");
const preservationPath = path.join(completionRoot, "preservation-verification.json");
const dashboardPath = path.join(finalRoot, "README.md");
const summary = {
  version: "final-review-approval-v1",
  completedAt: new Date().toISOString(),
  review: {
    before: {
      pendingRecords: baseline.production.pendingRecords,
      unresolvedReasons: baseline.production.unresolvedReasons,
    },
    after: { pendingRecords: reviewDraft.length, unresolvedReasons: 0, checklistRows: checklistDataRows },
  },
  reasonApprovals: {
    total: reasonSummary.liveActionCount,
    approveReasonAsIs: reasonSummary.actionCounts["approve-reason-as-is"],
    retainCurrentBackground: reasonSummary.actionCounts["retain-current-background"],
    byReason: reasonSummary.reasonCounts,
    genericBindingsAdded: reasonSummary.addedReasonBindings,
    backgroundResolutionsAdded: reasonSummary.addedBackgroundResolutions,
  },
  coverApprovals: { count: state.approvalCount, validation },
  coverage: {
    entityTypes: countsBy(effectiveRecords, (record) => record.entityType),
    renderModes: countsBy(effectiveRecords, (record) => record.renderStatus),
    backgrounds: countsBy(effectiveRecords, (record) => record.selectedBackground),
  },
  dryPublishPlan: {
    approvedCount: publishPlan.approvedCount,
    issueCount: publishPlan.issueCount,
    dryRun: publishPlan.dryRun,
    writesPerformed: publishPlan.writesPerformed,
  },
  preservation: {
    stagedCount: stagingAfter.count,
    stagedBytes: stagingAfter.records.reduce((sum, record) => sum + record.bytes, 0),
    contentFingerprint: stagingAfter.combinedFingerprint,
    mtimeFingerprint: stagingAfter.mtimeFingerprint,
    changedStagedPaths: stagingComparison.changed.length,
    unchangedStagedPaths: stagingComparison.unchanged.length,
    persistentStateHash,
    persistentStateUnchanged: persistentStateHash === baselineStateHash,
  },
  publication: {
    finalAssetsWritten: false,
    canonicalManifestCreated: false,
    cleanupPerformed: false,
    cleanupGap: "review-prep does not prune superseded ignored pages; publish-plan has no cleanup phase",
  },
  network: { calls: 0 },
  artifacts: {
    coverApprovalState: path.relative(packageRoot, approvalPath).replaceAll("\\", "/"),
    completionJson: path.relative(packageRoot, completionJsonPath).replaceAll("\\", "/"),
    completionCsv: path.relative(packageRoot, completionCsvPath).replaceAll("\\", "/"),
    dryPublishPlan: path.relative(packageRoot, dryPublishPlanPath).replaceAll("\\", "/"),
    preservationVerification: path.relative(packageRoot, preservationPath).replaceAll("\\", "/"),
  },
};
await Promise.all([
  atomicWriteJson(completionJsonPath, summary),
  atomicWrite(completionCsvPath, completionCsv(state, recordsByKey)),
  atomicWriteJson(dryPublishPlanPath, publishPlan),
  atomicWriteJson(preservationPath, { before: stagingBefore, after: stagingAfter, comparison: stagingComparison, persistentStateHash, baselineStateHash }),
  atomicWriteJson(path.join(finalRoot, "baseline", "staging-after-approval.json"), stagingAfter),
  atomicWrite(dashboardPath, dashboard(summary)),
]);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

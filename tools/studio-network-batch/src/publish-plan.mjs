import fs from "node:fs/promises";
import path from "node:path";

import { bufferFingerprint } from "./fingerprints.mjs";

function expectedTarget(record) {
  const folder = record.entityType === "company" ? "companies" : "networks";
  return `assets/collection_covers/${folder}/${record.tmdbId}.webp`;
}

export async function buildPublishPlan({ records, reviewEntries, repoRoot } = {}) {
  const recordsByKey = new Map(records.map((record) => [record.stableKey, record]));
  const entries = [];
  const issues = [];
  for (const review of reviewEntries) {
    const reviewStatus = review.reviewStatus ?? review.approvalStatus;
    const reviewedPublishTarget = review.publishTargetPath ?? review.publishTarget;
    if (reviewStatus !== "approved") continue;
    const record = recordsByKey.get(review.stableKey);
    if (!record) {
      issues.push({ stableKey: review.stableKey, code: "missing-staged-record" });
      continue;
    }
    const publishTargetPath = expectedTarget(record);
    if (reviewedPublishTarget !== publishTargetPath) {
      issues.push({ stableKey: review.stableKey, code: "publish-target-mismatch", expected: publishTargetPath });
      continue;
    }
    if (!record.outputPath || !record.outputHash || review.approvedOutputHash !== record.outputHash) {
      issues.push({ stableKey: review.stableKey, code: "approved-hash-mismatch" });
      continue;
    }
    let actualHash;
    try {
      actualHash = bufferFingerprint(await fs.readFile(record.outputPath));
    } catch (error) {
      issues.push({ stableKey: review.stableKey, code: "staged-output-unreadable", message: error.message });
      continue;
    }
    if (actualHash !== review.approvedOutputHash) {
      issues.push({ stableKey: review.stableKey, code: "staged-output-hash-mismatch" });
      continue;
    }
    entries.push({
      stableKey: record.stableKey,
      sourcePath: record.outputPath,
      sourceHash: actualHash,
      publishTargetPath,
      absolutePublishTargetPath: path.join(repoRoot, ...publishTargetPath.split("/")),
      action: "copy-after-publish-approval",
    });
  }
  return {
    dryRun: true,
    writesPerformed: false,
    approvedCount: entries.length,
    issueCount: issues.length,
    entries,
    issues,
  };
}

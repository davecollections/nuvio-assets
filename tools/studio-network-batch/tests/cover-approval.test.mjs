import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  createCoverApprovalState,
  validateCoverApprovalState,
  validateCoverApprovalStateAgainstSchema,
  validateCoverApprovalStateAgainstStaging,
} from "../src/cover-approval.mjs";
import { bufferFingerprint } from "../src/fingerprints.mjs";
import { buildPublishPlan } from "../src/publish-plan.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWED_AT = "2026-07-15T23:29:25.301Z";
const APPROVAL_SOURCE = "owner-approved-final-review-2026-07-16";

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-cover-approval-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingRoot = path.join(root, ".work", "staging", "production-v1");
  const outputPath = path.join(stagingRoot, "companies", "1.webp");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const buffer = await sharp({ create: { width: 1200, height: 675, channels: 4, background: "#08141C" } }).webp().toBuffer();
  await fs.writeFile(outputPath, buffer);
  return {
    root,
    stagingRoot,
    records: [{
      stableKey: "company:1",
      entityType: "company",
      tmdbId: 1,
      name: "Example",
      reviewStatus: "unreviewed",
      reviewReasons: [],
      outputPath,
      outputHash: bufferFingerprint(buffer),
      outputBytes: buffer.length,
      outputWidth: 1200,
      outputHeight: 675,
      outputFormat: "webp",
    }],
  };
}

test("cover approvals require zero unresolved reasons and deterministic exact-output fields", () => {
  const base = {
    stableKey: "company:1",
    entityType: "company",
    tmdbId: 1,
    name: "Example",
    reviewStatus: "unreviewed",
    reviewReasons: [],
    outputHash: "a".repeat(64),
    outputBytes: 100,
    outputWidth: 1200,
    outputHeight: 675,
    outputFormat: "webp",
  };
  const state = createCoverApprovalState({ records: [base], reviewedAt: REVIEWED_AT, approvalSource: APPROVAL_SOURCE });
  assert.equal(state.approvalCount, 1);
  assert.equal(state.approvals[0].publishTarget, "assets/collection_covers/companies/1.webp");
  assert.throws(() => createCoverApprovalState({
    records: [{ ...base, reviewStatus: "needs-review", reviewReasons: ["missing-logo-text-fallback"] }],
    reviewedAt: REVIEWED_AT,
    approvalSource: APPROVAL_SOURCE,
  }), /zero unresolved/);
  assert.throws(() => validateCoverApprovalState({ ...state, approvals: [{ ...state.approvals[0], width: 1 }] }), /1200x675/);
});

test("cover approvals fully decode and produce a write-free publish plan", async (context) => {
  const data = await fixture(context);
  const state = createCoverApprovalState({ records: data.records, reviewedAt: REVIEWED_AT, approvalSource: APPROVAL_SOURCE });
  const validation = await validateCoverApprovalStateAgainstStaging({ state, records: data.records, stagingRoot: data.stagingRoot });
  assert.equal(validation.decodedCount, 1);
  const plan = await buildPublishPlan({ records: data.records, reviewEntries: state.approvals, repoRoot: data.root });
  assert.equal(plan.approvedCount, 1);
  assert.equal(plan.issueCount, 0);
  assert.equal(plan.writesPerformed, false);
  await fs.writeFile(data.records[0].outputPath, "changed");
  await assert.rejects(
    validateCoverApprovalStateAgainstStaging({ state, records: data.records, stagingRoot: data.stagingRoot }),
    /byte-count mismatch|hash mismatch/,
  );
});

test("production cover approval state covers exactly 2,366 company and network identities", async () => {
  const [stateDocument, schema] = await Promise.all([
    fs.readFile(path.join(packageRoot, "config", "review-state.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(packageRoot, "schemas", "review-state.schema.json"), "utf8").then(JSON.parse),
  ]);
  const state = validateCoverApprovalStateAgainstSchema(stateDocument, schema);
  assert.equal(state.approvalCount, 2366);
  assert.equal(state.approvals.filter((approval) => approval.entityType === "company").length, 1797);
  assert.equal(state.approvals.filter((approval) => approval.entityType === "network").length, 569);
  assert.equal(new Set(state.approvals.map((approval) => approval.publishTarget)).size, 2366);
  assert.throws(() => validateCoverApprovalStateAgainstSchema(state, {
    ...schema,
    properties: { ...schema.properties, version: { const: "wrong-version" } },
  }), /version does not match/);
});

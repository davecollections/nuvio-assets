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
  const incrementallyApproved = {
    ...state,
    approvals: [{
      ...state.approvals[0],
      approvedOutputHash: "b".repeat(64),
      approvalSource: "owner-approved-incremental-replacement-2026-08-12",
      reviewedAt: "2026-08-12T08:51:18.864Z",
    }],
  };
  assert.equal(validateCoverApprovalState(incrementallyApproved).approvals[0].approvalSource,
    "owner-approved-incremental-replacement-2026-08-12");
  assert.throws(() => validateCoverApprovalState({
    ...incrementallyApproved,
    approvals: [{ ...incrementallyApproved.approvals[0], approvalSource: "" }],
  }), /non-empty approvalSource/);
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

test("production cover approval state covers exactly 2,460 company and network identities", async () => {
  const [stateDocument, schema] = await Promise.all([
    fs.readFile(path.join(packageRoot, "config", "review-state.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(packageRoot, "schemas", "review-state.schema.json"), "utf8").then(JSON.parse),
  ]);
  const state = validateCoverApprovalStateAgainstSchema(stateDocument, schema);
  assert.equal(state.approvalCount, 2460);
  assert.equal(state.approvals.filter((approval) => approval.entityType === "company").length, 1803);
  assert.equal(state.approvals.filter((approval) => approval.entityType === "network").length, 657);
  assert.equal(new Set(state.approvals.map((approval) => approval.publishTarget)).size, 2460);
  const abcIview = state.approvals.find((approval) => approval.stableKey === "network:1327");
  assert.equal(abcIview.approvedOutputHash, "7d6805a41f856f07a144f494cc49bbe399b062ad40f700107f3334e18ce69fde");
  assert.equal(abcIview.approvalSource, "owner-approved-abc-iview-light-background-2026-08-12");
  const animeStudios = new Map([
    ["company:2849", "705f17f9f125ea76c188d4ddbc6c283d92ccdfc5819f832f02636da9a0b52fe6"],
    ["company:5438", "50a169825eac451de6f62f6161ce53bd6ff9187b9e599b81943cd92c058d0cb1"],
    ["company:5887", "1258a547398954c4dbcbdbb6ffab348723225a1885a13057556edafee89a3d3b"],
    ["company:21444", "b8968c3c7c2a2ab639c93767f95f2063734b463b38e4672b49fce19e63415199"],
    ["company:31058", "99e39b49ed3484600e4dc4a894ec1b1fa15d6afaabf2b9eb5181e9e7ae8db7d0"],
    ["company:50908", "90878a72069777f798b566ee3283df774b4ef6a2bed1e9b877d6c93e6da5a7c7"],
  ]);
  for (const [stableKey, approvedOutputHash] of animeStudios) {
    const approval = state.approvals.find((item) => item.stableKey === stableKey);
    assert.equal(approval.approvedOutputHash, approvedOutputHash);
    assert.equal(approval.approvalSource, "owner-approved-anime-studio-covers-2026-08-12");
  }
  const tv5Unis = state.approvals.find((approval) => approval.stableKey === "network:3664");
  assert.equal(tv5Unis.approvedOutputHash, "82ea7ea0d622015689bd6549379f5ff28b0a52c0694c44b1ae56f5752e94adf8");
  assert.equal(tv5Unis.approvalSource, "owner-approved-provider-required-network-artwork-2026-08-16");
  const correctedNetworks = new Map([
    ["network:7774", "0605e07400e96d5dbc0bcb4adf3d71e976348c7476ab0b75b58b826ed1d3ae85"],
    ["network:8020", "a978941c83b6ffc733458700e96a894cf0727c7afcb427f0ac985d73adc199d1"],
  ]);
  for (const [stableKey, approvedOutputHash] of correctedNetworks) {
    const approval = state.approvals.find((item) => item.stableKey === stableKey);
    assert.equal(approval.approvedOutputHash, approvedOutputHash);
    assert.equal(approval.approvalSource, "owner-approved-provider-network-batch-2026-08-16");
  }
  assert.throws(() => validateCoverApprovalStateAgainstSchema(state, {
    ...schema,
    properties: { ...schema.properties, version: { const: "wrong-version" } },
  }), /version does not match/);
});

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  inventoryFingerprint,
  validateCanonicalManifest,
} from "./canonical-manifest.mjs";
import { validateRuntimeLookup } from "../../artwork-runtime-lookup/src/runtime-lookup.mjs";
import {
  resolveNetworkPosterDecision,
  resolveNetworkPosterFallback,
  validateNetworkPosterDecisions,
} from "./network-poster-decisions.mjs";

const EXPECTED_POSTER_COUNT = 572;
const EXPECTED_POSTER_FINGERPRINT = "8eda5ac498acc243c4c71eaa83e83a8f0f52e13c2acef189361492fca5175e44";
const LIGHT_IDS = new Set([48, 197, 274, 298, 553, 1028, 1977, 5428, 7774, 8020]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(`Network poster publication gate failed: ${message}`);
}

function repoPath(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, ...relativePath.split("/"));
  assert(resolved.startsWith(`${path.resolve(repoRoot)}${path.sep}`), `path escaped repository: ${relativePath}`);
  return resolved;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function validateResolverCompatibilityEvidence(evidence) {
  assert(evidence?.version === "network-poster-resolver-compatibility-v1", "resolver evidence version is missing.");
  assert(Array.isArray(evidence.acceptedRuntimeSchemaVersions) &&
    evidence.acceptedRuntimeSchemaVersions.join(",") === "1,2", "resolver must accept exactly runtime v1 and v2.");
  assert(evidence.networkPosterRequiredInV2 === true, "v2 network poster requirement is unverified.");
  assert(evidence.companyPosterUnsupported === true, "company poster rejection is unverified.");
  assert(evidence.v1AdapterInterfaceUnchanged === true, "v1 adapter compatibility is unverified.");
  assert(evidence.testsPassed === true, "resolver compatibility tests have not passed.");
  return evidence;
}

export async function dryRunNetworkPosterPublication({
  repoRoot,
  plan,
  landscapeManifest,
  decisions,
}) {
  validateNetworkPosterDecisions(decisions);
  assert(plan?.version === "network-poster-dry-publication-plan-v1", "unsupported evidence plan.");
  assert(plan.records?.length === EXPECTED_POSTER_COUNT, `expected exactly ${EXPECTED_POSTER_COUNT} records.`);
  assert(landscapeManifest?.networkCount === EXPECTED_POSTER_COUNT, "landscape network count drifted.");
  assert(plan.ownerApprovalCounts?.strong === 459 && plan.ownerApprovalCounts?.viable === 101, "approved tier counts drifted.");
  assert(plan.ownerApprovalCounts?.contrastLight === 10 && plan.ownerApprovalCounts?.contrastDark === 1, "contrast approval counts drifted.");
  assert(plan.ownerApprovalCounts?.fallback === 1, "fallback approval count drifted.");

  const stableKeys = new Set();
  const publishPaths = new Set();
  const inventory = [];
  let decoded = 0;
  let sourceBound = 0;
  for (const record of plan.records) {
    assert(record.stableKey === `network:${record.tmdbId}`, `${record.stableKey} identity drifted.`);
    assert(!stableKeys.has(record.stableKey), `duplicate ${record.stableKey}.`);
    stableKeys.add(record.stableKey);
    assert(record.publishPath === `assets/collection_covers/networks/poster/${record.tmdbId}.webp`, `${record.stableKey} target drifted.`);
    assert(!publishPaths.has(record.publishPath), `duplicate target ${record.publishPath}.`);
    publishPaths.add(record.publishPath);
    assert(!(await exists(repoPath(repoRoot, record.publishPath))), `${record.publishPath} already exists.`);

    const candidatePath = repoPath(repoRoot, record.candidatePath);
    const candidate = await fs.readFile(candidatePath);
    const metadata = await sharp(candidate).metadata();
    assert(candidate.length === record.candidateBytes && sha256(candidate) === record.candidateSha256, `${record.stableKey} candidate bytes drifted.`);
    assert(metadata.format === "webp" && metadata.width === 1000 && metadata.height === 1500, `${record.stableKey} candidate dimensions drifted.`);
    assert(record.verification?.deterministicReplayMatch === true, `${record.stableKey} deterministic replay failed.`);
    assert(record.verification?.nonTransparentSourcePixelsLost === 0, `${record.stableKey} loses source pixels.`);
    decoded += 1;

    if (record.tmdbId === 184) {
      const result = resolveNetworkPosterFallback(decisions, {
        stableKey: record.stableKey,
        tmdbId: record.tmdbId,
        name: record.name,
      });
      assert(result.status === "resolved", `${record.stableKey} fallback approval is stale or missing.`);
      assert(result.approval.approvedOutputSha256 === record.candidateSha256 &&
        result.approval.approvedOutputBytes === record.candidateBytes &&
        result.approval.approvalHash === record.approvalHash, `${record.stableKey} fallback output approval drifted.`);
    } else {
      const source = await fs.readFile(record.exactSourcePath);
      assert(sha256(source) === record.sourceSha256, `${record.stableKey} exact source SHA-256 drifted.`);
      sourceBound += 1;
      if (LIGHT_IDS.has(record.tmdbId) || record.tmdbId === 1073) {
        const result = resolveNetworkPosterDecision(decisions, {
          stableKey: record.stableKey,
          tmdbId: record.tmdbId,
          sourceLogoPath: record.sourceLogoPath,
          sourceLogoSha256: record.sourceSha256,
        });
        assert(result.status === "resolved", `${record.stableKey} poster decision is stale or missing.`);
        assert(result.decision.background === record.background &&
          result.decision.approvedOutputSha256 === record.candidateSha256 &&
          result.decision.approvedOutputBytes === record.candidateBytes &&
          result.decision.approvalHash === record.approvalHash, `${record.stableKey} approved poster binding drifted.`);
      }
    }
    inventory.push({
      path: record.publishPath.replace("assets/collection_covers/", ""),
      bytes: record.candidateBytes,
      sha256: record.candidateSha256,
    });
  }
  const fingerprint = inventoryFingerprint(inventory);
  assert(fingerprint === EXPECTED_POSTER_FINGERPRINT, "approved poster fingerprint drifted.");
  assert(fingerprint === plan.fingerprints.posters, "plan poster fingerprint drifted.");
  return {
    status: "ready-not-published",
    recordCount: plan.records.length,
    decoded,
    sourceBound,
    fallbackApproved: 1,
    targetCollisions: 0,
    staleDecisions: 0,
    posterFingerprint: fingerprint,
    publicWrites: 0,
    networkRequests: 0,
  };
}

export async function prepareNetworkPosterTransaction({
  transactionRoot,
  repoRoot,
  plan,
  manifestV2,
  runtimeV2,
  compatibilityEvidence,
}) {
  validateResolverCompatibilityEvidence(compatibilityEvidence);
  assert(manifestV2?.version === "studio-network-canonical-manifest-v2", "manifest v2 is required.");
  assert(runtimeV2?.schemaVersion === 2, "runtime v2 is required.");
  validateCanonicalManifest(manifestV2);
  const schemaV2 = JSON.parse(await fs.readFile(path.join(repoRoot, "schemas", "artwork-runtime-lookup-v2.schema.json"), "utf8"));
  validateRuntimeLookup(runtimeV2, schemaV2);
  assert(runtimeV2.generatedFrom?.studioNetworkManifest?.fingerprint === manifestV2.publishedAssetFingerprint,
    "runtime is not bound to the prepared manifest fingerprint.");
  assert(plan.records.length === EXPECTED_POSTER_COUNT, "poster plan count drifted.");
  assert(manifestV2.posterCount === EXPECTED_POSTER_COUNT &&
    Object.keys(runtimeV2.networks).length === EXPECTED_POSTER_COUNT, "manifest/runtime network poster coverage drifted.");
  assert(manifestV2.posterAssetFingerprint === EXPECTED_POSTER_FINGERPRINT &&
    manifestV2.posterAssetFingerprint === plan.fingerprints.posters, "manifest poster fingerprint drifted.");
  const absoluteTransactionRoot = path.resolve(transactionRoot);
  assert(absoluteTransactionRoot.includes(`${path.sep}.work${path.sep}`), "transaction root must remain under ignored .work.");
  assert(!(await exists(absoluteTransactionRoot)), "transaction root already exists.");
  await fs.mkdir(absoluteTransactionRoot, { recursive: true });
  for (const record of plan.records) {
    const target = path.join(absoluteTransactionRoot, ...record.publishPath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(repoPath(repoRoot, record.candidatePath), target);
  }
  const manifestPath = path.join(absoluteTransactionRoot, "assets", "collection_covers", "manifest.json");
  const runtimePath = path.join(absoluteTransactionRoot, "assets", "collection_covers", "runtime-lookup.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifestV2, null, 2)}\n`);
  assert(runtimeV2.generatedFrom.studioNetworkManifest.sha256 === sha256(manifestBytes),
    "runtime is not bound to the exact prepared manifest bytes.");
  await fs.writeFile(manifestPath, manifestBytes);
  await fs.writeFile(runtimePath, `${JSON.stringify(runtimeV2)}\n`);
  const receipt = {
    version: "network-poster-publication-transaction-v1",
    status: "prepared-not-installed",
    releaseId: manifestV2.releaseId,
    posterCount: EXPECTED_POSTER_COUNT,
    posterFingerprint: plan.fingerprints.posters,
    compatibilityEvidence,
    installOrder: ["poster assets", "canonical manifest", "runtime lookup last"],
    atomicity: {
      preparationRoot: "ignored .work transaction",
      canonicalFilesInstalledOnlyAfterAllBytesValidate: true,
      runtimeInstalledLast: true,
      repositoryAtomicBoundary: "one release commit containing all 572 posters, manifest v2 and runtime v2",
    },
    rollbackPlan: {
      beforeCommit: "remove newly installed poster paths and restore the exact pre-install manifest/runtime bytes",
      afterCommit: "revert the complete release commit; never revert individual poster or canonical files",
      partialPublicationAllowed: false,
    },
  };
  await fs.writeFile(path.join(absoluteTransactionRoot, "transaction.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function installPreparedNetworkPosterTransaction() {
  throw new Error(
    "Public installation is deliberately locked. Publication requires a separately authorized release task, a real release ID/timestamp, a clean tree, revalidated compatibility evidence, and one atomic commit.",
  );
}

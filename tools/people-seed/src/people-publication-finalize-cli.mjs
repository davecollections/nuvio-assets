#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OWNER_REVIEW_FIELDS,
  PEOPLE_MANIFEST_RELATIVE_PATH,
  atomicWrite,
  buildPublishedPeopleArtworkManifest,
  calculateManifestFingerprint,
  categoryReuseReport,
  csvDocument,
  loadLockedPilot,
  normaliseRepositoryPath,
  stableStringify,
  validateManifestAssets,
  validateOwnerDecisionBindings,
  validateOwnerDecisions,
  validatePeopleArtworkManifest,
  validateTrackedPeopleManifest,
  writeJson,
} from "./people-publication.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseFinalizationArguments(argv) {
  const options = {
    sourceManifest: null,
    expectedSourceManifestHash: null,
    expectedSourceManifestFingerprint: null,
    manifestPath: null,
    ownerDecisions: null,
    workRoot: null,
    publishedAt: null,
    lockedPilot: false,
    help: false,
  };
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source-manifest") { options.sourceManifest = take(index, argument); index += 1; }
    else if (argument === "--expected-source-manifest-sha256") { options.expectedSourceManifestHash = take(index, argument); index += 1; }
    else if (argument === "--expected-source-manifest-fingerprint") { options.expectedSourceManifestFingerprint = take(index, argument); index += 1; }
    else if (argument === "--manifest") { options.manifestPath = take(index, argument); index += 1; }
    else if (argument === "--owner-decisions") { options.ownerDecisions = take(index, argument); index += 1; }
    else if (argument === "--work-root") { options.workRoot = take(index, argument); index += 1; }
    else if (argument === "--published-at") { options.publishedAt = take(index, argument); index += 1; }
    else if (argument === "--locked-pilot") options.lockedPilot = true;
    else if (argument === "--offline") { /* finalization is permanently offline */ }
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown people publication finalization argument: ${argument}`);
  }
  return options;
}

const HELP = `Nuvio people artwork publication finalization

Required:
  --source-manifest <path>                    Ignored candidate manifest
  --expected-source-manifest-sha256 <hash>    Exact approved candidate bytes
  --expected-source-manifest-fingerprint <hash>
  --manifest <path>                           Final repository manifest path
  --owner-decisions <path>                    Ignored hash-bound decision CSV
  --work-root <path>                          Ignored finalization report root
  --published-at <ISO timestamp>              Fixed replayable publication time

Optional:
  --locked-pilot                              Require the exact locked-40 scope

This command reads already restored artwork and writes only the ignored decision CSV,
the final manifest, and ignored validation evidence. It never renders, downloads,
commits, pushes, or accesses the network.
`;

function resolveRequired(value, label, repositoryRoot = repoRoot) {
  if (!value) throw new Error(`${label} is required.`);
  return path.resolve(repositoryRoot, value);
}

function requireIgnoredWorkPath(resolved, label, repositoryRoot = repoRoot) {
  const relative = normaliseRepositoryPath(path.relative(repositoryRoot, resolved));
  if (!relative.startsWith("tools/people-seed/.work/")) throw new Error(`${label} must resolve below tools/people-seed/.work/.`);
  return relative;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(value); value = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((fields) => Object.fromEntries(header.map((name, index) => [name, fields[index] ?? ""])));
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export async function finalizePublishedManifest(options, { repositoryRoot = repoRoot } = {}) {
  const sourceManifestPath = resolveRequired(options.sourceManifest, "--source-manifest", repositoryRoot);
  const manifestPath = resolveRequired(options.manifestPath, "--manifest", repositoryRoot);
  const ownerDecisionsPath = resolveRequired(options.ownerDecisions, "--owner-decisions", repositoryRoot);
  const workRoot = resolveRequired(options.workRoot, "--work-root", repositoryRoot);
  requireIgnoredWorkPath(sourceManifestPath, "--source-manifest", repositoryRoot);
  requireIgnoredWorkPath(ownerDecisionsPath, "--owner-decisions", repositoryRoot);
  requireIgnoredWorkPath(workRoot, "--work-root", repositoryRoot);
  assert(normaliseRepositoryPath(path.relative(repositoryRoot, manifestPath)) === PEOPLE_MANIFEST_RELATIVE_PATH, `--manifest must resolve to ${PEOPLE_MANIFEST_RELATIVE_PATH}.`);
  assert(/^[a-f0-9]{64}$/u.test(options.expectedSourceManifestHash || ""), "--expected-source-manifest-sha256 must be a lowercase SHA-256 hash.");
  assert(/^[a-f0-9]{64}$/u.test(options.expectedSourceManifestFingerprint || ""), "--expected-source-manifest-fingerprint must be a lowercase SHA-256 hash.");
  assert(Number.isFinite(Date.parse(options.publishedAt)), "--published-at must be an ISO date-time.");

  const sourceBytes = await fs.readFile(sourceManifestPath);
  const sourceManifestHash = sha256(sourceBytes);
  assert(sourceManifestHash === options.expectedSourceManifestHash, "Held source manifest SHA-256 differs from the explicit approved hash.");
  const candidateManifest = JSON.parse(sourceBytes);
  assert(candidateManifest.manifestFingerprint === options.expectedSourceManifestFingerprint, "Held source manifest fingerprint differs from the explicit approved fingerprint.");
  const locked = options.lockedPilot ? await loadLockedPilot({ repoRoot: repositoryRoot }) : null;
  const expectedStableKeys = locked?.lock.selectedStableKeys ?? candidateManifest.records.map((record) => record.stableKey);
  const candidateValidation = await validatePeopleArtworkManifest({ manifest: candidateManifest, repoRoot: repositoryRoot, expectedStableKeys });
  assert(candidateValidation.valid, `Held source manifest validation failed:\n${candidateValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  if (options.lockedPilot) {
    assert(candidateManifest.recordCount === 40 && candidateManifest.landscapeCount === 40 && candidateManifest.posterCount === 40, "Published locked scope must contain exactly 40 people and both 40-file formats.");
    assert(candidateManifest.fallbackCount === 0 && candidateManifest.records.every((record) => !record.fallbackUsed), "Published locked scope must contain zero fallbacks.");
    assert(!candidateManifest.records.some((record) => record.stableKey === "person:1100"), "Arnold Schwarzenegger must remain outside the locked publication scope.");
    assert(candidateManifest.records.some((record) => record.stableKey === "person:3894" && record.landscapePath && record.posterPath), "Christian Bale must remain present in both formats.");
  }

  const assetValidation = await validateManifestAssets({ manifest: candidateManifest, repoRoot: repositoryRoot });
  assert(assetValidation.valid && assetValidation.recordCount === 80, `Restored artwork validation failed:\n${assetValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  assert(assetValidation.records.every((record) => Object.values(record.checks).every(Boolean)), "Not every restored artwork file passed its complete validation checks.");

  const existingDecisionRows = parseCsv(await fs.readFile(ownerDecisionsPath, "utf8"));
  const decisionErrors = [
    ...validateOwnerDecisions(existingDecisionRows, expectedStableKeys),
    ...validateOwnerDecisionBindings(existingDecisionRows, candidateManifest),
  ];
  assert(decisionErrors.length === 0, `Ignored publication decisions do not bind the held manifest:\n${decisionErrors.map((error) => `- ${error}`).join("\n")}`);
  const publishDecisionRows = existingDecisionRows.map((row) => ({
    ...row,
    owner_publication_decision: "publish",
    owner_note: "",
  }));
  assert(validateOwnerDecisions(publishDecisionRows, expectedStableKeys).length === 0, "Unable to create the exact bounded publish decision set.");

  const manifest = buildPublishedPeopleArtworkManifest({ candidateManifest, publishedAt: options.publishedAt });
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot: repositoryRoot, expectedStableKeys });
  assert(manifestValidation.valid, `Published manifest validation failed:\n${manifestValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  const replayManifest = buildPublishedPeopleArtworkManifest({ candidateManifest, publishedAt: options.publishedAt });
  const deterministicReplay = stableStringify(manifest) === stableStringify(replayManifest)
    && manifest.manifestFingerprint === replayManifest.manifestFingerprint
    && manifest.manifestFingerprint === calculateManifestFingerprint(manifest);
  assert(deterministicReplay, "Published manifest replay was not deterministic.");
  const categoryReuse = categoryReuseReport(manifest);
  assert(categoryReuse.valid, "Published manifest does not preserve category-neutral person identity.");

  const publicText = JSON.stringify(manifest);
  for (const forbidden of ["ownerReviewStatus", "rightsStatus", "distributionStatus", "landscapeUrlProposal", "posterUrlProposal", "owner-approved-third-party-use", "legal clearance", "accepted risk"]) {
    assert(!publicText.includes(forbidden), `Published manifest contains forbidden internal field or wording: ${forbidden}`);
  }

  await atomicWrite(ownerDecisionsPath, csvDocument(OWNER_REVIEW_FIELDS, publishDecisionRows));
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const trackedValidation = await validateTrackedPeopleManifest({ repoRoot: repositoryRoot, manifestPath });
  assert(trackedValidation.valid && trackedValidation.pathValidation.recordCount === 80, "Written published manifest or assets failed tracked validation.");

  const manifestBytes = await fs.readFile(manifestPath);
  const report = {
    version: "people-published-finalization-v1",
    valid: true,
    offline: true,
    renderingPerformed: false,
    sourceManifest: {
      path: normaliseRepositoryPath(path.relative(repositoryRoot, sourceManifestPath)),
      hash: sourceManifestHash,
      fingerprint: candidateManifest.manifestFingerprint,
    },
    publishedManifest: {
      path: PEOPLE_MANIFEST_RELATIVE_PATH,
      hash: sha256(manifestBytes),
      fingerprint: manifest.manifestFingerprint,
      publishedAt: manifest.publishedAt,
    },
    counts: {
      people: manifest.recordCount,
      landscape: manifest.landscapeCount,
      poster: manifest.posterCount,
      assets: trackedValidation.pathValidation.recordCount,
      fallbacks: manifest.fallbackCount,
      skipped: 0,
    },
    ownerDecisionCount: publishDecisionRows.length,
    categoryReuse,
    deterministicReplay,
    networkAccounting: {
      tmdbMetadataRequests: 0,
      personImagesRequests: 0,
      imageCdnRequests: 0,
      generalWebRequests: 0,
      sourceImageDownloads: 0,
      fontDownloads: 0,
    },
  };
  await writeJson(path.join(workRoot, "reports", "publication-finalization.json"), report);
  return report;
}

async function main() {
  const options = parseFinalizationArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  const report = await finalizePublishedManifest(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

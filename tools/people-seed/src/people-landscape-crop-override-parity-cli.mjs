#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPeopleFoundation } from "./people-validation.mjs";
import { loadLandscapeCropOverrides } from "./people-artwork/landscape-crop-overrides.mjs";
import { writeRenderMetadata } from "./people-artwork/metadata.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const outputDefault = path.join(packageRoot, ".work", "people-later-actors-candidate", "post-override-review", "offline-parity");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseArguments(argv) {
  const options = {
    candidateRoot: null,
    outputDir: outputDefault,
    promoteCandidate: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--candidate-root") options.candidateRoot = path.resolve(repoRoot, argv[++index]);
    else if (argument === "--output-dir") options.outputDir = path.resolve(repoRoot, argv[++index]);
    else if (argument === "--promote-candidate") options.promoteCandidate = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function candidateRootForOverride(override) {
  let current = path.resolve(repoRoot, ...override.evidencePackage.split("/"));
  while (path.dirname(current) !== current) {
    if (path.basename(current).endsWith("-candidate")) return current;
    current = path.dirname(current);
  }
  throw new Error(`${override.stableKey}: evidence package is not inside a candidate workspace.`);
}

async function proofPathForOverride(override) {
  const evidenceRoot = path.resolve(repoRoot, ...override.evidencePackage.split("/"));
  const candidates = [
    path.join(evidenceRoot, "renders", "wider", `${override.tmdbPersonId}.webp`),
    path.join(evidenceRoot, "proof-renders", "wider", `${override.tmdbPersonId}.webp`),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`${override.stableKey}: approved Alternative A proof is absent from ${override.evidencePackage}.`);
}

function mergeNetworkAccounting(results) {
  const total = {
    profileImageDownloads: 0,
    tmdbMetadataRequests: 0,
    personImagesRequests: 0,
    imageCdnRequests: 0,
    fontDownloads: 0,
    sourceCacheHits: 0,
    generalWebRequests: 0,
    unauthorisedRequests: 0,
    attemptedRequests: [],
  };
  for (const result of results) {
    for (const key of Object.keys(total)) {
      if (key === "attemptedRequests") total.attemptedRequests.push(...result.networkAccounting.attemptedRequests);
      else total[key] += result.networkAccounting[key];
    }
  }
  return total;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: npm run crop-overrides:verify-local -- [--candidate-root <ignored candidate>] [--output-dir <ignored replay directory>] [--promote-candidate]\n");
    return;
  }
  if (options.promoteCandidate && !options.candidateRoot) throw new Error("--promote-candidate requires one explicit --candidate-root.");
  const candidateRoot = options.candidateRoot ? path.resolve(options.candidateRoot) : null;
  const outputDir = options.promoteCandidate ? path.join(candidateRoot, "renders") : path.resolve(options.outputDir);
  const reportDir = options.promoteCandidate
    ? path.join(candidateRoot, "post-override-review", "promotion-render")
    : outputDir;
  const configuration = await loadLandscapeCropOverrides({ repoRoot });
  const [foundation, decisions] = await Promise.all([
    readPeopleFoundation(repoRoot),
    fs.readFile(path.join(repoRoot, "data", "people", "portrait-source-decisions.json"), "utf8").then(JSON.parse),
  ]);
  const selectedOverrides = configuration.config.records.filter((record) => !candidateRoot || candidateRootForOverride(record) === candidateRoot);
  if (!selectedOverrides.length) throw new Error("No tracked crop overrides are bound to the selected candidate workspace.");
  const peopleByKey = new Map(foundation.registry.records.map((person) => [person.stableKey, person]));
  const people = selectedOverrides.map((record) => {
    const person = peopleByKey.get(record.stableKey);
    if (!person) throw new Error(`${record.stableKey}: override identity is absent from the people registry.`);
    return person;
  });
  const groups = new Map();
  for (const override of selectedOverrides) {
    const root = candidateRootForOverride(override);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(peopleByKey.get(override.stableKey));
  }
  const results = [];
  for (const [root, selectedPeople] of groups) {
    results.push(await renderPeopleArtwork({
      people: selectedPeople,
      decisions,
      sourceCache: path.join(root, "source-cache"),
      outputDir,
      format: "landscape",
      offline: true,
      landscapeCropOverrides: configuration,
    }));
  }
  const metadata = {
    version: "people-artwork-render-metadata-v1",
    ordering: "selection-order-then-landscape-poster",
    recordCount: results.reduce((sum, result) => sum + result.metadata.recordCount, 0),
    records: results.flatMap((result) => result.metadata.records).sort((left, right) => left.tmdbPersonId - right.tmdbPersonId),
  };
  await writeRenderMetadata({ metadata, outputDir: reportDir });
  const renderedByKey = new Map(metadata.records.map((record) => [record.stableKey, record]));
  const comparisons = [];
  for (const override of selectedOverrides) {
    const rendered = renderedByKey.get(override.stableKey);
    const proofPath = await proofPathForOverride(override);
    const proofHash = await hashFile(proofPath);
    const expectedBounds = {
      x: override.cropOffsetX,
      y: override.cropOffsetY,
      width: Math.round(override.cropRectangle.width * override.cropScale.x),
      height: Math.round(override.cropRectangle.height * override.cropScale.y),
    };
    const checks = {
      sourcePath: rendered.profilePathAttempted === override.sourceProfilePath,
      sourceHash: rendered.sourceHash === override.sourceHash,
      cropRectangle: JSON.stringify(rendered.cropRectangle) === JSON.stringify(override.cropRectangle),
      cropScale: JSON.stringify(rendered.resizeScale) === JSON.stringify(override.cropScale),
      cropOffset: rendered.portraitBounds.x === override.cropOffsetX && rendered.portraitBounds.y === override.cropOffsetY,
      portraitBounds: JSON.stringify(rendered.portraitBounds) === JSON.stringify(expectedBounds),
      preset: rendered.presetId === override.basePresetId && rendered.presetHash === override.basePresetHash,
      overrideMetadata: rendered.cropOverrideUsed === true
        && rendered.cropOverrideConfigHash === configuration.configHash
        && rendered.cropOverrideSourceHash === override.sourceHash
        && rendered.cropOverrideStatus === "active-source-match",
      recordedProof: proofHash === override.approvedProofHash,
      outputHash: rendered.outputHash === override.approvedProofHash,
      outputBytes: rendered.byteCount === (await fs.stat(proofPath)).size,
    };
    comparisons.push({
      stableKey: override.stableKey,
      tmdbPersonId: override.tmdbPersonId,
      canonicalName: override.canonicalName,
      proofHash,
      outputHash: rendered.outputHash,
      byteCount: rendered.byteCount,
      checks,
      valid: Object.values(checks).every(Boolean),
    });
  }
  const report = {
    version: "people-landscape-crop-override-parity-v1",
    ordering: "tmdb-person-id-ascending",
    offline: true,
    selectionCount: people.length,
    outputCount: metadata.recordCount,
    configurationHash: configuration.configHash,
    parityCount: comparisons.filter((item) => item.valid).length,
    mismatchCount: comparisons.filter((item) => !item.valid).length,
    candidateRoots: [...groups.keys()].map((root) => path.relative(repoRoot, root).replaceAll("\\", "/")),
    networkAccounting: mergeNetworkAccounting(results),
    comparisons,
  };
  await fs.writeFile(path.join(reportDir, "crop-override-parity.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    valid: report.mismatchCount === 0 && report.selectionCount === selectedOverrides.length && report.outputCount === selectedOverrides.length,
    selectionCount: report.selectionCount,
    outputCount: report.outputCount,
    parityCount: report.parityCount,
    mismatchCount: report.mismatchCount,
    configurationHash: report.configurationHash,
    outputDir,
    reportDir,
    networkAccounting: report.networkAccounting,
  }, null, 2)}\n`);
  if (report.mismatchCount !== 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

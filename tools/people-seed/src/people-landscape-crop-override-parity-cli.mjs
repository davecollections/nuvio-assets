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
const candidateDefault = path.join(packageRoot, ".work", "people-initial-actors-candidate");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseArguments(argv) {
  const options = {
    candidateRoot: candidateDefault,
    outputDir: path.join(candidateDefault, "post-override-review", "offline-parity"),
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: npm run crop-overrides:verify-local -- [--candidate-root <ignored candidate>] [--output-dir <ignored replay directory>] [--promote-candidate]\n");
    return;
  }
  const candidateRoot = path.resolve(options.candidateRoot);
  const outputDir = options.promoteCandidate ? path.join(candidateRoot, "renders") : path.resolve(options.outputDir);
  const reportDir = options.promoteCandidate
    ? path.join(candidateRoot, "post-override-review", "promotion-render")
    : outputDir;
  const auditRoot = path.join(candidateRoot, "landscape-crop-audit");
  const configuration = await loadLandscapeCropOverrides({ repoRoot });
  const [foundation, decisions] = await Promise.all([
    readPeopleFoundation(repoRoot),
    fs.readFile(path.join(repoRoot, "data", "people", "portrait-source-decisions.json"), "utf8").then(JSON.parse),
  ]);
  const peopleByKey = new Map(foundation.registry.records.map((person) => [person.stableKey, person]));
  const people = configuration.config.records.map((record) => {
    const person = peopleByKey.get(record.stableKey);
    if (!person) throw new Error(`${record.stableKey}: override identity is absent from the people registry.`);
    return person;
  });
  const result = await renderPeopleArtwork({
    people,
    decisions,
    sourceCache: path.join(candidateRoot, "source-cache"),
    outputDir,
    format: "landscape",
    offline: true,
    landscapeCropOverrides: configuration,
  });
  await writeRenderMetadata({ metadata: result.metadata, outputDir: reportDir });
  const renderedByKey = new Map(result.metadata.records.map((record) => [record.stableKey, record]));
  const comparisons = [];
  for (const override of configuration.config.records) {
    const rendered = renderedByKey.get(override.stableKey);
    const proofPath = path.join(auditRoot, "renders", "wider", `${override.tmdbPersonId}.webp`);
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
    outputCount: result.metadata.recordCount,
    configurationHash: configuration.configHash,
    parityCount: comparisons.filter((item) => item.valid).length,
    mismatchCount: comparisons.filter((item) => !item.valid).length,
    networkAccounting: result.networkAccounting,
    comparisons,
  };
  await fs.writeFile(path.join(reportDir, "crop-override-parity.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    valid: report.mismatchCount === 0 && report.selectionCount === 51 && report.outputCount === 51,
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

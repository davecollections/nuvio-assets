#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { inspectSharedPeopleHero } from "../src/people-presentation-manifest.mjs";
import { generateTitleLogoCorrectionProof } from "../src/people-title-logo-proof.mjs";
import { generateLandscapeCorrectionProof, generateLandscapeCropPrototypes } from "../src/people-v3-landscape-correction.mjs";
import { loadPeopleV3ProofContext } from "../src/people-v3-artwork-proof.mjs";
import { loadPeopleArtworkRuntime, PEOPLE_ARTWORK_REPO_ROOT } from "../src/people-artwork/runtime-dependencies.mjs";
import { assertPeopleV3ProofPath } from "../src/people-artwork/title-logo.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

async function latestLandscapeProofReport(attemptRoot) {
  const correctionRoot = path.join(attemptRoot, "landscape-correction");
  const directories = await fs.readdir(correctionRoot, { withFileTypes: true });
  const candidates = directories
    .filter((entry) => entry.isDirectory() && /^proof(?:-attempt-[0-9]{2})?$/u.test(entry.name))
    .map((entry) => ({
      path: path.join(correctionRoot, entry.name, "correction-proof-report.json"),
      order: Number(entry.name.match(/attempt-([0-9]{2})/u)?.[1] || 1),
    }))
    .sort((left, right) => right.order - left.order);
  for (const candidate of candidates) if (await exists(candidate.path)) return candidate.path;
  throw new Error("No completed Landscape correction proof report is available.");
}

async function latestTitleProofReport(attemptRoot) {
  const titleRoot = path.join(attemptRoot, "title-logos");
  const candidates = [{ path: path.join(titleRoot, "correction-proof-report.json"), order: 1 }];
  for (const entry of await fs.readdir(titleRoot, { withFileTypes: true })) {
    const match = entry.isDirectory() ? /^replay-attempt-([0-9]{2})$/u.exec(entry.name) : null;
    if (match) candidates.push({ path: path.join(titleRoot, entry.name, "correction-proof-report.json"), order: Number(match[1]) });
  }
  candidates.sort((left, right) => right.order - left.order);
  for (const candidate of candidates) if (await exists(candidate.path)) return candidate.path;
  throw new Error("No completed title-logo correction proof report is available.");
}

function parseArguments(argv) {
  const options = { mode: null, attemptRoot: null, sourceAttemptRoot: null, fontDirectory: null, help: false };
  const modes = new Map([
    ["--init", "init"],
    ["--title-proof", "title-proof"],
    ["--landscape-prototypes", "landscape-prototypes"],
    ["--landscape-proof", "landscape-proof"],
    ["--verify-hero", "verify-hero"],
    ["--summary", "summary"],
  ]);
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (modes.has(argument)) {
      if (options.mode) throw new Error("Select exactly one correction-proof mode.");
      options.mode = modes.get(argument);
    } else if (argument === "--attempt-root") { options.attemptRoot = take(index, argument); index += 1; }
    else if (argument === "--source-attempt-root") { options.sourceAttemptRoot = take(index, argument); index += 1; }
    else if (argument === "--font-dir") { options.fontDirectory = take(index, argument); index += 1; }
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown correction-proof argument: ${argument}`);
  }
  return options;
}

const HELP = `Nuvio People v3 focused title-logo and Landscape correction proof

Required:
  --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ

Modes:
  --init                    Create a unique ignored correction attempt
  --title-proof             Render A/B/C title-logo proofs and fresh-process replay
  --landscape-prototypes    Render the existing 17 Landscapes at three controlled zoom-out tiers
  --landscape-proof         Render the tracked exact-ID correction candidates twice
  --verify-hero             Validate, but do not composite or alter, the shared People hero
  --summary                 Write a combined correction summary after all proof modes

Landscape modes also require --source-attempt-root pointing to the preserved prior proof source cache.
No mode renders Posters or writes public artwork, manifests, runtime data, or release metadata.
`;

function generatedAtFromAttempt(attemptRoot) {
  const match = /attempt-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/u.exec(path.basename(attemptRoot));
  assert(match, "Attempt root must end with attempt-YYYYMMDDTHHMMSSZ.");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

function posixRelative(filePath) {
  return path.relative(PEOPLE_ARTWORK_REPO_ROOT, filePath).replaceAll("\\", "/");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  assert(options.mode && options.attemptRoot, "Select one mode and provide --attempt-root. Use --help for details.");
  const attemptRoot = assertPeopleV3ProofPath(path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.attemptRoot));
  const generatedAt = generatedAtFromAttempt(attemptRoot);
  const sourceAttemptRoot = options.sourceAttemptRoot ? assertPeopleV3ProofPath(path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.sourceAttemptRoot)) : null;
  const fontDirectory = options.fontDirectory ? path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.fontDirectory) : null;
  const runtime = loadPeopleArtworkRuntime();
  if (options.mode === "init") {
    assert(!(await exists(attemptRoot)), `Correction attempt already exists and will not be overwritten: ${attemptRoot}`);
    if (sourceAttemptRoot) assert(await exists(path.join(sourceAttemptRoot, "portrait-proof", "source-cache", "index.json")), "Preserved source-attempt cache is incomplete.");
    await fs.mkdir(attemptRoot, { recursive: true });
    const report = { version: "people-v3-artwork-correction-attempt-v1", generatedAt, status: "proof-only", publicationAuthorised: false, fullGenerationAuthorised: false, posterGenerationAuthorised: false, sourceAttemptRoot: sourceAttemptRoot ? posixRelative(sourceAttemptRoot) : null };
    const reportPath = path.join(attemptRoot, "correction-attempt.json");
    await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ mode: options.mode, valid: true, attemptRoot, reportPath }, null, 2)}\n`);
    return;
  }
  assert(await exists(path.join(attemptRoot, "correction-attempt.json")), "Run --init before correction proof generation.");
  if (options.mode === "title-proof") {
    const context = await loadPeopleV3ProofContext({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT });
    const result = await generateTitleLogoCorrectionProof({ attemptRoot, people: context.titleLogoPeople, generatedAt, runtime, fontDirectory });
    process.stdout.write(`${JSON.stringify({ mode: options.mode, valid: true, reportPath: result.reportPath, report: result.report }, null, 2)}\n`);
    return;
  }
  if (options.mode === "verify-hero") {
    const hero = await inspectSharedPeopleHero({ repoRoot: PEOPLE_ARTWORK_REPO_ROOT, sharp: runtime.sharp });
    assert(hero.sha256 === "5d63ec7bf3c80d2b7437411d67471747749e136e5924840715fb85a49c62a840" && hero.dimensions.width === 1695 && hero.dimensions.height === 928, "Shared People hero differs from the protected reviewed bytes.");
    const report = { version: "people-v3-shared-hero-validation-v1", generatedAt, valid: true, altered: false, regenerated: false, compositedInCorrectionProof: false, hero };
    const reportPath = path.join(attemptRoot, "validation", "shared-hero.json");
    await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ mode: options.mode, reportPath, report }, null, 2)}\n`);
    return;
  }
  if (options.mode === "summary") {
    const paths = {
      title: await latestTitleProofReport(attemptRoot),
      landscape: await latestLandscapeProofReport(attemptRoot),
      hero: path.join(attemptRoot, "validation", "shared-hero.json"),
    };
    const [title, landscape, hero] = await Promise.all(Object.values(paths).map((filePath) => fs.readFile(filePath, "utf8").then(JSON.parse)));
    const summary = { version: "people-v3-artwork-correction-summary-v1", generatedAt, valid: true, publicationAuthorised: false, permanentTitleVariantSelected: false, title, landscape, hero };
    const summaryPath = path.join(attemptRoot, "correction-summary.json");
    await atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ mode: options.mode, valid: true, summaryPath }, null, 2)}\n`);
    return;
  }
  assert(sourceAttemptRoot, `${options.mode} requires --source-attempt-root.`);
  const result = options.mode === "landscape-prototypes"
    ? await generateLandscapeCropPrototypes({ attemptRoot, sourceAttemptRoot, generatedAt, runtime, fontDirectory })
    : await generateLandscapeCorrectionProof({ attemptRoot, sourceAttemptRoot, generatedAt, runtime, fontDirectory });
  process.stdout.write(`${JSON.stringify({ mode: options.mode, valid: true, reportPath: result.reportPath, report: result.report }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

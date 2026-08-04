import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const aliasExclusionsByPersonId = new Map([
  [115440, new Set(["markiplier"])],
]);

export const FOUNDATION_ALIAS_EXCLUSIONS = Object.freeze([
  Object.freeze({
    tmdbPersonId: 115440,
    stableKey: "person:115440",
    canonicalName: "Sydney Sweeney",
    alias: "markiplier",
    reason: "Invalid alias retained by the 2026-07-16 ignored foundation draft and removed from tracked data by commit 18e0748.",
  }),
]);

export function foundationAliasesForPerson(tmdbPersonId, aliases) {
  if (!Number.isInteger(tmdbPersonId) || tmdbPersonId <= 0) {
    throw new Error("Foundation alias correction requires an exact positive TMDB Person ID.");
  }
  if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
    throw new Error(`person:${tmdbPersonId} aliases must be an array of strings.`);
  }
  const exclusions = aliasExclusionsByPersonId.get(tmdbPersonId);
  return aliases.filter((alias) => !exclusions?.has(alias));
}

async function readFiles(root, fileNames) {
  return Object.fromEntries(await Promise.all(fileNames.map(async (fileName) => [
    fileName,
    await fs.readFile(path.join(root, fileName)),
  ])));
}

function fileComparisons(fileNames, tracked, first, second) {
  return fileNames.map((fileName) => ({
    path: `data/people/${fileName}`,
    trackedSha256: sha256(tracked[fileName]),
    firstBuildSha256: sha256(first[fileName]),
    secondBuildSha256: sha256(second[fileName]),
    firstBuildMatchesTracked: first[fileName].equals(tracked[fileName]),
    replayByteIdentical: first[fileName].equals(second[fileName]),
  }));
}

async function assertExactOutputSet(outputDirectory, fileNames) {
  const actual = (await fs.readdir(outputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const expected = [...fileNames].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Isolated foundation build produced an unexpected file set: ${JSON.stringify(actual)}.`);
  }
}

export async function verifyIsolatedFoundationBuild({
  trackedDirectory,
  fileNames,
  runBuild,
  temporaryParent = os.tmpdir(),
}) {
  if (!Array.isArray(fileNames) || fileNames.length === 0 || new Set(fileNames).size !== fileNames.length) {
    throw new Error("Isolated foundation verification requires unique canonical file names.");
  }
  const trackedBefore = await readFiles(trackedDirectory, fileNames);
  const trackedStatsBefore = Object.fromEntries(await Promise.all(fileNames.map(async (fileName) => [
    fileName,
    await fs.stat(path.join(trackedDirectory, fileName)),
  ])));
  const temporaryRoot = await fs.mkdtemp(path.join(temporaryParent, "nuvio-people-foundation-verify-"));
  let result;
  let buildError;
  try {
    const runRoots = [1, 2].map((number) => ({
      outputDirectory: path.join(temporaryRoot, `run-${number}`, "data", "people"),
      reviewDirectory: path.join(temporaryRoot, `run-${number}`, "review"),
    }));
    for (const [index, roots] of runRoots.entries()) {
      await runBuild({ ...roots, runNumber: index + 1 });
      await assertExactOutputSet(roots.outputDirectory, fileNames);
    }
    const [first, second] = await Promise.all(runRoots.map((roots) => readFiles(roots.outputDirectory, fileNames)));
    const comparisons = fileComparisons(fileNames, trackedBefore, first, second);
    if (comparisons.some((item) => !item.replayByteIdentical)) {
      throw new Error("Repeated isolated foundation builds were not byte-identical.");
    }
    if (comparisons.some((item) => !item.firstBuildMatchesTracked)) {
      throw new Error("Isolated full rebuild did not reproduce the tracked canonical files.");
    }
    result = {
      isolated: true,
      buildRuns: 2,
      replayByteIdentical: true,
      trackedFilesUnchanged: true,
      comparisons,
      temporaryRoot,
    };
  } catch (error) {
    buildError = error;
  } finally {
    const trackedAfter = await readFiles(trackedDirectory, fileNames);
    const trackedStatsAfter = Object.fromEntries(await Promise.all(fileNames.map(async (fileName) => [
      fileName,
      await fs.stat(path.join(trackedDirectory, fileName)),
    ])));
    const changedTrackedFiles = fileNames.filter((fileName) => (
      !trackedBefore[fileName].equals(trackedAfter[fileName])
      || trackedStatsBefore[fileName].size !== trackedStatsAfter[fileName].size
      || trackedStatsBefore[fileName].mtimeMs !== trackedStatsAfter[fileName].mtimeMs
    ));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    if (changedTrackedFiles.length > 0) {
      throw new Error(`Unsafe foundation verification modified tracked files: ${changedTrackedFiles.join(", ")}.`, { cause: buildError });
    }
  }
  if (buildError) throw buildError;
  return result;
}

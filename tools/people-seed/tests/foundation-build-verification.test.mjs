import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  foundationAliasesForPerson,
  verifyIsolatedFoundationBuild,
} from "../src/foundation-build-verification.mjs";

const canonicalFiles = ["people-registry.json", "actors-seed.json", "directors-seed.json", "sources.json"];

test("alias corrections bind to exact TMDB Person IDs and cannot bleed between neighbours", () => {
  const fixtures = [
    { tmdbPersonId: 115439, canonicalName: "Neighbour Before", aliases: ["before-only"] },
    { tmdbPersonId: 115440, canonicalName: "Sydney Sweeney", aliases: ["markiplier", "Sydney Bernice Sweeney"] },
    { tmdbPersonId: 115441, canonicalName: "Neighbour After", aliases: ["markiplier", "after-only"] },
  ];
  const corrected = fixtures.map((record) => ({
    ...record,
    aliases: foundationAliasesForPerson(record.tmdbPersonId, record.aliases),
  }));
  assert.deepEqual(corrected[0].aliases, ["before-only"]);
  assert.deepEqual(corrected[1].aliases, ["Sydney Bernice Sweeney"]);
  assert.deepEqual(corrected[2].aliases, ["markiplier", "after-only"]);
  corrected[0].aliases.push("local-mutation");
  assert.deepEqual(corrected[1].aliases, ["Sydney Bernice Sweeney"]);
  assert.deepEqual(fixtures[0].aliases, ["before-only"]);
});

test("input ordering and names cannot redirect exact-ID alias corrections", () => {
  const fixtures = [
    { tmdbPersonId: 115441, canonicalName: "Sydney Sweeney", aliases: ["markiplier"] },
    { tmdbPersonId: 115440, canonicalName: "Different Display Name", aliases: ["markiplier", "Sydney Bernice Sweeney"] },
    { tmdbPersonId: 115439, canonicalName: "Neighbour", aliases: ["neighbour-only"] },
  ];
  const apply = (records) => Object.fromEntries(records.map((record) => [
    record.tmdbPersonId,
    foundationAliasesForPerson(record.tmdbPersonId, record.aliases),
  ]));
  assert.deepEqual(apply(fixtures), apply([...fixtures].reverse()));
  assert.deepEqual(apply(fixtures)[115440], ["Sydney Bernice Sweeney"]);
  assert.deepEqual(apply(fixtures)[115441], ["markiplier"]);
});

test("isolated verification leaves tracked files untouched and repeated output byte-identical", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-foundation-verifier-test-"));
  try {
    const trackedDirectory = path.join(fixtureRoot, "tracked");
    await fs.mkdir(trackedDirectory, { recursive: true });
    const content = Object.fromEntries(canonicalFiles.map((fileName, index) => [fileName, `${fileName}:${index}\n`]));
    await Promise.all(canonicalFiles.map((fileName) => fs.writeFile(path.join(trackedDirectory, fileName), content[fileName])));
    const beforeStats = Object.fromEntries(await Promise.all(canonicalFiles.map(async (fileName) => [fileName, await fs.stat(path.join(trackedDirectory, fileName))])));
    const result = await verifyIsolatedFoundationBuild({
      trackedDirectory,
      fileNames: canonicalFiles,
      temporaryParent: fixtureRoot,
      runBuild: async ({ outputDirectory }) => {
        await fs.mkdir(outputDirectory, { recursive: true });
        await Promise.all([...canonicalFiles].reverse().map((fileName) => fs.writeFile(path.join(outputDirectory, fileName), content[fileName])));
      },
    });
    assert.equal(result.buildRuns, 2);
    assert.equal(result.replayByteIdentical, true);
    assert.ok(result.comparisons.every((item) => item.firstBuildMatchesTracked && item.replayByteIdentical));
    await assert.rejects(fs.access(result.temporaryRoot));
    for (const fileName of canonicalFiles) {
      assert.equal(await fs.readFile(path.join(trackedDirectory, fileName), "utf8"), content[fileName]);
      assert.equal((await fs.stat(path.join(trackedDirectory, fileName))).mtimeMs, beforeStats[fileName].mtimeMs);
    }
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("failed isolated verification leaves no partial output or tracked change", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-foundation-verifier-failure-test-"));
  try {
    const trackedDirectory = path.join(fixtureRoot, "tracked");
    await fs.mkdir(trackedDirectory, { recursive: true });
    await Promise.all(canonicalFiles.map((fileName) => fs.writeFile(path.join(trackedDirectory, fileName), `${fileName}:tracked\n`)));
    const before = await Promise.all(canonicalFiles.map((fileName) => fs.readFile(path.join(trackedDirectory, fileName))));
    const beforeStats = await Promise.all(canonicalFiles.map((fileName) => fs.stat(path.join(trackedDirectory, fileName))));
    await assert.rejects(verifyIsolatedFoundationBuild({
      trackedDirectory,
      fileNames: canonicalFiles,
      temporaryParent: fixtureRoot,
      runBuild: async ({ outputDirectory }) => {
        await fs.mkdir(outputDirectory, { recursive: true });
        await fs.writeFile(path.join(outputDirectory, canonicalFiles[0]), "partial\n");
        throw new Error("synthetic build failure");
      },
    }), /synthetic build failure/);
    const after = await Promise.all(canonicalFiles.map((fileName) => fs.readFile(path.join(trackedDirectory, fileName))));
    assert.ok(after.every((value, index) => value.equals(before[index])));
    const afterStats = await Promise.all(canonicalFiles.map((fileName) => fs.stat(path.join(trackedDirectory, fileName))));
    assert.ok(afterStats.every((value, index) => value.mtimeMs === beforeStats[index].mtimeMs));
    assert.deepEqual((await fs.readdir(fixtureRoot)).sort(), ["tracked"]);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

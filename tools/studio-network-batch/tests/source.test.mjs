import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadSourceData } from "../src/load-source.mjs";
import { resolveSourceDirectory } from "../src/source-path.mjs";

const fixtureSource = path.resolve("tests/fixtures/source");

test("loads both fixture sources and returns deterministic entity ordering", async () => {
  const result = await loadSourceData(fixtureSource);
  assert.deepEqual(result.entities.map((entity) => entity.stableKey), [
    "company:1", "company:2", "company:3", "network:10", "network:11", "network:12",
  ]);
  assert.deepEqual(result.rawRecordCounts, { company: 3, network: 3, combined: 6 });
  assert.deepEqual(result.validationErrors, []);
});

test("source directory resolution prioritises CLI, environment, then sibling", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-source-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  async function makeSource(name) {
    const directory = path.join(root, name);
    await fs.mkdir(path.join(directory, "data"), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(directory, "data/companies.min.json"), "[]"),
      fs.writeFile(path.join(directory, "data/tv-networks.min.json"), "[]"),
    ]);
    return directory;
  }
  const explicit = await makeSource("explicit");
  const environment = await makeSource("environment");
  const repoRoot = path.join(root, "nuvio-assets");
  await fs.mkdir(path.join(repoRoot, "assets"), { recursive: true });
  const sibling = await makeSource("tmdb-id-lookup");

  assert.equal(resolveSourceDirectory({ sourceDir: explicit, env: { TMDB_ID_LOOKUP_DIR: environment }, repoRoot }).directory, explicit);
  assert.equal(resolveSourceDirectory({ env: { TMDB_ID_LOOKUP_DIR: environment }, repoRoot }).directory, environment);
  assert.equal(resolveSourceDirectory({ env: {}, repoRoot }).directory, sibling);
});

test("missing, invalid JSON, and non-array top levels produce clear errors", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-load-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "data"));
  await fs.writeFile(path.join(root, "data/companies.min.json"), "{");
  await fs.writeFile(path.join(root, "data/tv-networks.min.json"), "{}");
  await assert.rejects(loadSourceData(root), /Invalid JSON/);
  await fs.writeFile(path.join(root, "data/companies.min.json"), "[]");
  await assert.rejects(loadSourceData(root), /top-level array/);
  await fs.rm(path.join(root, "data/tv-networks.min.json"));
  await assert.rejects(loadSourceData(root), /Missing network source JSON/);
});

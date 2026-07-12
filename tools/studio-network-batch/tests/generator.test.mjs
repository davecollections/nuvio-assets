import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { generateBatch } from "../src/generator.mjs";

const presetTemplate = JSON.parse(await fs.readFile(new URL("../presets/poc-v1.json", import.meta.url), "utf8"));

function entity(tmdbId, logoPath, name = `Entity ${tmdbId}`) {
  return {
    entityType: "company",
    tmdbId,
    stableKey: `company:${tmdbId}`,
    name,
    titleCount: 100,
    logoPath,
    parentCompany: "",
    originCountry: "",
    headquarters: "",
  };
}

async function setup(context) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nuvio-generator-"));
  context.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const sourceDirectory = path.join(packageRoot, "source");
  await fs.mkdir(sourceDirectory);
  const companyFile = path.join(sourceDirectory, "companies.json");
  const networkFile = path.join(sourceDirectory, "networks.json");
  await fs.writeFile(companyFile, "[]");
  await fs.writeFile(networkFile, "[]");
  const sourceData = {
    sourceDirectory,
    sourceFiles: { company: companyFile, network: networkFile },
  };
  const logo = await sharp({ create: { width: 160, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: { create: { width: 120, height: 40, channels: 4, background: "#FFFFFF" } }, left: 20, top: 20 }])
    .png()
    .toBuffer();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(logo, { status: 200, headers: { "content-type": "image/png" } });
  };
  const preset = structuredClone(presetTemplate);
  preset.variants.stableKeys = [];
  return { packageRoot, sourceData, fetchImpl, requestCount: () => requests, preset };
}

function plan(selected, mode = "explicit") {
  return { mode, selected, selectedCount: selected.length, issues: { malformedKeys: [], unknownKeys: [], ineligibleKeys: [], removedKeys: [], ineligibleManifestKeys: [] } };
}

test("dry-run performs no downloads and creates no working directory", async (context) => {
  const fixture = await setup(context);
  const result = await generateBatch({
    plan: plan([entity(1, "/one.png")]),
    preset: fixture.preset,
    packageRoot: fixture.packageRoot,
    sourceData: fixture.sourceData,
    dryRun: true,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(result.dryRun, true);
  assert.equal(fixture.requestCount(), 0);
  await assert.rejects(fs.access(path.join(fixture.packageRoot, ".work")));
});

test("duplicate logo paths share downloads, analysis, and render work but get separate files", async (context) => {
  const fixture = await setup(context);
  const selected = [entity(1, "/same.png"), entity(2, "/same.png")];
  const result = await generateBatch({
    plan: plan(selected), preset: fixture.preset, packageRoot: fixture.packageRoot,
    sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
  });
  assert.equal(result.generated, 2);
  assert.equal(fixture.requestCount(), 1);
  assert.equal(result.records[1].analysisReused, true);
  assert.equal(result.records[1].renderReused, true);
  assert.notEqual(result.records[0].outputPath, result.records[1].outputPath);
  await Promise.all(result.records.map((record) => fs.access(record.outputPath)));
});

test("unchanged outputs skip, changed logo paths regenerate, and force regenerates only selected IDs", async (context) => {
  const fixture = await setup(context);
  const firstEntity = entity(1, "/one.png");
  const secondEntity = entity(2, "/two.png");
  const first = await generateBatch({
    plan: plan([firstEntity, secondEntity]), preset: fixture.preset, packageRoot: fixture.packageRoot,
    sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
  });
  const secondPath = first.records[1].outputPath;
  const secondBefore = (await fs.stat(secondPath)).mtimeMs;
  const unchanged = await generateBatch({
    plan: plan([firstEntity, secondEntity]), preset: fixture.preset, packageRoot: fixture.packageRoot,
    sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
  });
  assert.equal(unchanged.skipped, 2);

  const changed = await generateBatch({
    plan: plan([{ ...firstEntity, logoPath: "/changed.png" }]), preset: fixture.preset,
    packageRoot: fixture.packageRoot, sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
  });
  assert.equal(changed.generated, 1);
  assert.equal(changed.records[0].logoPath, "/changed.png");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const forced = await generateBatch({
    plan: plan([{ ...firstEntity, logoPath: "/changed.png" }]), preset: fixture.preset,
    packageRoot: fixture.packageRoot, sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
    force: true,
  });
  assert.equal(forced.generated, 1);
  assert.equal(forced.totalSelected, 1);
  assert.equal((await fs.stat(secondPath)).mtimeMs, secondBefore);
});

test("missing-logo generation produces a forced-review fallback", async (context) => {
  const fixture = await setup(context);
  const result = await generateBatch({
    plan: plan([entity(184, "", "Syndication")]), preset: fixture.preset,
    packageRoot: fixture.packageRoot, sourceData: fixture.sourceData, fetchImpl: fixture.fetchImpl,
  });
  assert.equal(result.fallbackGenerated, 1);
  assert.equal(result.records[0].status, "missing-logo");
  assert.equal(result.records[0].reviewStatus, "needs-review");
  assert.deepEqual(result.records[0].fallbackLines, ["Syndication"]);
});

test("one failed download is recorded while remaining selected records continue", async (context) => {
  const fixture = await setup(context);
  const fetchImpl = async (url) => {
    if (url.endsWith("/bad.png")) return new Response("no", { status: 404 });
    return fixture.fetchImpl(url);
  };
  const result = await generateBatch({
    plan: plan([entity(1, "/bad.png"), entity(2, "/good.png")]), preset: fixture.preset,
    packageRoot: fixture.packageRoot, sourceData: fixture.sourceData, fetchImpl,
  });
  assert.equal(result.failedDownload, 1);
  assert.equal(result.generated, 1);
  assert.equal(result.records[0].errorCode, "http_failure");
});

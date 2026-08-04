import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PEOPLE_V3_FULL_GENERATION_VERSION } from "../src/people-v3-full-generation.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

test("full-generation staging remains exact-ID-only, ignored, resumable, and non-publishing", async () => {
  const [source, cli] = await Promise.all([
    fs.readFile(path.join(repoRoot, "tools", "people-seed", "src", "people-v3-full-generation.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "tools", "people-seed", "scripts", "people-v3-full-generation.mjs"), "utf8"),
  ]);
  assert.equal(PEOPLE_V3_FULL_GENERATION_VERSION, "people-v3-full-generation-v1");
  assert.match(source, /api\.themoviedb\.org\/3\/person\/\$\{person\.tmdbPersonId\}/u);
  assert.match(source, /resolvePortraitSource/u);
  assert.match(source, /checkpoints/u);
  assert.match(source, /execFileAsync\(process\.execPath/u);
  assert.match(source, /freshProcessReplay/u);
  assert.match(source, /profilePathAvailable === false/u);
  assert.match(source, /\(\?:\^\|\["'\]\)\[A-Za-z\]:/u);
  assert.match(source, /cropRetainedAreaFraction \|\| 1\) < 0\.67/u);
  assert.match(source, /approvedChinSafeOverrides/u);
  assert.match(source, /sourceWidth < 600 \|\| record\.sourceHeight < 800/u);
  assert.match(source, /cropOverrides\.config\.records\.length === 167/u);
  assert.match(source, /replacementMetadataDeltaBytes/u);
  assert.match(cli, /--review-title-logos/u);
  assert.match(source, /publicationAuthorised:\s*false/u);
  assert.doesNotMatch(`${source}\n${cli}`, /tmdb-id-lookup|search\/person|person\/images|person-images|face.?match|general.?web.?search/iu);
  assert.doesNotMatch(`${source}\n${cli}`, /exec(?:File|Sync)?.*\b(?:git|gh)\b|spawn.*\b(?:git|gh)\b/iu);
});

test("full-generation tooling binds the exact approved candidate counts and 60 px design", async () => {
  const [source, preset] = await Promise.all([
    fs.readFile(path.join(repoRoot, "tools", "people-seed", "src", "people-v3-full-generation.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "tools", "people-seed", "presets", "people-title-logo-cormorant-production-v1.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(preset.design.id, "cormorant-60");
  assert.equal(preset.design.clearGap, 60);
  assert.equal(preset.publicationAuthorised, true);
  for (const value of [663, 1326, 1480, 2960, 1820, 572, 3872, 2052, 5924]) assert.match(source, new RegExp(`\\b${value}\\b`, "u"));
  assert.match(source, /cb0453de2ea1213577b2b3d4bcc177696d65264bbafd31a9bf96620a13e2177a/u);
});

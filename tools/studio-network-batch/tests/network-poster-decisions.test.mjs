import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveNetworkPosterDecision,
  resolveNetworkPosterFallback,
  validateNetworkPosterDecisions,
} from "../src/network-poster-decisions.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = validateNetworkPosterDecisions(
  JSON.parse(await fs.readFile(path.join(packageRoot, "config/network-poster-decisions.json"), "utf8")),
);

test("tracked poster configuration contains only the 11 approved source-bound backgrounds and Syndication fallback", () => {
  assert.equal(config.backgroundDecisions.length, 11);
  assert.equal(config.backgroundDecisions.filter((record) => record.background === "light").length, 10);
  assert.deepEqual(
    config.backgroundDecisions.filter((record) => record.background === "dark").map((record) => record.stableKey),
    ["network:1073"],
  );
  assert.deepEqual(config.fallbackApprovals.map((record) => record.stableKey), ["network:184"]);
});

test("poster decisions resolve only for exact ID, source path and SHA and never affect landscape", () => {
  const approved = config.backgroundDecisions[0];
  assert.equal(resolveNetworkPosterDecision(config, {
    stableKey: approved.stableKey,
    tmdbId: approved.tmdbId,
    sourceLogoPath: approved.sourceLogoPath,
    sourceLogoSha256: approved.sourceLogoSha256,
  }).status, "resolved");
  assert.equal(resolveNetworkPosterDecision(config, {
    stableKey: approved.stableKey,
    tmdbId: approved.tmdbId,
    sourceLogoPath: approved.sourceLogoPath,
    sourceLogoSha256: "0".repeat(64),
  }).status, "stale");
  assert.equal(resolveNetworkPosterDecision(config, {
    stableKey: approved.stableKey,
    tmdbId: approved.tmdbId,
    sourceLogoPath: approved.sourceLogoPath,
    sourceLogoSha256: approved.sourceLogoSha256,
    orientation: "landscape",
  }).status, "not-applicable");
});

test("fallback approval fails closed when the canonical identity changes", () => {
  assert.equal(resolveNetworkPosterFallback(config, {
    stableKey: "network:184",
    tmdbId: 184,
    name: "Syndication",
  }).status, "resolved");
  assert.equal(resolveNetworkPosterFallback(config, {
    stableKey: "network:184",
    tmdbId: 184,
    name: "Renamed",
  }).status, "stale");
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createContactSheet } from "../src/contact-sheet.mjs";
import { analyseLogo, chooseBackground } from "../src/image-analysis.mjs";
import {
  createLogoDownloader,
  logoCacheKey,
  logoCachePath,
  logoUrlFor,
} from "../src/logo-cache.mjs";
import { validateOutput } from "../src/output-validation.mjs";
import {
  calculateFit,
  renderFallbackCover,
  renderLogoCover,
  stagedOutputPath,
  writeRenderedOutput,
} from "../src/render.mjs";

const preset = JSON.parse(await fs.readFile(new URL("../presets/poc-v1.json", import.meta.url), "utf8"));

async function temporaryDirectory(context, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function rectangleLogo({ width = 100, height = 80, left = 20, top = 10, rectangleWidth = 40, rectangleHeight = 30, colour = { r: 255, g: 255, b: 255, alpha: 255 } } = {}) {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: rectangleWidth, height: rectangleHeight, channels: 4, background: colour } }, left, top }])
    .png()
    .toBuffer();
}

test("constructs original-resolution TMDB URLs and deterministic cache keys", () => {
  assert.equal(logoUrlFor("/logo-path.png"), "https://image.tmdb.org/t/p/original/logo-path.png");
  assert.equal(logoCacheKey("/logo-path.png"), logoCacheKey("/logo-path.png"));
  assert.notEqual(logoCacheKey("/logo-path.png"), logoCacheKey("/other.png"));
  assert.match(logoCachePath("cache", "/logo-path.png"), /[a-f0-9]{64}\.png$/);
});

test("downloads once, reuses exact duplicate paths in-run, and reuses a valid cache later", async (context) => {
  const cacheDirectory = await temporaryDirectory(context, "nuvio-cache-");
  const logo = await rectangleLogo();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(logo, { status: 200, headers: { "content-type": "image/png" } });
  };
  const first = createLogoDownloader({ cacheDirectory, fetchImpl, retries: 0 });
  const downloaded = await first.download("/same.png");
  const duplicate = await first.download("/same.png");
  assert.equal(requests, 1);
  assert.equal(downloaded.reused, false);
  assert.equal(duplicate.reuseKind, "in-run");
  assert.equal(duplicate.sourceHash, downloaded.sourceHash);

  const later = createLogoDownloader({ cacheDirectory, fetchImpl, retries: 0 });
  const cached = await later.download("/same.png");
  assert.equal(requests, 1);
  assert.equal(cached.reuseKind, "cache");
});

test("refresh-logo-cache refetches only once per distinct in-run path", async (context) => {
  const cacheDirectory = await temporaryDirectory(context, "nuvio-refresh-");
  const logo = await rectangleLogo();
  let requests = 0;
  const downloader = createLogoDownloader({
    cacheDirectory,
    fetchImpl: async () => {
      requests += 1;
      return new Response(logo, { status: 200, headers: { "content-type": "image/png" } });
    },
    retries: 0,
  });
  await downloader.download("/refresh.png", { refresh: true });
  await downloader.download("/refresh.png", { refresh: true });
  assert.equal(requests, 1);
});

test("permanent HTTP failures are reported without unbounded retries", async (context) => {
  const cacheDirectory = await temporaryDirectory(context, "nuvio-http-");
  let requests = 0;
  const downloader = createLogoDownloader({
    cacheDirectory,
    fetchImpl: async () => {
      requests += 1;
      return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
    },
    retries: 3,
  });
  await assert.rejects(downloader.download("/missing.png"), (error) => error.code === "http_failure");
  assert.equal(requests, 1);
});

test("transient HTTP failures use bounded retries and delay", async (context) => {
  const cacheDirectory = await temporaryDirectory(context, "nuvio-retry-");
  const logo = await rectangleLogo();
  let requests = 0;
  const delays = [];
  const downloader = createLogoDownloader({
    cacheDirectory,
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? new Response("busy", { status: 503 })
        : new Response(logo, { status: 200, headers: { "content-type": "image/png" } });
    },
    retries: 2,
    retryDelayMs: 10,
    sleep: async (milliseconds) => delays.push(milliseconds),
  });
  await downloader.download("/retry.png");
  assert.equal(requests, 2);
  assert.deepEqual(delays, [10]);
});

test("visible bounds detect transparent padding exactly", async () => {
  const analysis = await analyseLogo(await rectangleLogo(), preset);
  assert.deepEqual(analysis.visibleBounds, { left: 20, top: 10, width: 40, height: 30 });
  assert.deepEqual(analysis.transparentPadding, { left: 20, top: 10, right: 40, bottom: 40 });
  assert.equal(analysis.visiblePixelCount, 1200);
  assert.ok(analysis.visibleAreaProportion < 0.2);
});

test("alpha threshold includes alpha 8 and excludes alpha 7", async () => {
  const raw = Buffer.from([
    255, 255, 255, 7,
    255, 255, 255, 8,
  ]);
  const png = await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const analysis = await analyseLogo(png, preset);
  assert.deepEqual(analysis.visibleBounds, { left: 1, top: 0, width: 1, height: 1 });
  assert.equal(analysis.visiblePixelCount, 1);
});

test("entirely transparent images fail clearly", async () => {
  const transparent = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(analyseLogo(transparent, preset), (error) => error.code === "no_visible_pixels");
});

test("dark and light logos select the stronger opposite background", () => {
  const config = preset.contrast;
  assert.equal(chooseBackground([{ r: 0, g: 0, b: 0, a: 255 }], preset.backgrounds, config).selected, "light");
  assert.equal(chooseBackground([{ r: 255, g: 255, b: 255, a: 255 }], preset.backgrounds, config).selected, "dark");
});

test("colourful-logo selection is deterministic", () => {
  const pixels = [
    { r: 230, g: 20, b: 80, a: 255 },
    { r: 10, g: 180, b: 220, a: 200 },
    { r: 250, g: 180, b: 20, a: 128 },
    { r: 60, g: 30, b: 180, a: 255 },
  ];
  assert.deepEqual(
    chooseBackground(pixels, preset.backgrounds, preset.contrast),
    chooseBackground(pixels, preset.backgrounds, preset.contrast),
  );
});

test("safe-box fitting is width- and height-limited without distortion", () => {
  const wide = calculateFit(1000, 100, preset.canvas, preset.logo);
  assert.equal(wide.width, 864);
  assert.ok(wide.height <= 324);
  assert.ok(Math.abs(wide.width / wide.height - 10) < 0.12);
  const tall = calculateFit(100, 1000, preset.canvas, preset.logo);
  assert.equal(tall.height, 324);
  assert.ok(tall.width <= 864);
  assert.ok(Math.abs(tall.width / tall.height - 0.1) < 0.01);
});

test("renders and validates an exact 1200x675 WebP, flagging high upscale", async (context) => {
  const directory = await temporaryDirectory(context, "nuvio-render-");
  const analysis = await analyseLogo(await rectangleLogo({ width: 20, height: 10, left: 5, top: 2, rectangleWidth: 10, rectangleHeight: 5 }), preset);
  const rendered = await renderLogoCover(analysis, preset);
  assert.ok(rendered.reviewReasons.includes("high-upscale-factor"));
  const outputPath = path.join(directory, "cover.webp");
  await writeRenderedOutput(outputPath, rendered.buffer);
  const validation = await validateOutput(outputPath, preset);
  assert.equal(validation.outputWidth, 1200);
  assert.equal(validation.outputHeight, 675);
  assert.equal(validation.outputFormat, "webp");
  assert.ok(validation.outputBytes > 0);
});

test("renders a centred missing-logo text fallback and records layout", async (context) => {
  const directory = await temporaryDirectory(context, "nuvio-fallback-");
  const rendered = await renderFallbackCover({ name: "A Longer Missing Network Name" }, preset);
  assert.ok(rendered.layout.fontSize >= 28);
  assert.ok(rendered.layout.lines.length >= 1);
  const outputPath = path.join(directory, "fallback.webp");
  await writeRenderedOutput(outputPath, rendered.buffer);
  await validateOutput(outputPath, preset);
});

test("staged paths are deterministic and preserve separate TMDB identities", () => {
  const left = stagedOutputPath("C:/utility", "poc-v1", { entityType: "company", tmdbId: 10 }, "primary");
  const right = stagedOutputPath("C:/utility", "poc-v1", { entityType: "company", tmdbId: 11 }, "primary");
  assert.notEqual(left, right);
  assert.match(left.replaceAll("\\", "/"), /primary\/companies\/10\.webp$/);
});

test("creates a readable contact sheet from fixture covers", async (context) => {
  const directory = await temporaryDirectory(context, "nuvio-sheet-");
  const cover = await renderFallbackCover({ name: "Fixture" }, preset);
  const coverPath = path.join(directory, "fixture.webp");
  await writeRenderedOutput(coverPath, cover.buffer);
  const sheetPath = path.join(directory, "sheet.png");
  const result = await createContactSheet([
    { name: "Fixture One", tmdbId: 1, entityType: "company", backgroundPreset: "dark-flat", status: "generated", outputPath: coverPath },
    { name: "Fixture Two", tmdbId: 2, entityType: "network", backgroundPreset: "dark-flat", status: "missing-logo", outputPath: coverPath },
  ], sheetPath, { columns: 2 });
  const metadata = await sharp(sheetPath).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, result.width);
  assert.equal(result.items, 2);
});

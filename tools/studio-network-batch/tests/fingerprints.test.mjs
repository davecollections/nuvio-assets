import assert from "node:assert/strict";
import test from "node:test";

import { artworkInputFingerprint, sourceRecordFingerprint } from "../src/fingerprints.mjs";

const entity = {
  entityType: "company", tmdbId: 33, stableKey: "company:33", name: "Universal Pictures",
  titleCount: 200, logoPath: "/logo.png", parentCompany: "", originCountry: "US", headquarters: "",
};

test("source fingerprints are deterministic and include title count", () => {
  assert.equal(sourceRecordFingerprint(entity), sourceRecordFingerprint({ ...entity }));
  assert.notEqual(sourceRecordFingerprint(entity), sourceRecordFingerprint({ ...entity, titleCount: 201 }));
});

test("artwork fingerprints are deterministic and ignore title-count-only changes", () => {
  const options = { rendererVersion: "r1", presetVersion: "p1" };
  assert.equal(artworkInputFingerprint(entity, options), artworkInputFingerprint({ ...entity, titleCount: 201 }, options));
  assert.notEqual(artworkInputFingerprint(entity, options), artworkInputFingerprint({ ...entity, logoPath: "/new.png" }, options));
});

test("artwork fingerprints include name only when fallback text is used", () => {
  const options = { rendererVersion: "r1", presetVersion: "p1" };
  assert.equal(artworkInputFingerprint(entity, options), artworkInputFingerprint({ ...entity, name: "Renamed" }, options));
  const fallback = { ...entity, logoPath: "" };
  assert.notEqual(artworkInputFingerprint(fallback, options), artworkInputFingerprint({ ...fallback, name: "Renamed" }, options));
});

test("renderer and preset versions participate in artwork fingerprints", () => {
  assert.notEqual(
    artworkInputFingerprint(entity, { rendererVersion: "r1", presetVersion: "p1" }),
    artworkInputFingerprint(entity, { rendererVersion: "r2", presetVersion: "p1" }),
  );
  assert.notEqual(
    artworkInputFingerprint(entity, { rendererVersion: "r1", presetVersion: "p1" }),
    artworkInputFingerprint(entity, { rendererVersion: "r1", presetVersion: "p2" }),
  );
});

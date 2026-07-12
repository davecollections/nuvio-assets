import assert from "node:assert/strict";
import test from "node:test";

import { buildAudit } from "../src/audit.mjs";
import { normaliseCompactRecord, normaliseCompactRecords, isValidLogoPath } from "../src/normalise.mjs";

test("normalises a compact company record", () => {
  const { entity, errors } = normaliseCompactRecord(
    { i: 33, n: " Universal Pictures ", p: "Comcast", c: "US", h: "Universal City", l: "/logo.png", t: 2765 },
    "company",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(entity, {
    entityType: "company", tmdbId: 33, stableKey: "company:33", name: "Universal Pictures",
    titleCount: 2765, logoPath: "/logo.png", parentCompany: "Comcast", originCountry: "US",
    headquarters: "Universal City",
  });
});

test("normalises a compact network and ignores company parent mapping", () => {
  const { entity } = normaliseCompactRecord(
    { i: 18, n: "ABC TV", p: "not applicable", c: "AU", h: "Sydney", l: "/abc.svg", t: 674 },
    "network",
  );
  assert.equal(entity.parentCompany, "");
  assert.equal(entity.stableKey, "network:18");
});

test("omitted optional fields normalise to empty strings", () => {
  const { entity, errors } = normaliseCompactRecord({ i: 1, n: "Minimal", t: 0 }, "company");
  assert.deepEqual(errors, []);
  assert.equal(entity.logoPath, "");
  assert.equal(entity.parentCompany, "");
  assert.equal(entity.originCountry, "");
  assert.equal(entity.headquarters, "");
});

test("an omitted compact title count normalises to zero", () => {
  const { entity, errors } = normaliseCompactRecord({ i: 2, n: "No titles yet" }, "network");
  assert.deepEqual(errors, []);
  assert.equal(entity.titleCount, 0);
});

test("eligibility boundary includes 100 and 101 but not 99", () => {
  const entities = [99, 100, 101].map((titleCount, index) => ({
    entityType: "company", tmdbId: index + 1, stableKey: `company:${index + 1}`,
    name: `C${index}`, titleCount, logoPath: "", parentCompany: "", originCountry: "", headquarters: "",
  }));
  const audit = buildAudit({ sourceDirectory: "fixture", entities, validationErrors: [] });
  assert.equal(audit.company.eligibleRecords, 2);
  assert.equal(audit.company.exactly100Records, 1);
});

test("duplicate IDs are reported and only the first valid record is retained", () => {
  const result = normaliseCompactRecords([
    { i: 7, n: "First", t: 100 },
    { i: 7, n: "Second", t: 101 },
  ], "company");
  assert.equal(result.entities.length, 1);
  assert.equal(result.validationErrors[0].code, "duplicate_id");
});

test("malformed IDs and title counts are rejected", () => {
  for (const record of [
    { i: "1", n: "Bad ID", t: 100 },
    { i: 0, n: "Bad ID", t: 100 },
    { i: 1, n: "Bad count", t: -1 },
    { i: 1, n: "Bad count", t: "100" },
  ]) {
    assert.equal(normaliseCompactRecord(record, "company").entity, null);
  }
});

test("valid and invalid logo paths are distinguished", () => {
  for (const value of ["", "/abc.png", "/abc-123_X.svg", "/abc.jpeg", "/abc.webp"]) {
    assert.equal(isValidLogoPath(value), true, value);
  }
  for (const value of ["abc.png", "/two levels/a.png", "/a.png?x=1", "\\a.png", "/a.exe"]) {
    assert.equal(isValidLogoPath(value), false, value);
  }
  assert.equal(normaliseCompactRecord({ i: 1, n: "Bad logo", l: "http://x/a.png", t: 100 }, "network").entity, null);
});

test("blank names are rejected", () => {
  assert.equal(normaliseCompactRecord({ i: 1, n: "  ", t: 100 }, "network").entity, null);
});

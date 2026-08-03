#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { readPeopleFoundation } from "../src/people-validation.mjs";
import {
  assertPeopleV3ProofPath,
  loadTitleLogoConfiguration,
  prepareTitleLogoRenderer,
  renderTitleLogo,
  renderTitleLogoSet,
  selectTitleLogoProofPeople,
} from "../src/people-artwork/title-logo.mjs";
import { PEOPLE_ARTWORK_REPO_ROOT } from "../src/people-artwork/runtime-dependencies.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function parseArguments(argv) {
  const options = { outputDir: null, generatedAt: null, fontDirectory: null, peopleJson: null, hashOnly: false };
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") { options.outputDir = take(index, argument); index += 1; }
    else if (argument === "--generated-at") { options.generatedAt = take(index, argument); index += 1; }
    else if (argument === "--font-dir") { options.fontDirectory = take(index, argument); index += 1; }
    else if (argument === "--people-json") { options.peopleJson = take(index, argument); index += 1; }
    else if (argument === "--hash-only") options.hashOnly = true;
    else throw new Error(`Unknown title-logo proof worker argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert(options.generatedAt, "--generated-at is required.");
  const foundation = await readPeopleFoundation(PEOPLE_ARTWORK_REPO_ROOT);
  let people = selectTitleLogoProofPeople(foundation);
  if (options.peopleJson) {
    const peoplePath = assertPeopleV3ProofPath(path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.peopleJson));
    const selection = JSON.parse(await fs.readFile(peoplePath, "utf8"));
    assert(Array.isArray(selection.records) && selection.recordCount === selection.records.length, "--people-json must contain a complete records selection.");
    people = selection.records;
  }
  const configuration = await loadTitleLogoConfiguration({ registry: foundation.registry });
  const prepared = await prepareTitleLogoRenderer({
    people,
    configuration,
    fontDirectory: options.fontDirectory ? path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.fontDirectory) : null,
  });
  if (options.hashOnly) {
    const records = [];
    for (const person of people) records.push((await renderTitleLogo({ person, ...prepared })).record);
    process.stdout.write(`${JSON.stringify({ designDecisionStatus: "production-locked", permanentDesignSelected: true, personCount: people.length, designCount: 1, recordCount: records.length, records })}\n`);
    return;
  }
  assert(options.outputDir, "--output-dir is required unless --hash-only is selected.");
  const outputDir = assertPeopleV3ProofPath(path.resolve(PEOPLE_ARTWORK_REPO_ROOT, options.outputDir));
  assert(!(await exists(outputDir)), `Title-logo proof worker will not overwrite an existing run: ${outputDir}`);
  const result = await renderTitleLogoSet({ people, outputDir, generatedAt: options.generatedAt, prepared });
  process.stdout.write(`${JSON.stringify({ outputDir: result.outputDir, metadataPath: result.metadataPath, metadataFingerprint: result.metadata.metadataFingerprint, workerPid: process.pid, freshProcess: true })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

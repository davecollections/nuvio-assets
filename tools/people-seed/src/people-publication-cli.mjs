#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPeopleFoundation } from "./people-validation.mjs";
import { renderPeopleArtwork } from "./people-artwork/renderer.mjs";
import { selectPeople } from "./people-artwork/selection.mjs";
import {
  LOCKED_PILOT_RELATIVE_PATH,
  OWNER_REVIEW_FIELDS,
  PEOPLE_ASSET_RELATIVE_ROOT,
  PEOPLE_MANIFEST_RELATIVE_PATH,
  PROMOTION_PROOF_RELATIVE_ROOT,
  atomicWrite,
  buildOwnerReviewRows,
  buildPeopleArtworkManifest,
  calculateManifestFingerprint,
  capturePublicationPreservationState,
  categoryReuseReport,
  comparePublicationPreservation,
  compareRenderWithPromotionEvidence,
  csvDocument,
  generatePublicationContactSheets,
  loadLockedPilot,
  loadPromotionEvidence,
  manifestFileSummary,
  normaliseRepositoryPath,
  promoteRenderedAssets,
  proposedRawUrl,
  stableStringify,
  validateManifestAssets,
  validateOwnerDecisionBindings,
  validateOwnerDecisions,
  validatePeopleArtworkManifest,
  writeJson,
  writePublicationReports,
  zeroNetworkAccounting,
} from "./people-publication.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

export function parsePublicationArguments(argv) {
  const options = {
    lockedPilot: false,
    stableKeys: [],
    stableKeyFile: null,
    seedPath: null,
    tier: null,
    format: "both",
    assetRoot: null,
    manifestPath: null,
    workRoot: null,
    sourceCache: null,
    proofRoot: null,
    publicationCandidateAt: null,
    candidate: false,
    commitReady: false,
    ownerDecisions: null,
    dryRun: false,
    help: false,
  };
  const take = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--locked-pilot") options.lockedPilot = true;
    else if (argument === "--stable-key") { options.stableKeys.push(take(index, argument)); index += 1; }
    else if (argument === "--stable-key-file") { options.stableKeyFile = take(index, argument); index += 1; }
    else if (argument === "--seed") { options.seedPath = take(index, argument); index += 1; }
    else if (argument === "--tier") { options.tier = take(index, argument); index += 1; }
    else if (argument === "--format") { options.format = take(index, argument); index += 1; }
    else if (argument === "--asset-root") { options.assetRoot = take(index, argument); index += 1; }
    else if (argument === "--manifest") { options.manifestPath = take(index, argument); index += 1; }
    else if (argument === "--work-root") { options.workRoot = take(index, argument); index += 1; }
    else if (argument === "--source-cache") { options.sourceCache = take(index, argument); index += 1; }
    else if (argument === "--proof-root") { options.proofRoot = take(index, argument); index += 1; }
    else if (argument === "--publication-candidate-at") { options.publicationCandidateAt = take(index, argument); index += 1; }
    else if (argument === "--owner-decisions") { options.ownerDecisions = take(index, argument); index += 1; }
    else if (argument === "--candidate") options.candidate = true;
    else if (argument === "--commit-ready") options.commitReady = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--offline") { /* publication is always offline */ }
    else throw new Error(`Unknown people publication argument: ${argument}`);
  }
  if (!new Set(["landscape", "poster", "both"]).has(options.format)) throw new Error("--format must be landscape, poster, or both.");
  if (options.tier && !new Set(["initial", "later", "review"]).has(options.tier)) throw new Error("--tier must be initial, later, or review.");
  if (options.candidate && options.commitReady) throw new Error("--candidate and --commit-ready are mutually exclusive.");
  if (options.lockedPilot && (options.stableKeys.length || options.stableKeyFile || options.seedPath || options.tier)) throw new Error("--locked-pilot cannot be combined with another selector.");
  if (options.lockedPilot && options.format !== "both") throw new Error("The locked pilot requires --format both.");
  return options;
}

const HELP = `Nuvio bounded people artwork publication

Selection:
  --locked-pilot                  Use the exact approved locked 40
  --stable-key person:123         Repeat for an explicit bounded selection
  --stable-key-file <path>        JSON array or newline-delimited stable keys
  --seed <path> --tier <tier>     Select a category seed and rollout tier

Required publication paths:
  --asset-root <path>             Explicit people asset root
  --manifest <path>               Explicit manifest path
  --work-root <path>              Ignored report and temporary root
  --source-cache <path>           Approved exact-profile source cache
  --proof-root <path>             Approved promotion parity evidence

Mode:
  --candidate                     Create an owner-review publication candidate
  --commit-ready                  Require completed publish decisions; never commits
  --owner-decisions <path>        Required for commit-ready mode
  --format landscape|poster|both  Default: both
  --publication-candidate-at <ISO timestamp>
  --dry-run                       Print the bounded plan without writes or rendering

This command is permanently offline. It has no commit, push, publication, or network capability.
`;

function resolveExplicit(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return path.resolve(repoRoot, value);
}

function assertSafePublicationPaths(options) {
  const assetRoot = resolveExplicit(options.assetRoot, "--asset-root");
  const manifestPath = resolveExplicit(options.manifestPath, "--manifest");
  const workRoot = resolveExplicit(options.workRoot, "--work-root");
  const sourceCache = resolveExplicit(options.sourceCache, "--source-cache");
  const proofRoot = resolveExplicit(options.proofRoot, "--proof-root");
  const assetRelative = normaliseRepositoryPath(path.relative(repoRoot, assetRoot));
  const manifestRelative = normaliseRepositoryPath(path.relative(repoRoot, manifestPath));
  const workRelative = normaliseRepositoryPath(path.relative(repoRoot, workRoot));
  if (assetRelative !== PEOPLE_ASSET_RELATIVE_ROOT) throw new Error(`--asset-root must resolve to ${PEOPLE_ASSET_RELATIVE_ROOT}.`);
  if (manifestRelative !== PEOPLE_MANIFEST_RELATIVE_PATH) throw new Error(`--manifest must resolve to ${PEOPLE_MANIFEST_RELATIVE_PATH}.`);
  if (!workRelative.startsWith("tools/people-seed/.work/") || workRelative === PROMOTION_PROOF_RELATIVE_ROOT) throw new Error("--work-root must be a dedicated ignored people-seed .work directory.");
  if (path.dirname(manifestPath) !== assetRoot) throw new Error("--manifest must be directly inside --asset-root.");
  return { assetRoot, manifestPath, workRoot, sourceCache, proofRoot };
}

async function readSelection(options, foundation) {
  if (options.lockedPilot) {
    const locked = await loadLockedPilot({ repoRoot });
    const selected = await selectPeople({
      registry: foundation.registry,
      actors: foundation.actors,
      directors: foundation.directors,
      stableKeys: locked.lock.selectedStableKeys,
      repoRoot,
    });
    return { ...selected, locked };
  }
  return {
    ...await selectPeople({
      registry: foundation.registry,
      actors: foundation.actors,
      directors: foundation.directors,
      stableKeys: options.stableKeys,
      stableKeyFile: options.stableKeyFile,
      seedPath: options.seedPath,
      tier: options.tier,
      repoRoot,
    }),
    locked: null,
  };
}

async function currentOrRequestedTimestamp(options, manifestPath) {
  if (options.publicationCandidateAt) {
    if (!Number.isFinite(Date.parse(options.publicationCandidateAt))) throw new Error("--publication-candidate-at must be an ISO date-time.");
    return new Date(options.publicationCandidateAt).toISOString();
  }
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (Number.isFinite(Date.parse(existing.publicationCandidateAt))) return new Date(existing.publicationCandidateAt).toISOString();
  } catch { /* first candidate */ }
  return new Date().toISOString();
}

async function listCandidateWebps(assetRoot) {
  const paths = [];
  for (const formatId of ["landscape", "poster"]) {
    const directory = path.join(assetRoot, formatId);
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { /* absent */ }
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".webp")) paths.push(`${formatId}/${entry.name}`);
  }
  return paths.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(value); value = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((fields) => Object.fromEntries(header.map((name, index) => [name, fields[index] ?? ""])));
}

async function requireCommitReadyDecisions(options, stableKeys) {
  if (!options.commitReady) return null;
  if (!options.ownerDecisions) throw new Error("--commit-ready requires --owner-decisions.");
  const rows = parseCsv(await fs.readFile(path.resolve(repoRoot, options.ownerDecisions), "utf8"));
  const errors = validateOwnerDecisions(rows, stableKeys);
  if (errors.length) throw new Error(`Commit-ready owner decisions are invalid:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  if (rows.some((row) => row.owner_publication_decision !== "publish")) throw new Error("Commit-ready mode requires publish for every selected record; hold, revise, and removal decisions require a new bounded selection.");
  return rows;
}

function exactRows(metadata) {
  return metadata.records.map((record) => ({ stableKey: record.stableKey, formatId: record.formatId, outputHash: record.outputHash, byteCount: record.byteCount }));
}

function contactHashes(contactSheets) {
  return contactSheets.entries.map((entry) => ({ path: entry.path, hash: entry.hash, stableKeys: entry.stableKeys }));
}

function urlProposalRecords(manifest) {
  return manifest.records.flatMap((record) => ["landscape", "poster"].flatMap((formatId) => {
    const repositoryPath = record[`${formatId}Path`];
    return repositoryPath ? [{ stableKey: record.stableKey, formatId, repositoryPath, proposedUrl: record[`${formatId}UrlProposal`] }] : [];
  }));
}

function makeSummary({ manifest, promotion, parity, categoryReuse, network, determinism, preservation, manifestFile, contactSheets, ownerReviewPath, locked, paths }) {
  const actorSelections = locked?.lock.actorSelections.length ?? manifest.records.filter((record) => record.categoryMembership.includes("actor")).length;
  const directorSelections = locked?.lock.directorSelections.length ?? manifest.records.filter((record) => record.categoryMembership.includes("director")).length;
  const markdown = `# People publication candidate\n\n- Status: ${manifest.status}\n- Scope: ${manifest.recordCount} explicitly selected people (${actorSelections} actor memberships, ${directorSelections} director memberships)\n- Assets: ${manifest.landscapeCount} landscape + ${manifest.posterCount} poster = ${manifest.landscapeCount + manifest.posterCount}\n- Fallbacks: ${manifest.fallbackCount}\n- Exact approved parity: ${parity.exactParityCount}/${parity.recordCount}\n- Shared actor/director identities in scope: ${categoryReuse.sharedCategoryPersonCount}\n- Network requests: 0\n- Manifest fingerprint: ${manifest.manifestFingerprint}\n- Manifest SHA-256: ${manifestFile.hash}\n- Owner review: ${normaliseRepositoryPath(path.relative(repoRoot, ownerReviewPath))}\n- Contact sheets: ${contactSheets.entryCount}\n\nThese are local publication-candidate paths and proposed raw URLs. No URL is claimed live before a later commit and push.\n`;
  return {
    version: "people-publication-summary-v1",
    valid: true,
    status: manifest.status,
    lockedSelectionPath: locked ? LOCKED_PILOT_RELATIVE_PATH : null,
    lockedSelectionHash: locked?.lockHash ?? null,
    recordCount: manifest.recordCount,
    actorSelections,
    directorSelections,
    landscapeCount: manifest.landscapeCount,
    posterCount: manifest.posterCount,
    totalAssetCount: manifest.landscapeCount + manifest.posterCount,
    fallbackCount: manifest.fallbackCount,
    exactParity: `${parity.exactParityCount}/${parity.recordCount}`,
    categoryReuse: categoryReuse.valid,
    sourceCacheHits: network.sourceCacheHits,
    networkRequests: network.imageCdnRequests,
    deterministicReplay: determinism.valid,
    preservation: preservation.valid,
    manifestPath: normaliseRepositoryPath(path.relative(repoRoot, paths.manifestPath)),
    manifestHash: manifestFile.hash,
    manifestFingerprint: manifest.manifestFingerprint,
    rawUrlFormat: `${proposedRawUrl("{repositoryPath}")}`,
    ownerReviewPath: normaliseRepositoryPath(path.relative(repoRoot, ownerReviewPath)),
    contactSheetPaths: contactSheets.entries.map((entry) => normaliseRepositoryPath(path.relative(repoRoot, path.join(paths.workRoot, "contact-sheets", entry.path)))),
    promotionActions: promotion,
    markdown,
  };
}

async function main() {
  const options = parsePublicationArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  const foundation = await readPeopleFoundation(repoRoot);
  const selection = await readSelection(options, foundation);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      valid: true,
      dryRun: true,
      offline: true,
      writesPerformed: false,
      renderingPerformed: false,
      selection: selection.selection,
      lockedPilot: options.lockedPilot,
      format: options.format,
      people: selection.people,
    }, null, 2)}\n`);
    return;
  }
  if (!options.candidate && !options.commitReady) throw new Error("Choose --candidate or --commit-ready.");
  const paths = assertSafePublicationPaths(options);
  const ownerDecisionRows = await requireCommitReadyDecisions(options, selection.people.map((person) => person.stableKey));
  const distributionStatus = options.commitReady ? "commit-ready" : "publication-candidate";
  const publicationCandidateAt = await currentOrRequestedTimestamp(options, paths.manifestPath);
  const before = await capturePublicationPreservationState({ repoRoot });
  await writeJson(path.join(paths.workRoot, "baseline", "protected-before.json"), before);
  const evidence = await loadPromotionEvidence({ repoRoot, proofRoot: paths.proofRoot });
  const decisions = JSON.parse(await fs.readFile(path.join(repoRoot, "data/people/portrait-source-decisions.json"), "utf8"));
  const renderRoot = path.join(paths.workRoot, "temporary", "render-current");
  const renderResult = await renderPeopleArtwork({
    people: selection.people,
    decisions,
    sourceCache: paths.sourceCache,
    outputDir: renderRoot,
    format: options.format,
    offline: true,
  });
  const parity = await compareRenderWithPromotionEvidence({ renderResult, renderRoot, evidence });
  const reportsRoot = path.join(paths.workRoot, "reports");
  await writeJson(path.join(reportsRoot, "asset-parity.json"), parity);
  if (!parity.valid) throw new Error(`Exact approved artwork parity failed: ${parity.exactParityCount}/${parity.recordCount}. Permanent candidate paths were not written.`);
  if (options.lockedPilot && (renderResult.metadata.recordCount !== 80 || renderResult.metadata.records.some((record) => record.fallbackUsed))) throw new Error("The locked pilot did not render exactly 80 portrait-backed outputs.");
  const manifest = await buildPeopleArtworkManifest({
    people: selection.people,
    foundation,
    metadata: renderResult.metadata,
    publicationCandidateAt,
    distributionStatus,
    repoRoot,
  });
  const manifestValidation = await validatePeopleArtworkManifest({ manifest, repoRoot, expectedStableKeys: selection.people.map((person) => person.stableKey) });
  if (!manifestValidation.valid) throw new Error(`Candidate manifest failed before promotion:\n${manifestValidation.errors.map((item) => `- ${item}`).join("\n")}`);
  if (options.commitReady) {
    const bindingErrors = validateOwnerDecisionBindings(ownerDecisionRows, manifest);
    if (bindingErrors.length) throw new Error(`Commit-ready owner decisions are stale:\n${bindingErrors.map((item) => `- ${item}`).join("\n")}`);
  }
  const promotion = await promoteRenderedAssets({ repoRoot, renderRoot, metadata: renderResult.metadata });
  await writeJson(paths.manifestPath, manifest);
  const pathValidation = await validateManifestAssets({ manifest, repoRoot });
  const candidateWebps = await listCandidateWebps(paths.assetRoot);
  const expectedWebps = manifest.records.flatMap((record) => [record.landscapePath, record.posterPath]).filter(Boolean).map((repositoryPath) => normaliseRepositoryPath(path.relative(PEOPLE_ASSET_RELATIVE_ROOT, repositoryPath))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const exactCandidateAssetSet = stableStringify(candidateWebps) === stableStringify(expectedWebps);
  if (!manifestValidation.valid || !pathValidation.valid || !exactCandidateAssetSet) throw new Error("Permanent candidate manifest or paths failed validation.");

  const contactSheetRoot = path.join(paths.workRoot, "contact-sheets");
  const contactSheets = await generatePublicationContactSheets({ manifest, outputDir: contactSheetRoot, repoRoot });
  const ownerReviewPath = path.join(paths.workRoot, "owner-review", "publication-decisions.csv");
  await atomicWrite(ownerReviewPath, csvDocument(OWNER_REVIEW_FIELDS, ownerDecisionRows ?? buildOwnerReviewRows(manifest)));

  const replayRoot = path.join(paths.workRoot, "temporary", "replay-render");
  const replay = await renderPeopleArtwork({
    people: selection.people,
    decisions,
    sourceCache: paths.sourceCache,
    outputDir: replayRoot,
    format: options.format,
    offline: true,
  });
  const replayParity = await compareRenderWithPromotionEvidence({ renderResult: replay, renderRoot: replayRoot, evidence });
  const replayManifest = await buildPeopleArtworkManifest({
    people: selection.people,
    foundation,
    metadata: replay.metadata,
    publicationCandidateAt,
    distributionStatus,
    repoRoot,
  });
  const replayContactSheets = await generatePublicationContactSheets({ manifest: replayManifest, outputDir: path.join(paths.workRoot, "temporary", "replay-contact-sheets"), repoRoot });
  const proposalRecords = urlProposalRecords(manifest);
  const urlProposals = {
    version: "people-publication-url-proposals-v1",
    status: "proposal-only-not-live",
    rawUrlFormat: "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/{repositoryPath}",
    recordCount: proposalRecords.length,
    records: proposalRecords,
  };
  const replayUrlProposals = {
    ...urlProposals,
    records: urlProposalRecords(replayManifest),
  };
  const determinism = {
    version: "people-publication-determinism-v1",
    valid: true,
    offlineReplay: true,
    identicalGeneratedAssetHashes: stableStringify(exactRows(renderResult.metadata)) === stableStringify(exactRows(replay.metadata)),
    identicalManifestContent: stableStringify(manifest) === stableStringify(replayManifest),
    identicalManifestFingerprint: manifest.manifestFingerprint === replayManifest.manifestFingerprint,
    identicalUrlProposals: stableStringify(urlProposals) === stableStringify(replayUrlProposals),
    identicalMetadataOrdering: stableStringify(renderResult.metadata.records.map((record) => `${record.stableKey}|${record.formatId}`)) === stableStringify(replay.metadata.records.map((record) => `${record.stableKey}|${record.formatId}`)),
    identicalReportOrdering: stableStringify(parity.records.map((record) => `${record.stableKey}|${record.formatId}`)) === stableStringify(replayParity.records.map((record) => `${record.stableKey}|${record.formatId}`)),
    identicalContactSheetOrderingAndHashes: stableStringify(contactHashes(contactSheets)) === stableStringify(contactHashes(replayContactSheets)),
    replayExactParity: replayParity.valid,
    timestampExcludedFromFingerprint: manifest.fingerprintExcludes.includes("publicationCandidateAt") && manifest.manifestFingerprint === calculateManifestFingerprint(manifest),
  };
  determinism.valid = Object.entries(determinism).filter(([key]) => key !== "version" && key !== "valid").every(([, value]) => value === true);
  if (!determinism.valid) throw new Error("Offline publication replay was not deterministic.");

  const categoryReuse = categoryReuseReport(manifest);
  const networkAccounting = zeroNetworkAccounting(renderResult.networkAccounting, selection.people.length);
  const after = await capturePublicationPreservationState({ repoRoot });
  const preservation = comparePublicationPreservation(before, after);
  await writeJson(path.join(paths.workRoot, "baseline", "protected-after.json"), after);
  if (!preservation.valid) throw new Error("Protected source, proof, studio/network, or lookup state changed during publication candidate generation.");
  const manifestFile = await manifestFileSummary(paths.manifestPath);
  const expectedLandscapeCount = options.format === "poster" ? 0 : selection.people.length;
  const expectedPosterCount = options.format === "landscape" ? 0 : selection.people.length;
  const expectedAssetCount = expectedLandscapeCount + expectedPosterCount;
  const checks = {
    explicitBoundedScope: selection.people.length > 0,
    manifestScopeMatchesSelection: manifest.recordCount === selection.people.length
      && stableStringify(manifest.records.map((record) => record.stableKey)) === stableStringify(selection.people.map((person) => person.stableKey)),
    requestedLandscapeAssets: manifest.landscapeCount === expectedLandscapeCount,
    requestedPosterAssets: manifest.posterCount === expectedPosterCount,
    exactCandidateAssetSet: candidateWebps.length === expectedAssetCount && exactCandidateAssetSet,
    exactApprovedParity: parity.valid && parity.exactParityCount === renderResult.metadata.recordCount,
    categoryNeutralReuse: categoryReuse.valid,
    manifestSchema: manifestValidation.valid,
    pathsAndDecodes: pathValidation.valid,
    distributionStatuses: manifest.status === distributionStatus && manifest.records.every((record) => record.distributionStatus === distributionStatus),
    rightsReviewStatuses: manifest.records.every((record) => record.rightsStatus === "third-party-portrait-review-required"),
    fallbacksRequireRevision: manifest.records.every((record) => !record.fallbackUsed || record.ownerReviewStatus === "revision-required"),
    commitReadyArtworkApproved: !options.commitReady || manifest.records.every((record) => !record.fallbackUsed && record.ownerReviewStatus === "approved-artwork"),
    zeroNetwork: networkAccounting.valid,
    deterministicReplay: determinism.valid,
    preservation: preservation.valid,
    noCommitOrPush: before.primary.head === after.primary.head && before.primary.originMain === after.primary.originMain,
  };
  if (options.lockedPilot) Object.assign(checks, {
    exactLocked40: manifest.recordCount === 40 && stableStringify(manifest.records.map((record) => record.stableKey)) === stableStringify(selection.locked.lock.selectedStableKeys),
    actorSelectionCount24: selection.locked.lock.actorSelections.length === 24,
    directorSelectionCount16: selection.locked.lock.directorSelections.length === 16,
    noArnold: !manifest.records.some((record) => record.stableKey === "person:1100"),
    christianBaleBothFormats: manifest.records.some((record) => record.stableKey === "person:3894" && record.landscapePath && record.posterPath),
    exactly40LandscapeAssets: manifest.landscapeCount === 40,
    exactly40PosterAssets: manifest.posterCount === 40,
    exactly80Assets: candidateWebps.length === 80 && exactCandidateAssetSet,
    zeroFallbacks: manifest.fallbackCount === 0,
  });
  const finalValidation = {
    version: "people-publication-final-validation-v1",
    valid: true,
    checks,
  };
  finalValidation.valid = Object.values(finalValidation.checks).every(Boolean);
  if (!finalValidation.valid) throw new Error("Final bounded publication validation failed.");
  const summary = makeSummary({ manifest, promotion, parity, categoryReuse, network: networkAccounting, determinism, preservation, manifestFile, contactSheets, ownerReviewPath, locked: selection.locked, paths });
  await writePublicationReports({ workRoot: paths.workRoot, summary, pathValidation, manifestValidation, parity, urlProposals, categoryReuse, networkAccounting, determinism, preservation, finalValidation });
  process.stdout.write(`${JSON.stringify({
    valid: true,
    offline: true,
    candidateMode: options.candidate,
    commitReadyMode: options.commitReady,
    selection: selection.selection,
    manifest: manifestFile,
    manifestFingerprint: manifest.manifestFingerprint,
    assets: { landscape: manifest.landscapeCount, poster: manifest.posterCount, total: candidateWebps.length, fallback: manifest.fallbackCount, promotion },
    parity: `${parity.exactParityCount}/${parity.recordCount}`,
    categoryReuse,
    networkAccounting,
    determinism,
    preservationValid: preservation.valid,
    ownerReviewPath,
    contactSheets,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

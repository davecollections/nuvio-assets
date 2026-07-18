import fs from "node:fs/promises";
import path from "node:path";

function unique(values) {
  return [...new Set(values)];
}

function validateStableKey(value) {
  if (!/^person:[1-9][0-9]*$/u.test(value)) throw new Error(`Invalid stable key: ${value}`);
  return value;
}

export async function readStableKeyFile(filePath) {
  const text = await fs.readFile(path.resolve(filePath), "utf8");
  if (/^\s*\[/u.test(text)) {
    const value = JSON.parse(text);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Stable-key JSON file must contain an array of strings.");
    return value.map(validateStableKey);
  }
  return text.split(/\r?\n/u).map((item) => item.trim()).filter((item) => item && !item.startsWith("#")).map(validateStableKey);
}

export async function selectPeople({ registry, actors, directors, stableKeys = [], stableKeyFile = null, seedPath = null, tier = null, repoRoot } = {}) {
  const requested = [...stableKeys.map(validateStableKey)];
  if (stableKeyFile) requested.push(...await readStableKeyFile(stableKeyFile));
  let seed = null;
  if (seedPath) {
    const resolvedSeed = path.resolve(repoRoot, seedPath);
    seed = JSON.parse(await fs.readFile(resolvedSeed, "utf8"));
    if (!Array.isArray(seed.records)) throw new Error(`Seed file has no records array: ${resolvedSeed}`);
    requested.push(...seed.records.filter((record) => !tier || record.rolloutTier === tier).map((record) => validateStableKey(record.stableKey)));
  } else if (tier) {
    throw new Error("--tier requires --seed so actor and director rollout state remains category-specific.");
  }
  const keys = unique(requested);
  if (keys.length === 0) throw new Error("Select at least one person with --stable-key, --stable-key-file, or --seed.");
  const registryByKey = new Map(registry.records.map((record) => [record.stableKey, record]));
  const actorKeys = new Set(actors.records.map((record) => record.stableKey));
  const directorKeys = new Set(directors.records.map((record) => record.stableKey));
  const people = keys.map((stableKey) => {
    const record = registryByKey.get(stableKey);
    if (!record) throw new Error(`Stable key is absent from people-registry.json: ${stableKey}`);
    return {
      stableKey: record.stableKey,
      tmdbPersonId: record.tmdbPersonId,
      canonicalName: record.canonicalName,
      profilePath: record.profilePath,
      categoryMembership: [
        ...(actorKeys.has(stableKey) ? ["actor"] : []),
        ...(directorKeys.has(stableKey) ? ["director"] : []),
      ],
    };
  });
  return { people, selection: { stableKeys: keys, seedPath, tier, recordCount: people.length } };
}

export function parseRendererArguments(argv) {
  const options = {
    stableKeys: [],
    stableKeyFile: null,
    seedPath: null,
    tier: null,
    format: "both",
    outputDir: null,
    sourceCache: null,
    fontDirectory: null,
    offline: true,
    allowNetwork: false,
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
    if (argument === "--stable-key") { options.stableKeys.push(take(index, argument)); index += 1; }
    else if (argument === "--stable-key-file") { options.stableKeyFile = take(index, argument); index += 1; }
    else if (argument === "--seed") { options.seedPath = take(index, argument); index += 1; }
    else if (argument === "--tier") { options.tier = take(index, argument); index += 1; }
    else if (argument === "--format") { options.format = take(index, argument); index += 1; }
    else if (argument === "--output-dir") { options.outputDir = take(index, argument); index += 1; }
    else if (argument === "--source-cache") { options.sourceCache = take(index, argument); index += 1; }
    else if (argument === "--font-dir") { options.fontDirectory = take(index, argument); index += 1; }
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--allow-network") { options.allowNetwork = true; options.offline = false; }
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown people renderer argument: ${argument}`);
  }
  if (!new Set(["landscape", "poster", "both"]).has(options.format)) throw new Error("--format must be landscape, poster, or both.");
  if (options.tier && !new Set(["initial", "later", "review"]).has(options.tier)) throw new Error("--tier must be initial, later, or review.");
  return options;
}

export const RENDERER_HELP = `Nuvio people artwork renderer

Selection (combine explicit keys; seed and tier are optional):
  --stable-key person:123       Repeat for a bounded list
  --stable-key-file <path>      JSON array or newline-delimited stable keys
  --seed <path>                 Actor or director seed JSON
  --tier initial|later|review   Filter the selected seed

Rendering:
  --format landscape|poster|both  Default: both
  --output-dir <path>              Required unless --dry-run
  --source-cache <path>            Exact-profile cache with index.json
  --font-dir <path>                Optional approved ignored font cache
  --offline                         Default; never makes a request
  --allow-network                   Acquire only the resolved exact TMDB CDN path
  --dry-run                         Resolve and report without writes or acquisition

Examples:
  npm --prefix tools/people-seed run render-people-offline -- --stable-key person:3894 --format both --output-dir .work/example --source-cache .work/people-source-cache
  npm --prefix tools/people-seed run render-people-offline -- --seed data/people/actors-seed.json --tier initial --stable-key-file tools/people-seed/.work/keys.json --output-dir tools/people-seed/.work/example --source-cache tools/people-seed/.work/people-source-cache
`;

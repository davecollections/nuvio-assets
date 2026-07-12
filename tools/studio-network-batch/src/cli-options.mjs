function takeValue(argv, index, name) {
  const argument = argv[index];
  const inline = argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : null;
  if (inline !== null) return { value: inline, consumed: 0 };
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return { value, consumed: 1 };
}

function parseIds(value, name) {
  if (!value.trim()) throw new Error(`${name} requires at least one ID.`);
  return value.split(",").map((part) => {
    const id = Number(part.trim());
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${name} contains invalid ID: ${part}`);
    return id;
  });
}

export function parseCliOptions(argv) {
  const options = {
    json: false,
    all: false,
    proofOfConcept: false,
    newRecords: false,
    changedRecords: false,
    includeIneligible: false,
    force: false,
    dryRun: false,
    refreshLogoCache: false,
    companyIds: [],
    networkIds: [],
  };
  const valueNames = new Set(["--source-dir", "--company-ids", "--network-ids", "--ids-file", "--manifest", "--preset"]);
  const flagNames = new Map([
    ["--json", "json"], ["--all", "all"], ["--proof-of-concept", "proofOfConcept"],
    ["--new", "newRecords"], ["--changed", "changedRecords"],
    ["--include-ineligible", "includeIneligible"], ["--force", "force"], ["--dry-run", "dryRun"],
    ["--refresh-logo-cache", "refreshLogoCache"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const valueName = [...valueNames].find((name) => argument === name || argument.startsWith(`${name}=`));
    if (valueName) {
      const { value, consumed } = takeValue(argv, index, valueName);
      index += consumed;
      if (valueName === "--company-ids") options.companyIds.push(...parseIds(value, valueName));
      else if (valueName === "--network-ids") options.networkIds.push(...parseIds(value, valueName));
      else options[valueName.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      continue;
    }
    const flag = flagNames.get(argument);
    if (flag) options[flag] = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export function determinePlanMode(options) {
  const explicit = options.companyIds.length || options.networkIds.length || options.idsFile;
  const modes = [
    options.all && "all",
    explicit && "explicit",
    options.proofOfConcept && "proof-of-concept",
    options.newRecords && "new",
    options.changedRecords && "changed",
  ].filter(Boolean);
  if (modes.length === 0) throw new Error("Choose a selection mode: --all, IDs, --proof-of-concept, --new, or --changed.");
  if (modes.length > 1) throw new Error(`Conflicting selection modes: ${modes.join(", ")}.`);
  return modes[0];
}

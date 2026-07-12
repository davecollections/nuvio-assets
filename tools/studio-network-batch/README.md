# Nuvio studio/network batch utility

This isolated Node.js utility audits TMDB company and TV-network source caches and creates deterministic artwork-selection plans. It is separate from Nuvio's Collection Builder: it plans landscape collection artwork keyed by TMDB entity IDs, while the Collection Builder has a different responsibility.

Image generation is intentionally **not implemented in this stage**. The utility does not download logos, call the TMDB API, render images, build contact sheets, or create the production manifest. Sharp is not installed; it is planned for the next implementation stage.

## Source data and eligibility

The authoritative inputs are read directly from a neighbouring `tmdb-id-lookup` checkout:

- `data/companies.min.json`
- `data/tv-networks.min.json`

Compact JSON is used because it is the repository's authoritative cache, preserves typed fields, and avoids a lossy or duplicated CSV export. The compact keys map as follows: `i` TMDB ID, `n` name, `p` parent company (companies only), `c` origin country, `h` headquarters, `l` relative TMDB logo path, and `t` title count. Optional fields may be omitted; in the source cache an omitted `t` is its compact representation of zero and is normalised accordingly. A supplied title count must still be a non-negative integer.

An entity is eligible when `titleCount >= 100`. Counts are always calculated from current source data; they are never hardcoded.

Source-directory resolution uses this priority:

1. `--source-dir <path>`
2. `TMDB_ID_LOOKUP_DIR`
3. a sibling `tmdb-id-lookup` directory beside the current `nuvio-assets` checkout

The caches are never copied into this repository.

## Package layout

```text
tools/studio-network-batch/
  package.json
  README.md
  presets/
    poc-v1.json
    proof-of-concept-ids.json
  schemas/
    manifest-entry.schema.json
  src/
  tests/
```

Temporary future work belongs under the ignored `.work/` tree:

```text
.work/
  cache/
  staging/
  contact-sheets/
  reports/
```

The utility does not create these directories during planning. `node_modules/` is also ignored locally, but `package-lock.json` is deliberately not ignored.

## Commands

Run commands from `tools/studio-network-batch`.

```powershell
npm test
npm run audit
npm run audit -- --json
npm run audit -- --source-dir C:\path\to\tmdb-id-lookup
```

The audit reports companies, networks, and combined totals: total and eligible records, exactly-100 records, eligible records with and without logos, duplicate eligible exact-logo groups, duplicate eligible normalised-name groups, and validation errors. `--json` writes the full result to standard output only.

Planning requires an explicit selection mode; omitting one never defaults to all records:

```powershell
npm run plan -- --all
npm run plan -- --company-ids 33,174,41077
npm run plan -- --network-ids 18,66,118
npm run plan -- --company-ids 33,174 --network-ids 18,66
npm run plan -- --ids-file path\to\ids.json
npm run plan -- --proof-of-concept
npm run plan -- --new
npm run plan -- --new --manifest path\to\manifest.json
npm run plan -- --changed --manifest path\to\manifest.json
```

ID files are JSON arrays of stable keys such as `"company:33"` and `"network:18"`. Unknown, malformed, missing, and currently ineligible selections are reported separately. Explicitly selected records below the threshold are excluded unless `--include-ineligible` is deliberately supplied. Company and network ID lists may be combined; other selection modes conflict by design. Output order is always company then network, with numeric TMDB ID ordering inside each type.

`--new` selects eligible records missing from a supplied future canonical manifest. With no manifest, all eligible records are treated as new and the plan states this explicitly. `--changed` requires a manifest baseline and compares artwork inputs, renderer and preset versions, expected output path, and—when a manifest entry says it was generated—output existence, byte count, and file hash. Source-logo and normalised-pixel hashes remain future rendering-stage inputs.

`--force` marks selected entries for unconditional regeneration by the future generator but does not broaden the selection. `--dry-run` is accepted as the shared future option; planning itself is always non-rendering. Add `--json` to any plan command for machine-readable standard output.

## Fingerprints and refresh behaviour

The source-record hash includes entity type, TMDB ID, name, title count, and logo path for audit/history. The separate artwork-input hash includes identity, logo path, fallback name only when text fallback is needed, renderer version, and preset version. Therefore a title count moving from 200 to 201 changes source history but does not by itself refresh artwork while the entity remains eligible.

The committed proof-of-concept file contains only stable keys. Names, counts, and logo paths are resolved and validated from the current source caches every run; a missing or ineligible configured record is reported without substitution.

## Future artwork and manifest policy

Every TMDB ID receives its own final output path, even when several entities share the same source logo:

```text
assets/collection_covers/companies/{tmdb_id}.webp
assets/collection_covers/networks/{tmdb_id}.webp
```

Duplicate source-logo processing may later be reused internally, but final assets are not aliases and are not collapsed into a shared physical file.

`presets/poc-v1.json` records provisional 1200×675, 16:9 settings: maximum visible logo width 72%, maximum visible logo height 48%, dark background `#08141C`, light background `#E4E7E9`, WebP quality 86, and WebP output. They are proof-of-concept candidates, not final production values. `schemas/manifest-entry.schema.json` is a draft for the future manifest; no production manifest exists yet.

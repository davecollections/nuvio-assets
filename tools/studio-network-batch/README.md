# Nuvio studio/network batch utility

This isolated Node.js utility audits TMDB company and TV-network source caches, creates deterministic selections, and stages 16:9 collection artwork for review. It is separate from Nuvio's Collection Builder: it handles artwork keyed by TMDB entity IDs, while the Collection Builder has a different responsibility.

The renderer uses Sharp and the TMDB image CDN only. It does not call the TMDB search/detail API and does not publish into the final asset folders or create the production manifest.

## Continuity

Before resuming implementation or generation work, read:

- [Repository operating instructions](../../AGENTS.md)
- [Current project status](PROJECT_STATUS.md)

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
    production-v1.json
    proof-of-concept-ids.json
  schemas/
    manifest-entry.schema.json
  src/
  tests/
```

All downloads, state, generated covers, reports, and contact sheets remain under the ignored `.work/` tree:

```text
.work/
  cache/logos/
  staging/production-v1/
    companies/
    networks/
  contact-sheets/production-v1/
    companies/
    networks/
    combined/
  reports/production-v1/
```

Planning and generation dry-runs do not create these directories. `node_modules/` is ignored locally, but `package-lock.json` is deliberately tracked.

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

`--force` marks selected entries for unconditional regeneration and does not broaden the selection. `--dry-run` is shared with generation; planning itself is always non-rendering. Add `--json` to any plan command for machine-readable standard output.

Generation reuses the same explicit selection modes:

```powershell
npm run generate -- --proof-of-concept
npm run generate -- --company-ids 33,174
npm run generate -- --network-ids 18,66
npm run generate -- --company-ids 33 --network-ids 18
npm run generate -- --ids-file path\to\ids.json
npm run generate -- --new --manifest path\to\manifest.json
npm run generate -- --changed --manifest path\to\manifest.json
npm run generate -- --all
npm run generate -- --all --preset production-v1
```

`--all` must always be explicit. Additional controls are `--dry-run`, `--force`, `--include-ineligible`, `--refresh-logo-cache`, `--source-dir`, `--preset`, and `--json`. `production-v1` is the default outside proof-of-concept mode; proof-of-concept mode continues to default to `poc-v1`. `--refresh-logo-cache` refetches only distinct logo paths in the current selection. `--force` regenerates selected staged covers without deleting cache content. The proof-of-concept mode also creates the three controlled variants for its six configured difficult-logo records and builds both contact sheets.

Before any production missing-logo render, verify the local Sharp/libvips/Pango font path:

```powershell
npm run font-check
```

The command checks both `C:\Windows\Fonts` and the current user's local Windows Fonts directory, compares a deterministic requested-family render with a fallback-only render, and writes an ignored diagnostic PNG and JSON report under `.work/font-diagnostics/`. It does not download or install fonts.

## Download, analysis, and rendering

Logo URLs are constructed as `https://image.tmdb.org/t/p/original{logo_path}`. The cache filename is a SHA-256 key of that full URL plus a safe source extension. Downloads use Node's built-in `fetch`, a utility user agent, a timeout, and bounded transient retries. A successful response must be non-empty, image-typed when a content type is present, and decodable by Sharp. Cache writes and completed cover/report writes use temporary files followed by rename.

Each source is rotated for EXIF orientation, converted to sRGB, given an alpha channel, and decoded to raw RGBA. Pixels with alpha at least 8 are visible. The analysis records their exact bounding rectangle, transparent padding, alpha coverage, source and visible dimensions, visible-pixel count, source hash, and normalised RGBA hash. The extracted rectangle retains internal transparent holes.

For each candidate background, every visible pixel is composited against that background and assigned its WCAG-style relative-luminance contrast ratio. Ratios are alpha-weighted. The robust score combines the lower 10th percentile, median, and weighted proportions meeting 3:1 and 4.5:1. The higher score wins deterministically. Low best scores or differences below the versioned confidence threshold are marked `needs-review`; no outlines, shadows, or recolouring are added.

The visible rectangle is fitted with `min(maximumWidth / visibleWidth, maximumHeight / visibleHeight)`, resized with Lanczos, and centred on its visible geometry. The primary preset uses 864×324 maximum visible bounds on a 1200×675 canvas. Enlargement above 2× and low-resolution or unexpectedly opaque sources are review flags. Flat backgrounds are primary; the configured subtle gradients are used only by the gradient comparison variant.

Missing logo paths produce a centred text fallback using the current source name. `production-v1` requests the exact `Inter` family and requires the font check to confirm both a discovered Inter font and a renderer result distinct from the fallback-only comparison. Production rendering stops before writing work files when Inter cannot be confirmed; it never silently falls through to Segoe UI or Arial. Non-production and test presets retain the configurable `Inter, Segoe UI, Arial, Helvetica, sans-serif` stack. Text starts on one line, uses a balanced word-boundary wrap of no more than two lines when necessary, and reduces in size inside the central safe region. Every fallback records its background, font family, font size, line count, and wrapped lines, and has `status: missing-logo` and `reviewStatus: needs-review`.

Every WebP is decoded after writing and must be exactly 1200×675, WebP, and non-empty. The staged file hash and byte count are recorded.

## Fingerprints, state, and refresh behaviour

The source-record hash includes entity type, TMDB ID, name, title count, and logo path for audit/history. The separate artwork-input hash includes identity, logo path, fallback name only when text fallback is needed, renderer version, and preset version. Therefore a title count moving from 200 to 201 changes source history but does not by itself refresh artwork while the entity remains eligible.

The committed proof-of-concept file contains only stable keys. Names, counts, and logo paths are resolved and validated from the current source caches every run; a missing or ineligible configured record is reported without substitution.

Ignored run-state is maintained per stable key and variant. An output is skipped only when identity, logo/fallback input, source hash, artwork-input hash, renderer and preset versions, output path, output hash, dimensions, format, and decode validation all match. Title-count-only changes do not regenerate eligible artwork; a logo-path change, corrupt/missing output, renderer/preset change, or `--force` does.

Exact duplicate logo paths reuse one download and one analysis in a run. Identical rendering inputs may also reuse the rendered WebP buffer, but each entity still receives a separate ID-named staged file. Production reports include `run-summary.json`, `entities.jsonl`, readable generation and status-grouped Markdown summaries, `review-priority.json`, status groups, a contact-sheet index, per-run crash-recovery JSON Lines, source-file hashes, Node/Sharp/libvips/WebP versions, reuse counters, review flags, background splits, failures, and output-size statistics. Production runs create deterministic 8×8 paged contact sheets for companies, networks, and the combined review set.

## Review and publish preparation

Build focused review sheets and a pending hash-bound review draft from the existing staged outputs and reports without running generation:

```powershell
npm run review-prep -- --preset production-v1
```

This reads the persistent current run state, so a selective rerun does not hide unchanged outputs from review. It writes ignored reason-specific 8×8 sheets and their Markdown/JSON index under `.work/contact-sheets/production-v1/review/`, plus `review-state-draft.json`, `review-checklist.csv`, and (when Inter is unconfirmed) `fallback-ids.json` under `.work/reviews/production-v1/`. Every pending draft entry is checked against the current staged file hash. The command refuses report outputs outside ignored staging and performs no final-asset or canonical-manifest writes.

`schemas/review-state.schema.json` defines the future human review-state file. Approved entries bind a stable key and publish target to the exact reviewed output hash. `src/publish-plan.mjs` can validate those approvals against the staged file and build an in-memory dry publish plan; it performs no copy and writes no canonical manifest. A later publish command may consume that plan only after explicit approval, copy verified files to `assets/collection_covers/companies/{id}.webp` or `assets/collection_covers/networks/{id}.webp`, and then create the canonical published manifest. Stage three does none of those actions.

## Future artwork and manifest policy

Every TMDB ID receives its own final output path, even when several entities share the same source logo:

```text
assets/collection_covers/companies/{tmdb_id}.webp
assets/collection_covers/networks/{tmdb_id}.webp
```

Duplicate source-logo processing is reused internally, but final identities are not aliases and are not collapsed into a shared physical file.

`presets/poc-v1.json` remains the proof-of-concept configuration. `presets/production-v1.json` is the approved first full-staging preset: 1200×675, flat `#08141C`/`#E4E7E9` automatic backgrounds, alpha threshold 8, 72%×48% visible-logo safe box, and quality-86 WebP. `schemas/manifest-entry.schema.json` and `schemas/review-state.schema.json` are drafts for later stages; no production manifest or approval file is created by this utility stage.

# Nuvio studio/network batch utility

This isolated Node.js utility audits TMDB company and TV-network source caches, creates deterministic selections, and stages 16:9 collection artwork for review and controlled publication maintenance. It is separate from Nuvio's Collection Builder: it handles artwork keyed by TMDB entity IDs, while the Collection Builder has a different responsibility.

The renderer uses Sharp with cached TMDB artwork and narrowly configured owner-approved source treatments. Routine generation does not call the TMDB search/detail API and continues to write only to ignored staging; final asset and manifest writes require a separate, explicitly authorised, validation-first publication transaction.

## Continuity

Before resuming implementation or generation work, read:

- [Repository operating instructions](../../AGENTS.md)
- [Current project status](PROJECT_STATUS.md)

## Source data and eligibility

The authoritative inputs are read directly from a neighbouring `tmdb-id-lookup` checkout:

- `data/companies.min.json`
- `data/tv-networks.min.json`

Compact JSON is used because it is the repository's authoritative cache, preserves typed fields, and avoids a lossy or duplicated CSV export. The compact keys map as follows: `i` TMDB ID, `n` name, `p` parent company (companies only), `c` origin country, `h` headquarters, `l` relative TMDB logo path, and `t` title count. Optional fields may be omitted; in the source cache an omitted `t` is its compact representation of zero and is normalised accordingly. A supplied title count must still be a non-negative integer.

Automatic eligibility uses independent production thresholds loaded from `config/eligibility.json`: companies require `titleCount >= 50`, and networks require `titleCount >= 50`. Counts are always calculated from current source data; they are never hardcoded. `--company-min-titles` and `--network-min-titles` can override the policy for a one-off audit or plan without changing the committed defaults.

Planning and reporting classify records into four inclusion tiers:

- `core`: `titleCount >= 100`;
- `expanded-threshold`: automatically eligible at the configured threshold but below 100;
- `curated-exception`: a future owner-approved below-threshold stable key;
- `explicit`: processed below threshold only through an explicit ID request with `--include-ineligible`.

No curated exceptions are configured by this stage.

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
  config/
    eligibility.json
    background-decisions.json
    background-review-resolutions.json
    review-reason-resolutions.json
    review-state.json
    source-treatments.json
    recognisability-seed.json
  schemas/
    manifest-entry.schema.json
    review-state.schema.json
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

The audit reports companies, networks, and combined totals using the same shared eligibility resolver as planning and generation: total and eligible records, exactly-100 records, eligible records with and without logos, duplicate eligible exact-logo groups, duplicate eligible normalised-name groups, and validation errors. `--json` writes the full result to standard output only.

Planning requires an explicit selection mode; omitting one never defaults to all records:

```powershell
npm run plan -- --all
npm run plan -- --company-ids 33,174,41077
npm run plan -- --network-ids 18,66,118
npm run plan -- --company-ids 33,174 --network-ids 18,66
npm run plan -- --ids-file path\to\ids.json
npm run plan -- --proof-of-concept
npm run plan -- --new
npm run plan -- --new-from-state --preset production-v1
npm run plan -- --new --manifest path\to\manifest.json
npm run plan -- --changed --manifest path\to\manifest.json
```

ID files are JSON arrays of stable keys such as `"company:33"` and `"network:18"`. Unknown, malformed, missing, and currently ineligible selections are reported separately. Explicitly selected records below the threshold are excluded unless `--include-ineligible` is deliberately supplied. Company and network ID lists may be combined; other selection modes conflict by design. Output order is always company then network, with numeric TMDB ID ordering inside each type.

`--new` selects eligible records missing from a supplied future canonical manifest. With no manifest, all eligible records are treated as new and the plan states this explicitly. `--new-from-state` instead compares current eligibility with `.work/reports/{preset}/run-state.json`, selects only stable keys absent from persistent production state, validates existing staged outputs, and reports changed logo paths, changed cached source hashes, disappeared records, and records now below automatic eligibility separately. It never widens to all records. `--changed` requires a manifest baseline and compares artwork inputs, renderer and preset versions, expected output path, and—when a manifest entry says it was generated—output existence, byte count, and file hash.

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

`--all` must always be explicit. Additional controls are `--dry-run`, `--force`, `--offline`, `--include-ineligible`, `--refresh-logo-cache`, `--source-dir`, `--preset`, `--company-min-titles`, `--network-min-titles`, and `--json`. `production-v1` is the default outside proof-of-concept mode; proof-of-concept mode continues to default to `poc-v1`. `--offline` permits valid cache reads but fails a selected record with `offline_cache_miss` instead of making a CDN request. It cannot refresh cache content. `--refresh-logo-cache` refetches only distinct logo paths in the current selection. `--force` regenerates selected staged covers without deleting cache content. The proof-of-concept mode also creates the three controlled variants for its six configured difficult-logo records and builds both contact sheets.

Before any production missing-logo render, verify the local Sharp/libvips/Pango font path:

```powershell
npm run font-check
```

The command checks both `C:\Windows\Fonts` and the current user's local Windows Fonts directory, compares a deterministic requested-family render with a fallback-only render, and writes an ignored diagnostic PNG and JSON report under `.work/font-diagnostics/`. It does not download or install fonts.

## Download, analysis, and rendering

Logo URLs are constructed as `https://image.tmdb.org/t/p/original{logo_path}`. The cache filename is a SHA-256 key of that full URL plus a safe source extension. Downloads use Node's built-in `fetch`, a utility user agent, a timeout, and bounded transient retries. A successful response must be non-empty, image-typed when a content type is present, and decodable by Sharp. Cache writes and completed cover/report writes use temporary files followed by rename.

Each source is rotated for EXIF orientation, converted to sRGB, given an alpha channel, and decoded to raw RGBA. Pixels with alpha at least 8 are visible. The analysis records their exact bounding rectangle, transparent padding, alpha coverage, source and visible dimensions, visible-pixel count, source hash, and normalised RGBA hash. The extracted rectangle retains internal transparent holes.

For each candidate background, every visible pixel is composited against that background and assigned its WCAG-style relative-luminance contrast ratio. Ratios are alpha-weighted. The robust score combines the lower 10th percentile, median, and weighted proportions meeting 3:1 and 4.5:1. The higher score is the existing deterministic aggregate choice. Low best scores or differences below the versioned confidence threshold are marked `needs-review`; no outlines, shadows, or recolouring are added.

Production then applies `hybrid-dark-component-v1`. It preserves the aggregate calculation while adding deterministic lower-tail and low-contrast-share guards for mixed marks whose dark wording is lost on the dark background. Decision precedence is: an exact source-hash-matching manual decision, an automatic hybrid switch, then the existing aggregate choice. Records store `manual-hash-bound`, `hybrid-dark-component-v1`, or `existing-aggregate` as the decision source. The rule does not alter trimming, placement, safe-box sizing, dimensions, quality, colour, outlines, or shadows.

Manual decisions live in `config/background-decisions.json` and are validated for stable-key order, duplicate keys, background values, and 64-character source hashes. A changed source-logo hash invalidates the manual choice, returns the logo to automatic analysis, and adds `stale-background-decision`; the old staged file is not deleted. `config/background-review-resolutions.json` records reason-level completion of source-hash-bound background reviews without approving unrelated cover concerns. `config/review-reason-resolutions.json` stores other owner-approved review reasons in deterministic groups bound to exact output hashes and, for source-sensitive reasons, exact source-logo hashes. A changed binding leaves the original reason pending. Resolved flags remain present as production metadata, and another independent reason keeps the cover in `needs-review`.

Owner-approved source treatments live in `config/source-treatments.json`. Supported treatments are a tracked verified manual source, an exact deterministic crop of the bound TMDB source, and an owner-approved Inter text treatment. Every entry binds the stable key, canonical name, current TMDB logo path, original TMDB source hash, selected dark/light background, and a deterministic treatment hash. Manual and cropped artwork also bind the selected source hash and provenance; tracked official inputs and their rights notes live under `manual-sources/`. A changed canonical name, TMDB logo path, original source hash, manual-source hash, crop result, or treatment configuration stops reuse and requires artwork regeneration or renewed owner review. TMDB history remains recorded in persistent state.

An owner-approved text treatment uses the production Inter fallback layout rules but is recorded as `renderStatus: owner-approved-text`, not `missing-logo`; it does not acquire `missing-logo-text-fallback`. Reports count image/logo-backed, missing-logo, and owner-approved text outputs separately. Source-treatment verification accepts the hash-bound treatment decision without requiring an unrelated mixed-contrast resolution, while generic review-reason resolutions remain bound to the exact resulting output and source-or-treatment hash.

The visible rectangle is fitted with `min(maximumWidth / visibleWidth, maximumHeight / visibleHeight)`, resized with Lanczos, and centred on its visible geometry. The primary preset uses 864×324 maximum visible bounds on a 1200×675 canvas. Enlargement above 2× and low-resolution or unexpectedly opaque sources are review flags. Flat backgrounds are primary; the configured subtle gradients are used only by the gradient comparison variant.

Missing logo paths produce a centred text fallback using the current source name. `production-v1` requests the exact `Inter` family and requires the font check to confirm both a discovered Inter font and a renderer result distinct from the fallback-only comparison. Production rendering stops before writing work files when Inter cannot be confirmed; it never silently falls through to Segoe UI or Arial. Non-production and test presets retain the configurable `Inter, Segoe UI, Arial, Helvetica, sans-serif` stack. Text starts on one line, uses a balanced word-boundary wrap of no more than two lines when necessary, and reduces in size inside the central safe region. Every fallback records its background, font family, font size, line count, wrapped lines, and `renderStatus: missing-logo`. It begins with the `missing-logo-text-fallback` review reason; an exact output-hash-bound owner resolution may clear that reason without removing the fallback metadata or approving another independent concern.

Every WebP is decoded after writing and must be exactly 1200×675, WebP, and non-empty. The staged file hash and byte count are recorded.

## Fingerprints, state, and refresh behaviour

The source-record hash includes entity type, TMDB ID, name, title count, and logo path for audit/history. The separate artwork-input hash includes identity, logo path, fallback name only when text fallback is needed, renderer version, and preset version. Therefore a title count moving from 200 to 201 changes source history but does not by itself refresh artwork while the entity remains eligible.

The committed proof-of-concept file contains only stable keys. Names, counts, and logo paths are resolved and validated from the current source caches every run; a missing or ineligible configured record is reported without substitution.

Ignored run-state is maintained per stable key and variant. An output is skipped only when identity, logo/fallback input, source hash, artwork-input hash, renderer and preset versions, selected background, output path, output hash, dimensions, format, and decode validation all match. A background-analysis or decision-version change with the same selected background can be reconciled after output validation without rewriting the image. Title-count-only changes do not regenerate eligible artwork; a changed selected background, logo-path change, corrupt/missing output, renderer/preset change, or `--force` does. Full reconciliation is state-scoped: a newly eligible source record absent from persistent state is reported as deferred drift rather than silently widening a selective task or generating a new cover.

Exact duplicate logo paths reuse one download and one analysis in a run. Identical rendering inputs may also reuse the rendered WebP buffer, but each entity still receives a separate ID-named staged file. An entity falling below the automatic threshold is reported as legacy state; its staged or published asset is never deleted automatically. Production reports include `run-summary.json`, `entities.jsonl`, readable generation and status-grouped Markdown summaries, `review-priority.json`, status groups, a contact-sheet index, per-run crash-recovery JSON Lines, source-file hashes, Node/Sharp/libvips/WebP versions, reuse counters, review flags, background splits, failures, and output-size statistics. Production runs create deterministic 8×8 paged contact sheets for companies, networks, and the combined review set.

## Eligibility-expansion audit

Build the ignored 50/50 threshold plans and human-readable audit reports without downloading logos or writing artwork:

```powershell
npm run threshold-audit
```

Plans are written under `.work/plans/eligibility-50/`; reports are written under `.work/reports/threshold-audit-50/`. The audit covers title-count bands, newly eligible records, missing logos, exact-logo reuse, persistent-state drift, storage/runtime estimates, and conservative recognisability candidates. `proposed-exceptions.json` is review material only and does not configure production exceptions.

The eligibility-50 expansion was completed on 2026-07-13 using the exact incremental plan. The historical command was:

```powershell
npm run generate -- --ids-file .work/plans/eligibility-50/new-all.json --preset production-v1
```

From the repository root, the equivalent command is `npm --prefix tools/studio-network-batch run generate -- --ids-file .work/plans/eligibility-50/new-all.json --preset production-v1`; the relative IDs-file path resolves from the package directory.

### Historical 2,365-record expansion checkpoint

Do not rerun that plan merely because it remains on disk. Immediately after the 2026-07-13 expansion, persistent state contained 2,365 records and one newly eligible record, `company:281730`, was deliberately deferred for a separate narrow `--new-from-state` plan. That describes the historical expansion checkpoint, not current state.

The one-key follow-up has since completed. Current persistent production state contains 2,366 records, including `company:281730` as `expanded-threshold`; no deferred newly eligible record remains.

## Review and publish preparation

Build focused review sheets and a pending hash-bound review draft from the existing staged outputs and reports without running generation:

```powershell
npm run review-prep -- --preset production-v1
```

This reads the persistent current run state, so a selective rerun does not hide unchanged outputs from review. It applies current exact-hash reason resolutions and source-hash-bound background resolutions in memory, preserving the persistent audit metadata while deriving the live review queue. It writes ignored reason-specific 8×8 sheets and their Markdown/JSON index under `.work/contact-sheets/production-v1/review/`, plus `review-state-draft.json`, `review-checklist.csv`, and (when Inter is unconfirmed) `fallback-ids.json` under `.work/reviews/production-v1/`. Every pending draft entry is checked against the current staged file hash. The command refuses report outputs outside ignored staging and performs no final-asset or canonical-manifest writes.

Prepare the current eligibility-50 visual-review package offline from cached logos, staged outputs, and persistent state:

```powershell
npm run review-focus
```

This command writes only below `.work/review-focus/eligibility-50/`. It resolves the named contrast candidates (including duplicate discovery+ identities), renders dark/light comparisons, creates resolution details and a representative fallback sheet, classifies newly opaque sources, and writes output-hash-bound action proposals. It snapshots staging content and modification times plus both production review hashes before and after, and aborts if any protected value changes. It never changes a production background decision or review approval.

Build the enlarged final owner-review package for every currently unresolved opaque-source reason:

```powershell
npm run opaque-review
```

This offline command reads only persistent production state, staged covers, and cached source logos. It excludes already resolved opaque reasons, orders current unresolved records by classification and stable identity, and writes deterministic 4×4 pages plus `index.md`, `index.json`, `summary.md`, `summary.json`, and a blank output-hash-bound `review-template.csv` below `.work/review-focus/opaque-final/`. Each tile includes the current cover, complete-source inset, identity, background, classification, source and visible dimensions, area estimates, edge/background description, and other unresolved reasons. The command snapshots staging content, staging mtimes, and both review files before and after and aborts if any protected value changes. It performs no network, production-artwork, review-state, final-asset, or canonical-manifest write.

The 153-record package was owner-reviewed on 2026-07-15. The first pass resolved 146 `unexpectedly-opaque-source-background` reasons and isolated seven `needs-better-source` records. A later owner-approved source-treatment pass regenerated exactly those seven offline: three tracked official sources, one deterministic TMDB-source crop, and three exact-name Inter treatments. All seven opaque reasons and the directly related low-resolution flag on the approved Les Films 13 source were exact output/source-or-treatment-hash resolved. At that checkpoint, full review preparation contained 237 pending records and 280 unresolved reasons. The source investigation remains under `.work/source-quality-seven/`; the applied seven-cover proof sheet is under `.work/source-quality-seven-apply/contact-sheets/`. Nothing was published.

A 2026-07-16 four-record owner follow-up then switched Shout! Factory, ITV Studios, and ORF III to exact source-hash-bound light backgrounds and applied a verified official Synthetic Cinema International source on dark. Exactly four covers were regenerated offline, five reasons were resolved, and 2,362 unrelated outputs and every unrelated review record remained unchanged. The resulting 233-record / 275-reason queue was a historical checkpoint before the final owner approval pass.

The final owner approval pass applied exactly 154 `approve-reason-as-is` rows and 121 `retain-current-background` rows across those 233 records. The four previously completed exception keys were not reprocessed. Full review preparation now produces zero pending records and zero unresolved reasons while the unchanged persistent state retains the original flags as audit history.

`schemas/review-state.schema.json` defines the durable exact-output approval model, and `config/review-state.json` contains one approved record for each of the 2,366 staged covers. Each record binds identity, canonical name, publish target, output hash, byte count, 1200×675 WebP metadata, approval source, and reviewed date. `src/publish-plan.mjs` validates those approvals against the staged files and builds an in-memory dry publish plan; the completed validation fully decoded all 2,366 covers and produced 2,366 entries with zero issues and zero writes. A later publish command may consume that plan only after explicit approval, copy verified files to `assets/collection_covers/companies/{id}.webp` or `assets/collection_covers/networks/{id}.webp`, and then create the canonical published manifest. This approval phase did none of those actions.

Superseded ignored review/contact-sheet cleanup is not implemented. `review-prep` atomically overwrites pages in the current index but does not prune no-longer-referenced page files when pagination shrinks, and the current publish-plan module has no cleanup phase. Historical evidence may intentionally remain; a future publication workflow must define explicit retention and pruning rules rather than deleting `.work` broadly.

The completed mixed-contrast owner review contains 12 light choices and 8 dark choices. Exactly the 12 dark-to-light covers were regenerated offline; the eight retained-dark covers and the other 1,055 staged outputs kept their hashes and modification times. The full 1,075-record persistent state, production reports, focused review hashes, and contact sheets were then reconciled. The focused final sheet is `.work/contact-sheets/production-v1/review/mixed-contrast-approved.png`, with its machine-readable summary under `.work/reviews/production-v1/`. Nothing from this review has been published.

The reconciliation workflow is deliberately separate from generation:

```powershell
npm run reconcile-production -- snapshot --output .work/plans/mixed-contrast-approved/before-staging.json
npm run generate -- --ids-file .work/plans/mixed-contrast-approved/light-switches.json --preset production-v1 --force --offline
npm run reconcile-production -- reconcile --before-snapshot .work/plans/mixed-contrast-approved/before-staging.json --changed-ids .work/plans/mixed-contrast-approved/light-switches.json --retained-ids .work/plans/mixed-contrast-approved/approved-dark-retained.json --after-snapshot .work/plans/mixed-contrast-approved/after-staging.json --summary .work/reviews/production-v1/mixed-contrast-approved-summary.json
```

For a genuinely absent-before production addition, use `--added-ids` instead of `--changed-ids`. The verifier requires the path to be absent from the before snapshot and present afterward, keeps the background-review resolution requirement limited to changed/retained background decisions, validates configured source treatments through their treatment metadata, and reports old paths separately from new additions.

The eligibility-50 owner decisions were applied on 2026-07-14. Exactly five light-switch covers were regenerated offline; four reviewed-current covers and 2,356 unrelated outputs remained byte-for-byte and timestamp unchanged. The separately deferred `company:281730` was then generated through an exact one-key plan and reconciled as the sole absent-before addition. The final seven source-quality decisions were applied on 2026-07-15 with exactly seven offline regenerations and 2,359 unchanged outputs. The four-exception owner follow-up then regenerated exactly four covers and retained 2,362 unrelated outputs. The final review pass changed no artwork: the current full state contains 2,366 valid 1200×675 WebPs, zero live pending review entries, zero unresolved reasons, and 2,366 exact-hash cover approvals. That exact approved state was subsequently published in release `studio-network-v1-2026-07-16`.

## Published library and maintenance

Release `studio-network-v1-2026-07-16` was published at `2026-07-16T02:17:14.289Z` in asset commit `a5344e311195bb2d06fa9929669c7f56ad121c2a`:

- 1,797 company covers under `assets/collection_covers/companies/{tmdb_id}.webp`;
- 569 network covers under `assets/collection_covers/networks/{tmdb_id}.webp`;
- 2,366 entries in `assets/collection_covers/manifest.json`;
- manifest SHA-256 `4aff260b404dc6f7fecf63fdaf7de09a3bc87f3af9871e0b83109e2e2e20e312` and byte count 5,438,312;
- published asset fingerprint `48eff273e92778f1a20801dad7160e05a659c211c5f942d2a35c6b97f055c508` over 26,589,254 WebP bytes.

The publication copied exact approved staged bytes into a temporary release tree, fully validated that tree, installed and fully validated every permanent cover, and only then atomically installed the canonical manifest. Final contact sheets were generated from the installed manifest and permanent files. Release evidence is retained under `.work/publication-release/studio-network-v1-2026-07-16/`.

Routine maintenance is incremental:

1. load the current sibling `tmdb-id-lookup` caches and audit eligibility with the committed 50/50 thresholds;
2. plan newly eligible records with `--new-from-state` and artwork-input changes against `assets/collection_covers/manifest.json` separately;
3. stage only the resulting stable keys, preferably offline when their approved source cache is available;
4. rebuild focused review, resolve every reason, and create new exact-output approvals for changed or added covers;
5. publish only that reviewed delta through a separately authorised transaction that preserves one physical file per TMDB ID and atomically updates the manifest after permanent verification.

Do not use `--all` for routine maintenance. A title-count-only movement does not regenerate artwork while the record remains eligible. Falling below the automatic threshold or disappearing from current source data never authorises automatic deletion of staged or published artwork; preserve it as legacy state until a later explicit owner decision.

## Published artwork and manifest policy

Every TMDB ID receives its own final output path, even when several entities share the same source logo:

```text
assets/collection_covers/companies/{tmdb_id}.webp
assets/collection_covers/networks/{tmdb_id}.webp
```

Duplicate source-logo processing is reused internally, but final identities are not aliases and are not collapsed into a shared physical file.

`presets/poc-v1.json` remains the proof-of-concept configuration. `presets/production-v1.json` is the approved first full-staging preset: 1200×675, flat `#08141C`/`#E4E7E9` automatic backgrounds, alpha threshold 8, 72%×48% visible-logo safe box, and quality-86 WebP. `schemas/manifest-entry.schema.json` defines the validated entry shape used by the canonical manifest. `schemas/review-state.schema.json` and `config/review-state.json` remain the durable exact-output approval contract and state; publication consumes them but does not alter them.

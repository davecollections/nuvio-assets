# Studio/network batch project status

**Last verified:** 2026-07-12 20:28 AEST (UTC+10)

**Verified against commit:** `41db5b4` (`feat: add full studio and network staging workflow`)

**Working tree state:** Not clean. It contains uncommitted Inter font-check enforcement, review-preparation and contact-sheet work, related tests and README changes, plus the continuity documentation added in this task. Preserve and inspect these changes before editing.

This file is a dated project snapshot. Recheck the repository and ignored `.work` data before updating it.

## Current phase

The following stages are complete and present locally:

- utility scaffold, compact-source ingestion, audit, planning, selection, caching, rendering, validation, and resumability;
- proof-of-concept generation under `.work/staging/poc-v1` (47 primary/variant WebP files currently present);
- full `production-v1` staging;
- paged production contact sheets and reports;
- Inter availability checking and production fallback enforcement;
- selective Inter regeneration of all current missing-logo fallbacks;
- focused review preparation with hash-bound pending review records.

No publication stage has been performed.

## Latest verified source counts

Snapshot from the non-writing audit at 2026-07-12 20:28 AEST, using `titleCount >= 100`:

| Group | Eligible | With logo | Missing logo |
|---|---:|---:|---:|
| Companies | 751 | 606 | 145 |
| Networks | 324 | 323 | 1 |
| Combined | 1,075 | 929 | 146 |

The audit reported zero validation errors. These are dated source facts, not implementation constants.

## Latest staged-output state

- Preset: `production-v1`
- Location: `.work/staging/production-v1/`
- Staged WebP files: 1,075 (751 companies, 324 networks)
- Current failed state records: 0
- Current staged bytes: 12,174,408 total
- Current staged file size: 10,634-byte median; 2,258–38,120-byte range
- Final assets published: no

The persistent current state is `.work/reports/production-v1/run-state.json`. The top-level `entities.jsonl` describes the most recent selected run and may contain fewer records after a selective rerun.

## Inter status

- Inter is installed in the current user's local Windows Fonts directory.
- The latest local `font-check` report confirms Inter is available to Sharp/libvips/Pango.
- The requested Inter render hash differs from the fallback-only stack.
- Production fallback rendering is currently permitted.
- No font files are stored or committed in this repository.

Re-run `font-check` before any future production missing-logo render because this availability is machine-local.

## Fallback regeneration state

- Exactly 146 stable keys are listed in `.work/reviews/production-v1/fallback-ids.json`.
- All 146 were selectively regenerated with Inter in run `2026-07-12T10-15-33-781Z`.
- That run generated 146 fallbacks, zero logo covers, and zero failures.
- Selective-run output size was 1,390,902 bytes total, with a 9,829-byte median and a 3,704–16,060-byte range.
- Review preparation was rebuilt afterward.
- The current 266-entry review draft has zero missing staged files and zero hash mismatches.
- All 146 fallback review entries bind to the regenerated hashes; no stale fallback binding remains.

Fallback covers remain pending `missing-logo` / `needs-review`; none was approved automatically.

## Current review state

Latest focused review preparation contains 266 unique pending records across 14 sheets:

| Category | Records |
|---|---:|
| Missing logo | 146 |
| Unexpectedly opaque source | 77 |
| Close background score | 37 |
| Very-close contrast | 19 |
| Upscale over 2× | 6 |
| Likely low resolution | 2 |
| All needs review, deduplicated | 266 |

Flags overlap, so category counts do not sum to the unique total.

Relevant paths:

- `.work/contact-sheets/production-v1/review/index.md`
- `.work/contact-sheets/production-v1/review/index.json`
- `.work/reviews/production-v1/review-state-draft.json`
- `.work/reviews/production-v1/review-checklist.csv`
- `.work/reviews/production-v1/fallback-ids.json`

All draft entries are pending; no review status has been promoted to approval.

## Known visual issue

Some colourful logos contain black or dark-grey wordmarks. The aggregate contrast score can choose the dark background while the text portion becomes difficult to read. Contrast-floor or partial-logo-readability logic may need refinement.

Focused visual/metric triage identified these current candidates:

```text
company:6438   Muse Entertainment
company:7981   Pathé
company:10330  Universal International Pictures
company:11846  Hakuhodo DY Media Partners
network:461    ATV
network:3127   Aniworld TV
network:3732   WeTV
network:4353   discovery+
```

These candidates are not currently captured by the close-background or very-close-contrast groups. Test them as a selected set; do not alter individual staged files by hand.

## Current open decisions

- Whether and how to add a lower-tail or partial-logo contrast guard.
- Whether mixed-contrast candidates should use light backgrounds or another deterministic treatment.
- Human acceptance of all fallback typography.
- Disposition of unexpectedly opaque, high-upscale, and low-resolution sources.
- The approval-record workflow and who signs off reviewed hashes.
- Publication timing after all required review and selected reruns.

## Exact next step

Inspect the refreshed focused review sheets, starting with the eight mixed-contrast candidates above, and define a focused contrast-algorithm test. If the algorithm changes, regenerate only the affected stable keys and rebuild review preparation before seeking approval. Do not publish yet.

## Important commands

Run these examples from the repository root:

```powershell
npm --prefix tools/studio-network-batch test
npm --prefix tools/studio-network-batch run font-check
npm --prefix tools/studio-network-batch run audit
npm --prefix tools/studio-network-batch run generate -- --proof-of-concept
npm --prefix tools/studio-network-batch run generate -- --all --preset production-v1
npm --prefix tools/studio-network-batch run generate -- --ids-file .work/reviews/production-v1/fallback-ids.json --preset production-v1 --force
npm --prefix tools/studio-network-batch run review-prep -- --preset production-v1
```

`--all` is shown for reference, not as the default recovery action. Prefer the narrowest safe selection.

With `npm --prefix tools/studio-network-batch`, the command runs in `tools/studio-network-batch`. Relative CLI paths therefore resolve from that package directory. Use `.work/reviews/...` as shown; do not accidentally pass `tools/studio-network-batch/.work/reviews/...` and duplicate the package path.

## Publication state

Verified absent:

- `assets/collection_covers/companies/`
- `assets/collection_covers/networks/`
- canonical published studio/network manifest

The repository contains only the draft manifest schema, manifest implementation support, and test fixture. Those are not a published manifest.

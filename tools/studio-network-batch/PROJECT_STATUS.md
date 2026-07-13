# Studio/network batch project status

**Last verified:** 2026-07-13 18:25 AEST (UTC+10)

**Verified against commit:** `5be5183` (`docs: add batch project continuity guidance`)

**Working tree state:** Not clean. It contains the preserved mixed-contrast experiment plus the uncommitted production rule promotion, hash-bound owner decisions, offline selective-generation support, reconciliation/verification workflow, tests, and documentation. Preserve and inspect these changes before editing.

This file is a dated project snapshot. Recheck the repository and ignored `.work` data before updating it.

## Current phase

The following stages are complete and present locally:

- utility scaffold, compact-source ingestion, audit, planning, selection, caching, rendering, validation, and resumability;
- proof-of-concept generation under `.work/staging/poc-v1` (47 primary/variant WebP files currently present);
- full `production-v1` staging;
- paged production contact sheets and reports;
- Inter availability checking and production fallback enforcement;
- selective Inter regeneration of all current missing-logo fallbacks;
- focused review preparation with hash-bound pending review records;
- the isolated `mixed-contrast-v1` experiment, including an offline 929-logo scan, 8 candidate comparisons, 12 controls, and projected-change review;
- production promotion of `hybrid-dark-component-v1`, 17 hash-bound manual decisions, and reason-level resolution of the 20-record owner review;
- offline selective regeneration of exactly 12 dark-to-light covers followed by full-state metadata, report, contact-sheet, and review reconciliation.

No publication stage has been performed.

## Latest verified source counts

Snapshot from the non-writing audit at 2026-07-13, using `titleCount >= 100`:

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
- Current staged bytes: 12,178,372 total
- Current staged file size: 10,680-byte median; 2,258–38,120-byte range
- Background split: 487 dark; 588 light
- Combined staged content fingerprint: `f4e4d40a98baea30566113c2f9306537687a9031a3454e649627b54de9ad637d`
- Final assets published: no

The persistent current state is `.work/reports/production-v1/run-state.json`. The reconciled top-level `entities.jsonl` currently contains all 1,075 primary records.

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
- `.work/contact-sheets/production-v1/review/mixed-contrast-approved.png`
- `.work/reviews/production-v1/mixed-contrast-approved-summary.json`

All cover-level draft entries are pending; no cover has been promoted to publication approval. The background-choice reason is resolved for the 20 owner-reviewed records when the configured source hashes match. Independent reasons remain pending where applicable.

## Mixed-contrast experiment

The ignored `.work/experiments/mixed-contrast-v1/` experiment is complete. It used cached logos only, retained the production alpha threshold and colour-normalisation pipeline, rendered four variants for each focus record, tested aggregate, percentile, low-share, meaningful-alternative and hybrid rules, and scanned all 929 logo-bearing records without rerendering production staging.

The eight candidates were:

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

The 12-record control set covers obvious black and white marks, colourful symbols and wordmarks, detailed emblems, compact symbols and several proof-of-concept records. The production `hybrid-dark-component-v1` rule changes none of them.

Recommended automatic-switch guard for a dark-selected logo:

- 40–50% of alpha-weighted visible pixels below 3:1;
- dark p10 at most 1.2;
- light retains at least 40% at or above 3:1;
- light loses no more than 15 percentage points at 3:1;
- light aggregate score at least 1.8;
- light reduces the below-1.5 share by at least 20 percentage points;
- light p10 at least 1.16;
- source is not unexpectedly opaque.

Records that meet the broader component guard but not the severe-tail improvement remain review-only with light shown as the proposed comparison. A separate review-only branch captures a substantial near-3:1 grey component such as `network:4353` without recommending a harmful automatic flip.

Projected full-batch effect:

- 909 unchanged;
- 3 automatic dark-to-light switches (`company:6438`, `company:11846`, `network:3732`);
- 0 light-to-dark switches;
- 17 review-only records;
- 5 impacted records already in current `needs-review` state;
- 15 newly flagged records in total, comprising the 8 known candidates and 7 additional newly detected records;
- 0 overlap with the current close-background and very-close-contrast groups.

Candidate outcomes: three automatic light switches, four review-only light recommendations (`company:7981`, `company:10330`, `network:461`, `network:3127`), and one review-only current-dark result (`network:4353`). The stable-key list for all 20 projected switches or reviews is `.work/experiments/mixed-contrast-v1/reports/proposed-review-ids.json`.

Production staging remained at 1,075 files. Its combined content fingerprint and modification-time fingerprint were identical before and after the experiment. No production output, final asset, review approval, canonical manifest or source-cache repository was modified.

## Mixed-contrast production rollout

The owner approved 12 light outcomes and 8 dark outcomes for the current source-logo hashes. Production precedence is now:

1. matching hash-bound manual decision;
2. automatic `hybrid-dark-component-v1` switch;
3. existing aggregate selection.

The 17 manual decisions and all 20 reason-level resolutions are stored in `config/`. A stale source hash invalidates the decision or resolution, returns the record to automatic analysis, and adds `stale-background-decision`. The three automatic light switches are `company:6438`, `company:11846`, and `network:3732`; the other 17 decisions are manual.

Identity recovery corrected two transposed/truncated IDs in the handoff text by following the current source and completed experiment: Acar Film is `company:1385` (not `company:1355`) and BBC TV is `company:161115` (not `company:16115`). The handoff IDs point to different, ineligible source records and were never staged or modified.

Run `2026-07-13T07-58-18-555Z` selected only the 12 approved light-switch keys with `--force --offline`. It generated 12 light covers, made zero network requests, used 12 valid cached logo sources, and had zero download, decode, analysis, or render failures. It did not select or rerender any approved-dark record.

The full reconciled verification proves:

- before fingerprint: `a02f5bac1b390712b3379bf3de9f29126c12bacb82c5162fc7a03a4ffc247217`;
- after fingerprint: `f4e4d40a98baea30566113c2f9306537687a9031a3454e649627b54de9ad637d`;
- exactly 12 content hashes and modification times changed;
- all eight approved-dark outputs were retained byte-for-byte with their original modification times;
- the other 1,055 unrelated outputs were also retained;
- all 1,075 state records now store `backgroundDecisionVersion: hybrid-dark-component-v1`;
- 17 records use `manual-hash-bound`, 3 use the automatic rule, and no configured decision is stale;
- no unresolved mixed-contrast review reason remains for the 20 reviewed records;
- five reviewed records still have the independent `unexpectedly-opaque-source-background` reason.

Review preparation was rebuilt from the full persistent state: 1,075 report records, 266 unique needs-review records, 14 focused sheets, zero missing staged files, and zero report/output hash mismatches. The reason-group counts remain unchanged because the mixed-contrast experiment had not previously injected those reasons into production state.

## Current open decisions

- Human acceptance of all fallback typography.
- Disposition of unexpectedly opaque, high-upscale, and low-resolution sources.
- The approval-record workflow and who signs off reviewed hashes.
- Publication timing after all required review and selected reruns.

## Exact next step

Start the separate `titleCount >= 50` expansion as a new scoped phase: re-run recovery and tests, calculate the current 50–99 population from the source caches, update the eligibility configuration deliberately, and plan only newly eligible stable keys before any generation. Do not use `--all`, publish current staging, or treat this completed background rollout as authorization for the expansion.

## Important commands

Run these examples from the repository root:

```powershell
npm --prefix tools/studio-network-batch test
npm --prefix tools/studio-network-batch run font-check
npm --prefix tools/studio-network-batch run contrast-experiment -- --preset production-v1
npm --prefix tools/studio-network-batch run generate -- --ids-file .work/plans/mixed-contrast-approved/light-switches.json --preset production-v1 --force --offline
npm --prefix tools/studio-network-batch run reconcile-production -- reconcile --before-snapshot .work/plans/mixed-contrast-approved/before-staging.json --changed-ids .work/plans/mixed-contrast-approved/light-switches.json --retained-ids .work/plans/mixed-contrast-approved/approved-dark-retained.json --after-snapshot .work/plans/mixed-contrast-approved/after-staging.json --summary .work/reviews/production-v1/mixed-contrast-approved-summary.json
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

# Studio/network batch project status

**Last verified:** 2026-07-14 AEST (UTC+10)

**Verified through implementation commit:** `45dfb71` (`feat: apply eligibility-50 review decisions`)

**Tracked implementation state:** The focused-review tooling checkpoint is `1ac9ffc`; the owner decisions, hash-bound reason-resolution system, and reconciliation updates are in `45dfb71`. Ignored production/review artifacts remain under `.work/` and must not be added to Git.

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
- the eligibility-50 expansion: 1,290 exact new keys generated, full state reconciled to 2,365 covers, and all original 1,075 outputs retained unchanged;
- offline eligibility-50 focused-review preparation with contrast comparisons, resolution details, a representative fallback sample, deterministic opaque-source classification, and output-hash-bound action proposals;
- owner application of the eligibility-50 decisions: exactly five dark-to-light covers regenerated offline, four reviewed backgrounds retained byte-for-byte, 369 exact output-hash-bound generic reason resolutions applied, and all full reports/review sheets reconciled;
- a narrowed pending-opaque package containing exactly the 76 owner-deferred eligibility-50 problem cases.

No publication stage has been performed.

## Latest verified source counts

Current source-cache snapshot on 2026-07-14, using the approved company/network minimums of 50:

| Group | Eligible | With logo | Missing logo |
|---|---:|---:|---:|
| Companies | 1,797 | 1,320 | 477 |
| Networks | 569 | 568 | 1 |
| Combined | 2,366 | 1,888 | 478 |

The source contains one newly eligible record absent from the current production state: `company:281730` (Atresmedia Cine, title count 71). It was detected during reconciliation and deliberately deferred because it was outside the authorised five-cover selection. No validation error, removal, or rename was found. These are dated source facts, not implementation constants.

## Latest staged-output state

- Preset: `production-v1`
- Location: `.work/staging/production-v1/`
- Staged WebP files: 2,365 (1,796 companies, 569 networks)
- Current failed state records: 0
- Current staged bytes: 26,545,608 total
- Current staged file size: 10,450-byte median; 1,888–39,004-byte range
- Background split: 1,139 dark; 1,226 light
- Combined staged content fingerprint: `39fe140c6717b57a54155f287559689e7468e8664bf9ac82aad074f5fb28d566`
- Combined staged modification-time fingerprint: `10f6b74e54ffa2289ac21e17b1b18419a07f75ad5cdf4b06eabe9813034417cc`
- Final assets published: no

The persistent current state is `.work/reports/production-v1/run-state.json`. The reconciled top-level `entities.jsonl` contains all 2,365 primary records. The eligibility-50 expansion retained all 1,075 original outputs byte-for-byte with their modification times.

## Inter status

- Inter is installed in the current user's local Windows Fonts directory.
- The latest local `font-check` report confirms Inter is available to Sharp/libvips/Pango.
- The requested Inter render hash differs from the fallback-only stack.
- Production fallback rendering is currently permitted.
- No font files are stored or committed in this repository.

Re-run `font-check` before any future production missing-logo render because this availability is machine-local.

## Fallback regeneration state

- The original 146 fallback covers were selectively regenerated with Inter in run `2026-07-12T10-15-33-781Z`.
- The eligibility-50 expansion added 332 Inter fallbacks, bringing the current total to 478.
- Every current fallback retains Inter, a one- or two-line layout, and `renderStatus: missing-logo` metadata.
- The focused-review package samples 22 deterministic representatives spanning length, layout, accents, punctuation, institutional names, and the smallest observed font sizes.

The owner resolved the `missing-logo-text-fallback` reason for all 332 newly eligible fallbacks against their exact current output hashes. The 146 older fallback reasons remain pending. A future output-hash change invalidates a resolution; no fallback was automatically approved at the whole-cover level.

## Current review state

Latest full review preparation contains 389 unique pending records and 433 unresolved reasons:

| Category | Records |
|---|---:|
| Missing logo | 146 |
| Unexpectedly opaque source | 153 |
| Close background score | 76 |
| Very-close contrast | 40 |
| Upscale over 2× | 6 |
| Likely low resolution | 2 |
| All needs review, deduplicated | 389 |

Flags overlap, so category counts do not sum to the unique total.

Relevant paths:

- `.work/contact-sheets/production-v1/review/index.md`
- `.work/contact-sheets/production-v1/review/index.json`
- `.work/reviews/production-v1/review-state-draft.json`
- `.work/reviews/production-v1/review-checklist.csv`
- `.work/reviews/production-v1/fallback-ids.json`
- `.work/contact-sheets/production-v1/review/mixed-contrast-approved.png`
- `.work/reviews/production-v1/mixed-contrast-approved-summary.json`
- `.work/review-focus/eligibility-50/contrast-comparisons.png`
- `.work/review-focus/eligibility-50/upscale-and-resolution.png`
- `.work/review-focus/eligibility-50/fallback-spot-check.png`
- `.work/review-focus/eligibility-50/opaque-problem-candidates.png`
- `.work/review-focus/eligibility-50/proposed-review-actions.json`
- `.work/contact-sheets/production-v1/review/eligibility-50-contrast-approved.png`
- `.work/contact-sheets/production-v1/review/eligibility-50-opaque-pending/index.md`
- `.work/reports/production-v1/eligibility-50-review-outcome.json`

All cover-level draft entries are pending; no cover has been promoted to publication approval. Exact reason resolution removed only named reasons. `company:12434` remains pending for mixed contrast and `company:35953` remains pending for close/very-close contrast after their safe opaque reasons were resolved.

The eligibility-50 owner decisions are applied: 332 fallback reasons, 7 high-upscale reasons, 2 likely-low-resolution reasons, 23 conservative opaque-source reasons, 4 close-background reasons, and 1 very-close-contrast reason are exact-hash resolved. Six mixed-contrast reasons were independently resolved through the existing source-hash-bound background-review system. The 76 opaque sticker/tiny-canvas/uncertain records remain pending and untouched.

## Eligibility-50 owner review outcome

Run `2026-07-14T10-10-21-277Z` used the exact five-key plan with `--force --offline`. It selected and generated five light covers, reused five cached downloads, made zero network requests, generated zero fallbacks, and had zero download, decode, analysis, or render failures.

The exact regenerated records are `company:420`, `company:11339`, `company:12037`, `network:4440`, and `network:4883`. The retained records are `company:11561` (light), `company:17009` (dark), `company:55802` (dark), and `company:78952` (dark). All nine use `manual-hash-bound`, exact source-logo hashes, and resolved background-review records.

Snapshot verification proves exactly five output hashes and five modification times changed. The other 2,360 outputs were unchanged, comprising the four retained records plus 2,356 unrelated outputs. All 2,365 staged files decode as 1200×675 WebP, all 369 generic reason bindings are current, and there are zero stale output/source bindings or review-state hash mismatches.

Review reasons changed from 808 to 433 exactly as authorised: fallback 478→146, high-upscale 13→6, likely-low-resolution 4→2, opaque-source 176→153, close-background 80→76, very-close 41→40, and mixed-contrast 15→9. The unrelated `low-robust-contrast` count remains 1. Pending review entries changed from 759 to 389.

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

## Eligibility-50 expansion

The approved production automatic thresholds are independently configurable and currently set to 50 for companies and 50 for networks in `config/eligibility.json`. All audit, plan, generate, new, and changed selections use the same resolver. Records at 100 or above are `core`; automatically eligible records from 50–99 are `expanded-threshold`. No `curated-exception` is approved, and below-threshold `explicit` processing still requires an explicit ID selection with `--include-ineligible`.

The 2026-07-13 expansion source audit verified:

- 1,796 eligible companies;
- 569 eligible networks;
- 2,365 eligible records combined;
- zero source validation errors.

The completed deterministic expansion added:

- 1,075 existing records still eligible;
- 1,045 newly eligible companies;
- 245 newly eligible networks;
- 1,290 newly eligible records combined;
- 958 newly eligible logo-backed records;
- 332 newly eligible missing-logo fallbacks;
- 19 newly eligible records with exact-logo reuse opportunities (11 share with current state; 8 share with another new record);
- zero existing logo-path changes, cached source-hash changes, missing/corrupt outputs, disappeared records, renamed records, or records below the new automatic threshold;
- zero invalid newly eligible records.

Run `2026-07-13T09-55-10-682Z` generated 958 logo covers and 332 Inter fallbacks in 34 minutes with zero failures. Full reconciliation preserved the original 1,075 hashes, byte counts, and modification times, produced 2,365 valid 1200×675 WebPs, and rebuilt the 759-entry review draft with zero output-hash mismatches.

The pre-review protected hashes were:

- review-state draft SHA-256: `c1b76dd135ca712d1dfe51f94f25d967946c032687f1a20916239149b7f49667`;
- review checklist SHA-256: `bc50b5acf4fbf9d7305756044327a9117fb7c2cc9a81848b53fbbb29ed4630f2`.

The current reconciled hashes are:

- review-state draft SHA-256: `db3aa4d8d247fd0acbdaf35aa3e248dbc4bb9ed00b7b071480a5822c3316b269`;
- review checklist SHA-256: `a65bbcab014337e31bdc54bc598884d7ed7490b246dafabce7979e1716443295`.

## Current open decisions

- Human disposition of the exact 76 eligibility-50 opaque sticker/tiny-canvas/uncertain cases.
- Separate handling of the newly eligible, out-of-scope `company:281730` source record.
- Disposition of the older pending fallback, opaque, contrast, upscale, and low-resolution reasons.
- The approval-record workflow and who signs off reviewed hashes.
- Publication timing after all required review and selected reruns.

## Exact next step

Review the exact 76-record package at `.work/contact-sheets/production-v1/review/eligibility-50-opaque-pending/` and record explicit reason-level decisions before publication. Handle `company:281730` as a separate narrow `--new-from-state` follow-up; do not widen either task to `--all`.

## Important commands

Run these examples from the repository root:

```powershell
npm --prefix tools/studio-network-batch test
npm --prefix tools/studio-network-batch run font-check
npm --prefix tools/studio-network-batch run review-focus
npm --prefix tools/studio-network-batch run contrast-experiment -- --preset production-v1
npm --prefix tools/studio-network-batch run generate -- --ids-file .work/plans/mixed-contrast-approved/light-switches.json --preset production-v1 --force --offline
npm --prefix tools/studio-network-batch run reconcile-production -- reconcile --before-snapshot .work/plans/mixed-contrast-approved/before-staging.json --changed-ids .work/plans/mixed-contrast-approved/light-switches.json --retained-ids .work/plans/mixed-contrast-approved/approved-dark-retained.json --after-snapshot .work/plans/mixed-contrast-approved/after-staging.json --summary .work/reviews/production-v1/mixed-contrast-approved-summary.json
npm --prefix tools/studio-network-batch run plan -- --new-from-state --preset production-v1
npm --prefix tools/studio-network-batch run threshold-audit
npm --prefix tools/studio-network-batch run generate -- --ids-file .work/plans/eligibility-50/new-all.json --preset production-v1
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

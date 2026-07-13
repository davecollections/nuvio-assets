# Nuvio assets repository instructions

## Repository purpose

This repository stores artwork assets for Nuvio. It also contains a local utility for auditing and staging company and TV-network collection covers under `tools/studio-network-batch`.

The studio/network utility is separate from TMDB Collection Builder v1/v2 development. Do not mix their responsibilities or introduce Collection Builder work into this utility without an explicit request.

## Source data

The utility reads current cached data from a sibling `tmdb-id-lookup` checkout. Its primary inputs are:

- `data/companies.min.json`
- `data/tv-networks.min.json`

Source-directory resolution is, in order:

1. `--source-dir <path>`
2. `TMDB_ID_LOOKUP_DIR`
3. discovery of a sibling `tmdb-id-lookup` repository

Do not make one absolute local path a project requirement. An entity is eligible when `titleCount >= 100`. Recalculate counts from the current source caches; never hardcode current totals into implementation logic.

Treat `tmdb-id-lookup` as read-only unless the user explicitly puts that repository in scope.

## Identity and duplicate policy

Company and network IDs are separate identity namespaces. Every eligible entity receives its own ID-named output, including entities that share a logo:

```text
assets/collection_covers/companies/{tmdb_id}.webp
assets/collection_covers/networks/{tmdb_id}.webp
```

Exact duplicate downloads, analysis, and rendering may be reused internally. Final published identity must still remain one physical file per TMDB ID; do not alias or collapse entities into a shared final file.

## Staging and publishing boundary

All generation and review work happens below ignored work directories first:

```text
tools/studio-network-batch/.work/staging/
tools/studio-network-batch/.work/reports/
tools/studio-network-batch/.work/contact-sheets/
tools/studio-network-batch/.work/reviews/
tools/studio-network-batch/.work/cache/
```

- Do not delete or recreate `.work` without explicit approval.
- Do not publish directly during investigation, tuning, or review work.
- Do not write final assets or a canonical published manifest unless the user explicitly authorises the publish stage.
- Review approvals must bind the stable key and publish target to the exact reviewed staged-output hash.

## Current production rules

`tools/studio-network-batch/presets/production-v1.json` is the source of truth. Its expected design is:

- 1200 × 675, exact 16:9
- flat automatic background
- dark background `#08141C`
- light background `#E4E7E9`
- visible alpha threshold 8
- maximum visible logo width 72%
- maximum visible logo height 48%
- WebP quality 86

Inspect the actual preset before relying on these values or changing production behaviour.

## Missing-logo fallback rules

- Missing-logo covers may be generated for staging.
- They remain `missing-logo` and `needs-review`.
- Production fallback rendering requires confirmed Inter availability to Sharp/libvips/Pango.
- Production must not silently substitute Segoe UI, Arial, or another font.
- Fallback names may use one or two lines and reduce in size to fit the safe region.
- Never approve fallback covers automatically.
- Do not download or commit font files.

## Refresh and rerun rules

The utility supports all eligible entities, selected company IDs, selected network IDs, mixed stable-key ID files, newly eligible records, changed records, selected forced reruns, and selected logo-cache refresh.

Always prefer the narrowest safe selection. Do not run `--all` merely because chat history is missing.

A title-count-only movement must not force artwork regeneration while the entity remains eligible. A changed logo, fallback-text input, renderer version, preset version, missing/corrupt output, or an explicitly requested force run may require regeneration.

Report exactly which records were generated, regenerated, skipped, or failed.

## Review rules

Current focused review categories are:

- missing logo
- unexpectedly opaque source
- close background score
- very-close contrast
- upscale over 2×
- likely low resolution
- all needs review, deduplicated by stable key

Known concern: a multicolour logo can contain black or grey wording that becomes unreadable on a dark background even when its overall contrast score appears acceptable. Handle this through focused review and algorithm testing before publication. Do not make ad hoc edits to random staged output files.

Manual background decisions must bind the stable key to the exact reviewed source-logo hash. If that source hash changes, ignore the stale decision, return the background choice to automatic analysis, and add a stale-decision review reason. When a new background-decision version leaves the selected background unchanged, validated metadata may be reconciled without rewriting the staged image.

## Safety rules for agents

Before implementation or generation work:

1. Read this file.
2. Inspect `git status` and all relevant uncommitted diffs.
3. Read `tools/studio-network-batch/PROJECT_STATUS.md`.
4. Inspect existing ignored reports, reviews, contact sheets, and staged outputs.
5. Run tests.
6. Preserve existing working modules unless a change is justified.
7. Report exactly what was regenerated and what was not.

Do not:

- delete ignored outputs without approval;
- modify `tmdb-id-lookup` unless explicitly requested;
- make unnecessary TMDB API calls;
- copy Mosaiq code without deliberate licence review and attribution handling;
- commit font files;
- publish final assets or a canonical manifest without explicit approval;
- commit or push unless explicitly asked.

## Lost-chat recovery procedure

Run from the repository root:

```powershell
git status --short
git diff --stat
git branch --show-current
git log -8 --oneline
npm --prefix tools/studio-network-batch test
npm --prefix tools/studio-network-batch run font-check
```

Then inspect:

```text
tools/studio-network-batch/PROJECT_STATUS.md
tools/studio-network-batch/.work/reports/
tools/studio-network-batch/.work/reviews/
tools/studio-network-batch/.work/contact-sheets/
tools/studio-network-batch/.work/staging/
```

Resume from repository and filesystem state. Do not restart the project from assumptions or recreate completed work.

## Response expectations

For changes or batch operations, report:

- preflight repository state;
- files changed;
- tests and validation performed;
- the generated or refreshed selection;
- outputs skipped;
- failures;
- any final-asset or manifest writes;
- final `git status --short`.

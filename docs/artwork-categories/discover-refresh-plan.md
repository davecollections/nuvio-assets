# Discover artwork refresh investigation

Status: proposal, 2026-09-07. No Discover schedule, workflow, automatic publication permission or Builder integration has been enabled. The approved poster/square release is independent of this investigation.

## Recommended cadence

| Group | Check cadence | Initial selection approach |
| --- | --- | --- |
| Trending | Daily | Use the TMDB daily trending pool; refresh only if the selected artwork changes. |
| Popular | Weekly | Released/premiered titles ranked by popularity. |
| New | Weekly | Rolling release/first-premiere window, retaining the current 90-day definition until reconciled with the collection source. |
| Top | Every 14 days | Top-rated pool; avoid changes caused only by small ranking movements. |
| Upcoming | Monthly | Future releases/first premieres; add a lightweight daily eligibility check to flag titles that have already released. |

These are proposed frequencies, not scheduled jobs. Top can move to weekly if observed changes justify it. Upcoming's monthly refresh should not silently retain already-released titles for several weeks: the daily check should prepare a small correction when necessary. New Series and Upcoming Series currently mean first premieres, not new seasons.

TMDB provides both daily and weekly trending windows. The published snapshot uses the weekly window; the proposed daily selection is an explicit future policy change, not a reinterpretation of the approved images. [TMDB trending endpoint](https://developer.themoviedb.org/reference/trending-movies). Popularity and trending are different signals. [TMDB explanation](https://developer.themoviedb.org/docs/popularity-and-trending).

## Execution options and recommendation

Prefer one coordinated GitHub Actions workflow once the renderer is portable and tested. This repository already has a scheduled Watch Provider registry workflow with scoped changes, concurrency control, unchanged-run skipping and a review PR. Reuse those patterns deliberately, without coupling Discover to the Watch Provider service.

A daily coordinator should calculate which groups are due, using persisted last-successful-check state and Australia/Sydney calendar dates. Use an anchored 14-day interval for Top; two calendar dates per month are not fortnightly. Maintain check-state outside the public artwork fingerprint. Skip image generation and commits when selected identities, source hashes, framing, renderer and preset inputs have not changed. A failed check must remain due for retry. GitHub schedules can be delayed or dropped, so this is a refresh cadence rather than a precise delivery SLA. [GitHub scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

A Codex scheduled task could run the local workflow sooner, but it depends on the computer being on and the app running. An isolated worktree also needs setup for ignored source caches, dependencies and fonts. [OpenAI scheduled-task documentation](https://learn.chatgpt.com/docs/automations). The current session uses restricted permissions; unattended execution needs an explicitly suitable execution setup. No Codex schedule was created.

## Required preparation

- Promote the useful ignored proof scripts into a dedicated, versioned Discover tool. Current scripts use fixed title IDs, manual crop centers, sibling staging helpers, dependencies from the uncommitted Awards tool and a locally installed Inter font; a clean checkout cannot reproduce the workflow unaided. Pin dependencies and preserve the exact rendering preset. Provide the verified font through a documented runtime setup without committing font files.
- Establish TMDB access for the chosen host. Repository secret-name inspection found NUVIO_PEOPLE_SERVICE_TOKEN only, not a TMDB-specific credential. Do not repurpose that token or export local credentials without authorisation. No secrets were created or changed.
- Reconcile the collection definitions before implementing live selection. Keep original_language=en and origin_country containing US for poster/square artwork, including post-filtering trending/top-rated results. US co-productions qualify. Existing landscape/hero selection has a different documented source policy; expanding the new filtering or duplication rules to those roles requires an explicit design/policy revision.
- Reserve all titles, source-file hashes and decoded-image hashes already assigned to collections that are not due. Allocate due groups together in a stable order, including the Mixed variants. Poster/square/cover/focus variants intentionally share their collection's pair. Never break uniqueness to fill a shortage; keep the last good release and report the shortage.
- Keep recognisable approved artwork when it remains relevant; use ranked eligible candidates for replacements. Review new framing and source images before publication. Keep paired cover/focus artwork identical outside the title highlight. Title logos remain static unless the design changes; photographic heroes need their own existing uniqueness/coverage checks.
- Produce one review package or update one review PR containing only meaningful artwork changes, before/after sheets, source and eligibility evidence, exact hashes and schema validation. Coordinate all group changes against one manifest baseline to avoid competing daily/weekly commits. Do not automatically merge or replace main from this investigation.
- After publication, verify live image bytes and stable URLs. Existing imported Nuvio collections may cache those URLs; repository updates do not establish when Nuvio refreshes its cached image.

## Next concrete implementation

First build a manual Trending refresh that stages one complete Movies/Series/Mixed proposal, using live TMDB data, the existing English/US rules and reservations from the other twelve collections. Validate it from a clean execution environment and review its crop/selection quality. Then add due-group scheduling with the cadence above and decide whether later runs should prepare review PRs or publish automatically under a new standing authorisation. No automation has been enabled by the current artwork approval.

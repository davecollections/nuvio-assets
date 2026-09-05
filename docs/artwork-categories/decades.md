# Decades artwork handover

Last updated: 2026-09-05. Read the [shared workflow](../artwork-workflow.md) first.

## Current state

Published to main in commit 9e89b3b8ca9bfb951940f316181b799f8f7062ae. It replaced 24 montage heroes with single-title heroes and corrected the 2000s Movies landscape/focus pair. Seventy other set assets and two parent covers were retained. All 98 canonical artwork URLs stayed unchanged. The previous release is 8147e6dbac84ac4d2f1e8cfb80f164f8032bcf58.

- Category authority: [manifest](../../assets/collection_covers/decades/manifest.json), [schema](../../assets/collection_covers/decades/manifest.schema.json), [published design notes](../../assets/collection_covers/decades/README.md).
- Live manifest: [Decades manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/decades/manifest.json).
- This category is separate from assets/collection_covers/runtime-lookup.json. No master index or general category-reader integration has been implemented in this task.
- The user accepted the prior artwork in Nuvio and supplied a TV photo. The single-hero revision was approved for publication. At 12:46 on 2026-09-05, the user reported that some new heroes were visible in the existing import, with other decades still updating; full-set refresh and acceptance remain unconfirmed. No exact Nuvio version was supplied.
- The user is deliberately leaving the existing imported collection and cache untouched to observe natural image refresh. Do not replace that import, clear its cache, or claim a refresh time as part of unrelated category work.
- No artwork change is pending. The next infrastructure work discussed is a small master category index and a consistent category-manifest reader; it remains planned.

## Identity and four-file contract

Eight stable keys: 1950s-earlier, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s and 2020s. Each has movies, series and mixed variants. Stable identity is decade:DECADE:VARIANT.

Every assets/collection_covers/decades/DECADE/VARIANT directory contains exactly:

| Filename | Role | Dimensions |
| --- | --- | --- |
| landscape.webp | Cover | 1200 x 675 |
| focus.webp | Matching blurred background with sharp year | 1200 x 675 |
| title-logo.webp | Transparent white cinematic title | 1863 x 673 |
| hero.webp | Single real artwork image, no added year/logo/caption | 2560 x 1440 |

That is 24 sets and 96 runtime images. The two existing parent-cover WebPs are separate root files, not additional assets in a set. All 96 set images total 11,310,842 bytes in this release. Do not assume these counts or sizes for another category.

## Locked design decisions

Covers have five real-artwork panels, full-height backgrounds with soft transitions, and a full year such as 1990s in glassy silver chrome with a smooth reflection. Characters should be visible. The small s is intentional. Artwork displays 1950s; the folder identity/metadata retains the earlier bucket through 1959.

Movies use the spaced cinematic caption A DECADE OF CINEMA below the year; Series use A DECADE OF TV. Mixed has no extra caption. Focus keeps the year sharp while blurring the matching background and caption; cover and focus are not swapped. Title logos use flat white cinematic lettering without a shadow.

Heroes use one selected title per decade. Mixed keeps its own physical hero file containing the same bytes as the matching Movies hero. Read the current manifest or published design notes for the full title list. The 2020s Movies choice is Spider-Man: Brand New Day; the Series choice is Severance, replacing the earlier Squid Game proposal.

Preserve approved images exactly during publication. Current heroes already include recorded visual treatments, including some mirroring and horizontal positioning. The owner's note that Nuvio adds a left fade in both ordinary and full-screen modes did not authorise re-rendering the approved files. Further visual revisions require new matching output evidence.

The 2000s Movies correction narrows Shrek's crop and ends Avatar's panel fade before its secondary face overlaps Shrek. Its focus was regenerated to match. No equivalent change was required for the Mixed cover.

## Validation and cache behaviour

Publication passed 136 studio/network tests, complete WebP decoding/dimension/hash checks, all 98 live stable URLs, and 26 immutable commit URLs for the changed images. The three-collection, 24-folder preview JSON has no sources and passed the real builder importer/serializer round-trip and Nuvio contract validation. Other repository work was preserved.

Canonical asset URLs remain on /main/. A replacement changes its SHA-256 in the category manifest; that metadata does not itself invalidate an existing Nuvio import's image cache. Six query-version URLs returned stale bytes during the initial release check, so the delivered preview pins the 26 changed images to the publication commit. Such a preview deliberately tests exact release bytes, not natural same-URL refresh.

Owner observation (2026-09-05, 12:46 as reported): some new heroes were already visible about 13 minutes after the reported repository change completion, without clearing the cache or replacing the existing import. The exact refresh times and which decades had refreshed were not recorded; some still showed the previous artwork and were changing gradually. This confirms partial natural refresh in this observed client session, not a fixed 13-minute cache lifetime or evidence that the client reads the asset manifest hashes. Completion time remains unknown.

## Local evidence and recovery

All paths below are relative to the repository. They are ignored local working evidence and may be absent in a fresh worktree or clone.

- Latest package: tools/studio-network-batch/.work/staging/decades-single-heroes-v1/.
- Gallery and exact image bindings: review.html, review-bindings.json and render-report.json in that package. The publication approval binds review-bindings.json SHA-256 5ec5756de19ce433d44183f16ba0323e1e477fe2c9985199535284e1d5d6889e.
- Release evidence: publication/approval.json, publish-plan.json, publication-receipt.json, live-url-verification.json and backup/.
- Delivered Nuvio import: nuvio-decades-artwork-preview-v2.json; use NUVIO-PREVIEW.md for its URL policy.
- Sources and lossless masters: sources/ and masters/. Render and source-selection scripts are in this package. Its render.cjs supports a selected DECADE-VARIANT argument; inspect it and existing source hashes before invoking it. Its publication scripts belong to the completed release, not a fresh approval.
- Earlier approved cover framing: tools/studio-network-batch/.work/staging/decades-batch-v9-character-framing/.
- Earlier cover/focus/title proofs: tools/studio-network-batch/.work/staging/decades-artwork-v1/ and decades-artwork-v2/.
- WebP optimisation evidence: tools/studio-network-batch/.work/staging/decades-webp-delivery-v1/.
- The two earlier reviewed single heroes and 2000s cover correction: tools/studio-network-batch/.work/staging/decades-revision-v1/.

A fresh task can inspect the tracked manifests, assets, schema and this handover without the ignored workspace. If a new render needs missing originals or scripts, locate the existing evidence or explicitly reconstruct the bounded source plan from the recorded real source identities and artwork paths; do not silently rerun a historical full batch. Never fabricate an approval for recreated bytes.

## Manifest comment cleanup — 2026-09-05

Removed `approval.approvalText` and `approval.deliveryAuthorization` from the public manifest and removed their schema definitions/requirements. Personal conversation text must not be exported in these manifests. Approval status, dates, scope and reviewed hashes remain metadata; exact local approval evidence is separate.

The 98 artwork files, their URLs, hashes, source records, and manifest artwork fingerprint are unchanged. Both category schemas validate. Current manifest SHA-256: 2155224101f2f0aa45c4fe711138a982c3961538f0b55e727321e13a394262b5. Current schema SHA-256: 9712ae0a64bd541aef779dacfd461b0923a0defcdee63d05f4478d50ef7864dc.

This is a metadata-only maintenance change. The original artwork release remains as documented above. Historical release validators that compare the original whole-manifest hash predate this cleanup; use the current schema for the current manifest. Cleanup evidence and original metadata backups are ignored under tools/studio-network-batch/.work/staging/manifest-comment-cleanup-v1/.

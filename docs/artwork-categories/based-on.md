# Based on artwork handover

Last updated: 2026-09-08. Read [the shared workflow](../artwork-workflow.md) first.

## Scope and identity

Category key: based_on. Stable keys: based_on:SLUG. Ten film-artwork categories, with no added Movies/Series/Mixed variants. Category membership is an editorial decision; an artwork source does not define a Builder filter. History and True Stories may overlap. Toys & Games covers physical toys and board games; Video Games is separate. The mythology stable key displays as Myths & Legends and covers myths, legends and folklore. Holiday artwork has its own category and handover.

| Category | Slug | Film artwork (TMDB ID) |
| --- | --- | --- |
| Books | books | Harry Potter and the Philosopher's Stone (671) |
| Video Games | video-games | The Super Mario Bros. Movie (502356) |
| Comics | comics | The Dark Knight (155) |
| True Stories | true-stories | Apollo 13 (568) |
| Myths & Legends | mythology | Clash of the Titans (18823) |
| History | history | Dunkirk (374720) |
| Fairy Tales | fairy-tales | Cinderella (150689) |
| Stage Shows | stage-shows | Wicked (402431) |
| Toys & Games | toys-and-games | Barbie (346698) |
| TV Shows | tv-shows | Mission: Impossible (954) |

## State and next action

Original landscape/logo/hero release state: published to remote main and live-hash verified. Approval covers all forty v3 images, retirement of all five legacy JPGs, category metadata, commit and push. The stronger focus treatment is selected. General Builder integration is absent and Nuvio client framing remains untested.

The 2026-09-08 proof work runs on the current local main with unrelated Awards changes preserved. Forty approved poster/square cover/focus files are installed and validated, with commit/push and live verification next; the original forty published assets remain unchanged. The isolated-checkout details in the completed-publication section below are historical release evidence.

Next: commit and push the approved format extension, then verify live hashes. General Builder integration and Nuvio client acceptance remain separate work.

## Design and delivery contract

| Role | Dimensions | Format | Public path |
| --- | --- | --- | --- |
| Cover | 1200 × 675 | WebP | assets/collection_covers/based_on/SLUG/landscape.webp |
| Focus | 1200 × 675 | WebP | assets/collection_covers/based_on/SLUG/focus.webp |
| Poster | 800 × 1200 | WebP | assets/collection_covers/based_on/SLUG/poster.webp |
| Poster focus | 800 × 1200 | WebP | assets/collection_covers/based_on/SLUG/poster-focus.webp |
| Square | 800 × 800 | WebP | assets/collection_covers/based_on/SLUG/square.webp |
| Square focus | 800 × 800 | WebP | assets/collection_covers/based_on/SLUG/square-focus.webp |
| Title logo | 1863 × 673 | Transparent lossless WebP | assets/collection_covers/based_on/SLUG/title-logo.webp |
| Hero | 2560 × 1440 | WebP | assets/collection_covers/based_on/SLUG/hero.webp |

Covers use real film artwork, a small BASED ON caption and large pearl-white category text. Title logos use category-specific white typography and motifs, with about 25 pixels between the caption and main glyphs. Focus adds the stronger blue-white outer stroke/glow; normal letter interiors and areas outside the glow are preserved in the masters. Heroes use one visually different source image from their corresponding covers, with no baked-in text or added fade. Harry Potter replaces the rejected LOTR Books artwork and differs from the Decades Harry Potter composition. Only already-installed local fonts were used.

## Manifest and Builder contract

- Category authority: assets/collection_covers/based_on/manifest.json.
- Schema: assets/collection_covers/based_on/manifest.schema.json, schemaVersion 2, kind based-on-artwork; ten sets and eighty images (13,605,108 bytes).
- The sets object maps each slug to stableKey, labels, basis, mediaTypes, landscape/focus/poster/posterFocus/square/squareFocus/titleLogo/hero, and artworkSources. Every role has a path, URL, SHA-256, dimensions, bytes and encoding. Focus also binds its base-cover hash. Asset sourceSha256 is the lossless render-master hash; artworkSources retains the original film-image identity/hash and mirror decision.
- Public base: https://raw.githubusercontent.com/davecollections/nuvio-assets/main/.
- No new shared master index or general Builder reader is introduced. Companies/Networks and other category manifests are unchanged.
- Owner-approved retirement replaces the legacy Books.jpg, Comics.jpg, Mythology.jpg, True Stories.jpg and Video Games.jpg URLs with the new per-slug WebP paths. Old URLs are not redirects; existing imports may keep cached images.

## Review and publication evidence

Approved source package: tools/studio-network-batch/.work/staging/based-on-artwork-v3/. All forty output hashes exactly match the reviewed candidate manifest and review-bindings.json. Stronger focus selection is recorded in focus-selection.json. V1/V2 review revisions remain preserved.

Publication evidence: tools/studio-network-batch/.work/staging/based-on-release-2026-09-05/. approval.json holds the local owner instruction and exact stable-key/target/output-hash bindings. plan.json records the installed selection. legacy-backup/ holds the five old JPGs with hash-checked copies. The complete previous handover is retained as handover-before-publication.md. Original checkout changes are snapshotted in original-checkout-snapshot.json. Raw owner wording and private local paths are excluded from the public manifest.

Validation before publication: 136 existing repository tests passed. All forty staged WebPs passed full decode, dimensions, exact output/source/master bindings, transparent-white logo checks, focus preservation and distinct hero-source checks. The JSON manifest passed schema validation. Total image bytes: 7,844,264. Thirty normal covers/title logos/heroes remain unchanged from v2; v3 changes only its ten focus outputs. No artwork was regenerated for publication.

## Recovery notes

The category manifest, schema, forty WebPs and this handover are tracked release content. Source images, metadata, lossless masters, renderers, review galleries, approval evidence and backups remain ignored/local-only and may be absent from other checkouts. Do not reset acquisition scripts over an existing revision. Use the published manifest and exact source hashes as authority when recovering missing evidence.

The bounded focus revision can be reproduced from retained inputs with:

    node tools/studio-network-batch/.work/staging/based-on-artwork-v3/revise-focus.cjs

The old staging verifier expects the legacy public JPGs to remain and is historical after retirement; use the release verifier for installed/published artifacts. Keep all ignored revisions and backups. Future artwork changes require their own exact-output review; do not extend this release to holidays or unrelated categories.

## Completed publication — 2026-09-05

Artwork release commit: 7d141d280cb1d11a550ddcdc06b52a02234daf38. All forty images and the category manifest/schema were pushed to remote main. The five old JPGs are absent from the release and all five canonical raw URLs return 404.

Published manifest: https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/based_on/manifest.json

Live verification at 2026-09-05T10:34:53.467Z checked every image and all three metadata files at both main and the immutable release commit: eighty image responses and six metadata responses matched their committed hashes. Five retired legacy URLs returned 404. Local publication validation confirmed exact forty-file membership, hashes, dimensions, 7,844,264 image bytes, the schema, and fifty bounded commit paths (forty images, three metadata files, two documentation files and five deletions). No unrelated release paths changed. All 136 existing tests passed; no artwork regeneration or unresolved failures occurred.

Evidence remains local-only in the release directory: publication-validation.json, live-verification.json, approval.json, allowed-commit-paths.json, original-checkout-snapshot.json, final-git-status.txt and final-release.json. The release checkout is clean after publication. The original checkout retains its unrelated Awards/Decades changes; only this task's handover and Based on workflow row are reconciled to the published state.

The original local main remains at its earlier revision. Automatic approval review rejected advancing it because that would also import unrelated remote deletions and registry changes. Publication instead used the isolated checkout; this is a local checkout-state distinction, not an incomplete remote release. Inspect the latest remote manifest or the retained isolated checkout before resuming, and do not republish the old local JPG tree.

## Poster and square proofs — 2026-09-08

The initial proof request did not authorise publication. The subsequent 2026-09-08 approval explicitly authorises these exact sixty proofs, required category metadata, commit and push; the hash-bound release evidence below supersedes the historical staging flags. All existing published cover, focus, title-logo and hero bytes and URLs are preserved.

Shared ignored stage: tools/studio-network-batch/.work/staging/based-on-holiday-poster-square-proof-v1. Review entry point: review.html; the running local gallery URL/PID is in server-info.json. The gallery offers Poster/Square and Covers/Focus/Hover to focus, eight contact sheets, full-size proofs and the current published landscape for comparison. These are artwork proofs, not a Nuvio client integration test.

Formats: poster 800 × 1200 (2:3, matching the recent Decades/Discover delivery) and square 800 × 800 (the owner-requested 1:1 size). Every theme has poster.webp, poster-focus.webp, square.webp and square-focus.webp below this stage’s assets/CATEGORY/SLUG/. The approved format extension uses these same filenames below assets/collection_covers/CATEGORY/SLUG/.

Across both categories, sixty final WebPs total 7,811,554 bytes. All fifteen films remain the same as the current cover selections. Sixteen real source images are retained: fifteen current originals plus one alternative Harry Potter image for the Books poster. Only that original was newly downloaded from an already verified cached TMDB image entry; no source metadata/API requests, font downloads or generated scene imagery were needed. No source crop is upscaled.

Validation: 136 existing repository tests passed. validation.json checks all sixty exact output/master/source hashes, dimensions, successful perceptual WebP encoding, thirty base/focus bindings, safe text bounds, crop bounds and no upscaling. Lossless masters preserve main-letter interiors and every pixel outside the outline/glow; independently encoded WebPs are not asserted to be pixel-identical. gallery-validation.json confirms the HTML and all eighty-three gallery image responses match local bytes. Browser review covered shape and focus controls and the narrow gallery layout.

baseline.json protects 8,422 files, including existing published assets, original stages and unrelated Awards changes. All passed hash and modification-time checks before these handover edits; --allow-doc-updates excludes only these two category handovers and the shared workflow, leaving 8,419 protected files. render-report.json and review-bindings.json retain publicationAuthorized false and exact stable-key/role/proposed-target/output-hash records.

The approved outputs are frozen in the publication package below. If the owner requests a later revision, preserve the current outputs and use render.cjs --only=SLUG for the smallest selection, followed by gallery.cjs within this shared stage. The original verify.cjs --allow-doc-updates is a historical prepublication check; it expects the old canonical manifests. Use publication/release.cjs verify --installed for the installed release. Do not rerun the one-time prepare.cjs or refine.cjs scripts over this stage. Initial crop proofs are preserved under revisions/initial-crops/; source-plan.json records the final source/crop decisions. Restart server.cjs hidden if the gallery is no longer running.

Owner approval now binds all sixty reviewed hashes to their exact targets. The format extension follows the Decades/Discover poster, posterFocus, square and squareFocus role conventions. No general Builder integration or master index was created.

Based on layout: scene above pearl-white titles, a close-set small BASED ON caption, compact two-line labels where needed and the selected stronger blue-white outer outline. The Books square retains the original trio; its poster uses Harry and a flying owl from the same film, verified TMDB movie 671 image /hziiv14OpD73u9gAak4XDDfBKa2.jpg, distinct from the published hero. Batman’s mirrored crop keeps the full character, Mission: Impossible keeps Cruise’s face in frame, and Apollo 13 stays within native source resolution.

## Approved format extension — 2026-09-08

State: installed and fully validated; commit/push and live URL verification are next. Local main and freshly fetched origin/main both matched f31212e6b9ba9da5b2180d7e885c0117490e71c8 before preparation and again before installation.

Release evidence (ignored/local-only): tools/studio-network-batch/.work/staging/based-on-holiday-poster-square-proof-v1/publication/. approval.json binds the sixty reviewed stable-key/role/target/SHA-256 records. reviewed-* freezes the proof reports and source plan; prepared/ freezes the exact sixty delivered WebPs plus six category metadata files. backup/ retains both previous manifests, schemas, READMEs and all three artwork documents. plan.json permits exactly sixty new images, six metadata updates and three documentation updates. No original image is replaced or deleted.

This category adds forty approved images and now supplies eighty WebPs. All sixty format additions across Based on and Holiday are copied byte-for-byte from the approved proofs; no artwork was regenerated, no sources were fetched, and no fonts were installed during publication.

Both strict draft-2020-12 schemas pass Ajv validation. Candidate and installed validation checks all 120 image decodes, dimensions, hashes, byte counts, fingerprints, source/crop identities and thirty new focus-to-cover bindings. It verifies that all original role objects and cover/hero provenance are unchanged and that 8,413 protected files retain their hashes and modification times. The existing 136 repository tests passed; no failures remain.

The schemaVersion 2 format extension preserves the original approval and adds formatExtensionApproval. Each new role has its exact URL, output hash, master hash, dimensions, bytes and encoding. artworkSources.poster and artworkSources.square retain original-image identity/hash, mirror flag and [left, top, width, height] crop in source pixels after the mirror. focusPolicy.baseRoles explicitly maps focus to landscape, posterFocus to poster and squareFocus to square. The original landscape/logo/hero URLs and all unrelated categories are unchanged.

For recovery, run node tools/studio-network-batch/.work/staging/based-on-holiday-poster-square-proof-v1/publication/release.cjs verify --installed. Do not rerun prepare or install over an existing release. Source caches, local approvals and proof galleries are not committed. Other tasks’ Awards changes remain outside this release.

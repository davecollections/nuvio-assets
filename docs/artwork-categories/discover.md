# Discover artwork handover

Last updated: 2026-09-07. Read [the shared workflow](../artwork-workflow.md) first.

## Scope and identity

- Category key: discover; task name: Discover artwork.
- Owner requested replacement Discover covers, focus artwork, title logos and heroes, using real artwork and no AI-generated images.
- Five groups: New, Trending, Popular, Top and Upcoming. The owner explicitly chose Upcoming instead of Anticipated.
- Each group has Movies, Series and Mixed variants: 15 sets, now eight roles per set and 120 runtime images after the poster/square extension. Mixed displays the group name alone.
- Stable identity: discover:GROUP:VARIANT, with lowercase keys new/trending/popular/top/upcoming and movies/series/mixed.
- Owner chose current titles with refreshes over time. Refresh automation is under investigation: daily Trending, weekly Popular/New, fortnightly Top and monthly Upcoming are proposed. No automation is enabled; see discover-refresh-plan.md.
- Work belongs in nuvio-assets. The People repository and tmdb-id-lookup were inspected read-only; neither was changed. Preserve existing Awards work.

## State and next action

Current state: the sixty approved v3 poster/square cover and focus images are published on main in [659b243](https://github.com/davecollections/nuvio-assets/commit/659b243c5ce78b8a1bb1d461e34044d1e682568f), extending Discover to 120 WebPs and manifest schemaVersion 2. The original sixty landscape/focus/title-logo/hero assets from [67c96b6](https://github.com/davecollections/nuvio-assets/commit/67c96b659ce4b169c905e669159ea858b3e8162a) retain their exact bytes, paths and metadata. All twelve retired JPGs remain retired. All 120 canonical image URLs and both category metadata URLs matched their committed hashes at 2026-09-07T09:37:54.916Z.

The v6 covers, focus artwork and title logos, revised v7 heroes, and replacement of the legacy files were approved. Exact final approval bindings for all sixty current hashes and twelve deletions are recorded in v7/publication/approval.json. No artwork approval remains pending for these exact bytes.

The cinematic-black base (#0A0C10), film reel, Series screen icon, typography and focus treatment remain settled. Each hero uses 65–78 distinct titles/images with no duplication within the hero; Mixed remains balanced. The forty-five approved static assets are unchanged from v6.

Git publication was explicitly authorised. The release includes only Discover assets and documentation; unrelated Awards changes remain uncommitted. Repository publication and live URL verification are complete. Builder integration and actual Nuvio display remain unverified.

Verified live category manifest: [Discover manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/discover/manifest.json).

Next concrete action: follow [the refresh investigation](discover-refresh-plan.md) to implement a manual live Trending proposal before enabling scheduling. The approved extension and its live verification are complete. General Builder integration and actual Nuvio display remain unverified.

## Design and delivery contract

These are the installed repository paths. Their canonical GitHub URLs use /main/. All 120 artwork URLs and both metadata URLs have been live-verified against the committed bytes.

| Role | Dimensions | Format | Installed target |
| --- | --- | --- | --- |
| Landscape cover | 1200 x 675 | WebP quality 88 | assets/collection_covers/discover/GROUP/VARIANT/landscape.webp |
| Matching focus | 1200 x 675 | WebP quality 88 | assets/collection_covers/discover/GROUP/VARIANT/focus.webp |
| Transparent title logo | 1863 x 673 | Lossless WebP | assets/collection_covers/discover/GROUP/VARIANT/title-logo.webp |
| People T2 hero | 2560 x 1440 | WebP quality 82 | assets/collection_covers/discover/GROUP/VARIANT/hero.webp |
| Poster cover | 800 x 1200 | Reviewed WebP | assets/collection_covers/discover/GROUP/VARIANT/poster.webp |
| Poster focus | 800 x 1200 | Reviewed WebP | assets/collection_covers/discover/GROUP/VARIANT/poster-focus.webp |
| Square cover | 800 x 800 | Reviewed WebP | assets/collection_covers/discover/GROUP/VARIANT/square.webp |
| Square focus | 800 x 800 | Reviewed WebP | assets/collection_covers/discover/GROUP/VARIANT/square-focus.webp |

- Cinematic-black base #0A0C10, neutral card shadows and gradients, matte pearl Inter group name on the left, three overlapping angled photographic cards on the right.
- Both top rule marks are removed. Cover media captions are 44px with a 46px icon; title-logo captions are 78px with an 82px icon. Movies uses the owner-selected film reel, Series uses a TV-screen outline, Mixed omits the caption and icon.
- Long group names reduce font size to remain within the same 585px cover title width. The title starts at x62 with baseline y388. Card geometry and source-hash-bound crops are recorded in the candidate manifest.
- Focus keeps the photographic composition and media caption sharp and unchanged. Only the group name receives a blue-white fill and controlled blue halo. There is no focus blur.
- Separate title logos remain flat white with transparent alpha and no added shadow. No fonts were downloaded or committed. The local InterVariable.ttf SHA-256 is 4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf.
- Heroes use one distinct title and image per contributing tile: 65–78 identities per hero in v7. Mixed alternates Movies and Series with counts differing by at most one. There is no repeated-fill fallback. Insufficient sources or duplicate title/image identities stop rendering.
- Hero/title combined previews are illustrative compositions, not actual Nuvio screenshots. The title is a separate runtime asset.

The unchanged network-free People prism-t2-compositor.py remains copied into ignored staging. A Discover-only hero-unique.py adapter preserves its original seed, slot geometry, perspective, fades and depth of field while assigning one distinct title per tile. Tiles wholly outside the inverse projected frame are omitted; a pixel comparison of the complete versus culled warped lattice confirms identical frame coverage, including bicubic edge sampling. No contributing tile is removed. Attribution to bramst0ne/Prism Wallpapers and the recorded 2026-08-06 direct permission are preserved. The shared People renderer, generator and published People assets were not edited.

## Real artwork and refresh source policy

The original 2026-09-05 cover/hero snapshot made 10 metadata requests and downloaded 280 exact-path poster/backdrop images for 140 titles. v7 expanded those same category queries using 38 additional metadata requests and reused ten cached metadata pages. It downloaded 532 additional exact-path images and reused 230 cached images. The fifteen hero plans use 762 image files and 583 distinct title identities across 1,079 placements, without duplication inside any individual hero. Credentials were never written into source URLs, code, reports or handovers.

No AI image generation was used. Artwork comes from the exact TMDB paths in returned records; this establishes the TMDB source, not a separate rights-holder provenance audit of every upload.

Proof definitions, still implementation assumptions pending reconciliation with the actual Discover collection source:

- New: releases or first series premieres from 2026-06-08 through 2026-09-05 inclusive, ranked by current popularity.
- Trending: current TMDB weekly movie/TV trending endpoints.
- Popular: released/premiered titles through the snapshot date, sorted by current TMDB popularity.
- Top: current TMDB movie/TV top-rated endpoints, without an extra custom score or vote threshold.
- Upcoming: primary movie releases or first series premieres from 2026-09-06 onward.
- The published 2026-09-05 snapshot used non-adult records with both poster and backdrop artwork and no language/country restriction. The revised poster/square proofs below add original-English and US-origin eligibility.
- New Series and Upcoming Series concern first premieres, not returning seasons or episode dates.
- Do not claim exact Builder collection membership until these source definitions are reconciled. Builder development is outside this artwork task's current write scope.

Approved covers retain their original selection from the eighteen-title v2 pools, with three photographs and source-hash-bound manual crops. Mixed covers include both media types. v2/sources.json remains the unchanged authority for these cover selections. Expanded hero pools, exact metadata URLs/ranks/dates, rejected candidates and page evidence are in v7/source-pools.json and metadata/. Exact per-tile assignments, image URLs, file/pixel hashes and source identities are in v7/plan-GROUP-VARIANT.json. Only the orientation actually assigned to a tile was acquired.

Refresh into a new dated revision, compare selected identities/artwork paths and stage changed artwork for review. Preserve stable public URLs after publication. Do not rerun acquisition over v2/sources.json and lose its manual cover selections. No automatic publication exists.

## Manifest, legacy cleanup and publication

- Current category authority: assets/collection_covers/discover/manifest.json, schemaVersion 1, kind discover-artwork. Strict schema: assets/collection_covers/discover/manifest.schema.json. Both are published and live-hash verified.
- The manifest follows the existing Decades category pattern: group objects with Movies/Series/Mixed entries, stable keys, media types and landscape/focus/titleLogo/hero role metadata. Each role records its path, intended canonical URL, SHA-256, bytes, dimensions, encoding and retained master hash. Cover/hero source identities and image hashes are included.
- Manifest SHA-256: 3d69881e5d91be780eaf579f01d9fe61d5f7642a2e9ace5a7c4589f2befe5061. Schema SHA-256: ac1a3b7a3ddd2e625c2b54ad5e04f01272ebaafc377bcdee14d4161c3f143c6e. Image package: 4,486,790 bytes across sixty WebPs.
- v7/publication/approval.json binds the owner's final approval to all sixty v7 output hashes and the twelve exact legacy deletions. v7/publication/publish-plan.json and installation-receipt.json record the executed selection. Historical v6/v7 pre-release inventories are retained without rewriting their former review state.
- All twelve legacy JPGs were removed from the repo as expressly authorised. Exact original bytes are retained under v7/publication/backup/, with hashes in legacy-backup-inventory.json. No compatibility JPGs or aliases were added.
- Retired names: Blu-Ray Releases.jpg; Coming Soon.jpg; Latest Movies.jpg; Latest Series.jpg; Popular Movies.jpg; Popular Series.jpg; anticipated.jpg; anticipated movies.jpg; anticipated series.jpg; anticipated base.jpg; anticipated movies base.jpg; anticipated series base.jpg.
- Those old JPG paths are retired by this release. New assets use GROUP/VARIANT/ROLE.webp. The owner explicitly approved deleting the old files, superseding the earlier legacy-URL preservation proposal for this release.
- No shared master index or general Builder reader was created. Existing Companies/Networks runtime lookups and the Decades manifest were preserved. Discover installation does not automatically add Builder support.
- Final writes: sixty approved WebPs, one canonical category manifest and one schema. Twelve exact-file removals after verified backups. No rendering or image acquisition occurred during installation. Git publication was subsequently authorised and completed in 67c96b659ce4b169c905e669159ea858b3e8162a.

## Latest generation and validation

Preflight: main at a70c528, with the existing unrelated .gitignore, README.md and Awards edits plus this task's Discover documentation. Relevant diffs and prior release evidence were inspected. All unrelated working files were preserved.

The approved hero selection remains:

| Group | Movies | Series | Mixed |
| --- | ---: | ---: | ---: |
| New | 78 | 71 | 66 |
| Trending | 77 | 66 | 72 |
| Popular | 75 | 65 | 71 |
| Top | 71 | 76 | 71 |
| Upcoming | 73 | 78 | 69 |

- Existing repository tests: 136 passed. Pre-install v7 verification passed all sixty images, all 762 source images, no repeated titles/artwork within heroes, Mixed balance and three fail-safe rejection checks.
- Publication preparation verified sixty exact approved hashes, twelve original JPG hashes and all twelve backup hashes. The Discover manifest passed PowerShell Test-Json against the strict draft-2020-12 schema before and after installation.
- Installed exactly sixty WebPs into fifteen sets plus manifest.json and manifest.schema.json. No image was regenerated or recompressed; all installed hashes match the reviewed v7 files.
- Removed exactly twelve approved legacy JPGs only after the new files and backups passed hash verification. No recursive deletion or directory replacement was used.
- Final verification passed exact sixty-image/two-metadata file membership, full WebP decode, dimensions, size counts, transparent white logos, approved output/master/review bindings, manifest fingerprint, source provenance and zero remaining legacy files.
- Preserved all forty-eight protected unrelated working files and existing category/runtime manifests byte-for-byte. Pre-existing Awards work, README.md and .gitignore changes were untouched.
- Refreshed selection: repository copies for all discover:GROUP:VARIANT roles. Skipped: source acquisition, rendering, other categories, Builder integration, shared runtime changes and Git publication. Metadata/image requests: 0 during release.
- Failures: none unresolved. The local artwork validation and release checks passed. Live verification passed all sixty image URLs and both metadata URLs; all twelve retired paths returned 404.
- Installed image bytes: 4,486,790. Removed legacy bytes: 1,227,798, all backed up. Manifest: 505,197 bytes. Schema: 21,752 bytes.

Changed files: sixty new WebPs and two metadata files under assets/collection_covers/discover/; twelve deleted legacy JPGs; this handover and the Discover row in docs/artwork-workflow.md. Release approval, backup, preparation, installation and verification scripts/reports are ignored under v7/publication/. No other task's files were changed.

The exact final git status is recorded below in the release state section.

## Recovery and reproduction

Tracked current deliverables are the sixty WebPs, category manifest, schema and this handover. Original images, lossless masters, galleries, backups and release scripts remain ignored local evidence and may be absent in another checkout.

- Approved staging/gallery: tools/studio-network-batch/.work/staging/discover-artwork-v7/review.html. Individual sources, plans, masters/layers and comparison sheets remain in that directory.
- Latest release evidence: v7/publication/approval.json, publish-plan.json, installation-receipt.json, pre-install-validation.json, installed-validation.json, git-publication-receipt.json and live-url-verification.json.
- Exact old files: v7/publication/backup/ and legacy-backup-inventory.json. Do not delete these backups without explicit approval.
- Protected-file evidence: v7/publication/protected-files.json records the forty-eight unrelated working files/manifests preserved during this release.
- Current scripts: publication/prepare.cjs, install.ps1 and verify-release.cjs. Preparation/installation belong to this completed replacement and must not be rerun against the installed tree as a new approval.
- v7/verify.cjs is the historical pre-install package validator and expects the twelve legacy public files to exist. Use the release validator below for the installed state.
- v7/render.cjs, hero-unique.py and acquire.cjs remain the bounded generation workflow. Allocate a new revision for future source/design changes and preserve the current approved outputs. The original attributed People compositor remains unmodified.

From the repository root, verify the installed release without network requests:

    node tools/studio-network-batch/.work/staging/discover-artwork-v7/publication/verify-release.cjs

Validate the public schema with PowerShell:

    Get-Content assets/collection_covers/discover/manifest.json -Raw | Test-Json -SchemaFile assets/collection_covers/discover/manifest.schema.json

Publication is complete. Asset commit: 67c96b659ce4b169c905e669159ea858b3e8162a. The publication receipt and live verification report record all seventy-four URL results. Do not rerun the completed installation or recreate approval for changed bytes; use a fresh staging revision for future changes.

## Preserved revision history

- v1: first four-file New Movies proof, superseded.
- v2: sixty Decades-derived files, superseded by the owner's design correction. Its real source cache and requested T2 heroes remain authoritative inputs for v6.
- v3: distinct three-card concept for New Movies/Series/Mixed, Trending Mixed and Upcoming Movies; fifteen new cover/focus/logo files and five reused heroes.
- v4: New Movies refinement removing top marks, enlarging MOVIES and highlighting NEW instead of focus blur. Clapboard main proof and film-reel comparison; 304,836 bytes across four primary assets.
- v5: selected film reel and cinematic-black New Movies comparison; 302,280 bytes across four assets. Background initially remained under discussion, then was accepted by the latest "ok agreed" decision. Navy/black comparisons remain available there.
- v6: complete black/reel/typography/focus family, subsequently approved by the owner. Its forty-five static assets are the exact approved baseline. The fifteen repeated heroes were superseded by the requested v7 revision.
- v7: fifteen heroes with 65–78 distinct titles/images each, plus the forty-five unchanged approved static assets. The owner approved all outputs and replacement/deletion. All sixty images and category metadata are published on main and live-verified.

## Release working-tree state

Asset commit: 67c96b659ce4b169c905e669159ea858b3e8162a. Pushed to origin/main. The documentation-only publication record follows that asset commit. The Discover release is clean; these pre-existing unrelated changes remain outside the release:

     M .gitignore
     M README.md
    ?? data/awards/
    ?? schemas/awards-hero-sources.schema.json
    ?? schemas/awards-projections.schema.json
    ?? schemas/awards-registry.schema.json
    ?? schemas/awards-sources.schema.json
    ?? tools/awards-artwork/

## Manifest comment cleanup — 2026-09-05

Removed `approval.approvalText` from the public manifest and removed their schema definitions/requirements. Personal conversation text must not be exported in these manifests. Approval status, dates, scope and reviewed hashes remain metadata; exact local approval evidence is separate.

The 60 artwork files, their URLs, hashes, source records, and manifest artwork fingerprint are unchanged. Both category schemas validate. Current manifest SHA-256: 3d69881e5d91be780eaf579f01d9fe61d5f7642a2e9ace5a7c4589f2befe5061. Current schema SHA-256: ac1a3b7a3ddd2e625c2b54ad5e04f01272ebaafc377bcdee14d4161c3f143c6e.

This is a metadata-only maintenance change. The original artwork release remains as documented above. Historical release validators that compare the original whole-manifest hash predate this cleanup; use the current schema for the current manifest. Cleanup evidence and original metadata backups are ignored under tools/studio-network-batch/.work/staging/manifest-comment-cleanup-v1/.

## Poster and square cover proofs — 2026-09-07

Scope: prepare the same fifteen Discover cover identities in two additional shapes, using 800 x 1200 posters (2:3) and 800 x 800 squares (1:1). Work is staged for design review only. The existing sixty published images and canonical metadata remain outside this change. Existing Decades format-proof and Awards working changes must be preserved.

Design: retain cinematic black #0A0C10, matte pearl Inter headings, the film reel for Movies and TV-screen for Series, with the group name alone for Mixed. Reduce from three angled photographic cards to two, selecting familiar imagery from the existing three-card covers. Every Mixed proof retains one movie and one series. Reuse the current source snapshot and source-hash-bound framing; this is a format adaptation, not a fresh title acquisition.

Ignored local package: tools/studio-network-batch/.work/staging/discover-poster-square-proof-v1/. The source plan and exact output evidence are recorded there. Poster and square filenames are proposed proof targets only, without a canonical role/schema migration or publication authorisation. No hero, title-logo or focus generation is included in this cover-only request.

All 30 cover proofs are ready in that package: 15 posters and 15 squares. Open review.html for media/group filters, direct image links and comparisons with the published landscapes. previews/GROUP-comparison.webp shows both formats for all three media variants; poster-tile-review.webp and square-tile-review.webp show the complete family at reduced size.

The exact proof bindings are in review-bindings.json, SHA-256 a2b04a39d2003353c41866bee9402e86ee99883bb390d28f50c306a5368ec2f9. All output hashes, dimensions, byte counts, source identities, source-image hashes, crop coordinates, card geometry and quality measurements are in render-report.json. The two main drawing helpers and icons are retained from the approved v6 renderer. source-plan.json records editorial familiarity choices within each original three-image cover; these are not claims of a refreshed global popularity ranking. The 2026-09-05 source snapshot is retained.

The Nuvio source at the supplied commit 23d1fe478e380860dae3eb41c8770533361a0cc5 was read from the verified source evidence already saved by the Decades format task. Hash-checked copies are in evidence/. CollectionRowSection.kt assigns equal width and height to SQUARE; the default poster style comes from ComponentTokens.kt at 126 x 189 dp (2:3). The 800 x 800 and 800 x 1200 image delivery sizes are chosen proof dimensions, not fixed source-image pixel requirements from Nuvio.

Validation: 136 existing tests passed; all 30 WebPs and lossless masters passed hash, decoding, dimension, exact-membership, text-bound and compression checks. Seventeen unique cached source-image hashes were verified. Every Mixed proof has one Movie and one Series. Both complete tile sheets and full-size New Movies proofs were visually inspected; long labels fit and the two-card composition remains legible. Total WebP delivery size is 962,742 bytes. No source acquisition, AI image generation or font download occurred. No failures.

All sixty published Discover images, both canonical metadata files and the hashed preexisting working files remain unchanged. No final assets, manifest, hero, title-logo or focus writes occurred. baseline.json records preflight state; final-git-status.txt records the handoff state. Only the ignored proof package, this handover and the Discover row of the shared workflow changed. Unrelated Awards preparation and the existing Decades format-proof handover edit were preserved.

Reproduce from the repository root with node tools/studio-network-batch/.work/staging/discover-poster-square-proof-v1/render.cjs followed by node tools/studio-network-batch/.work/staging/discover-poster-square-proof-v1/package.cjs. The latter validates outputs and builds review files. Existing local Sharp/skia-canvas dependencies are used without changing their utility. Ignored evidence may be absent from another checkout.

Next: review these exact proofs. Do not publish or migrate the canonical four-role manifest merely from this proof request. If the new shapes are approved for publication, confirm the appropriate category/runtime role mapping and preserve the original sixty assets and URLs. Keep personal comments out of public metadata. No commit or push has been requested for this revision.
## Centered cover/focus revision and English/US source policy — 2026-09-07

The next proof revision is tools/studio-network-batch/.work/staging/discover-poster-square-proof-v2/. The two-card layout is retained. Both poster and square covers now need their group title centered at the existing bottom baseline, with the complete media icon/caption row centered beneath it. Add matching focus versions using the existing sharp-artwork, blue-white title highlight and controlled blue halo.

Apply original_language=en and origin_country containing US to all source titles in these poster/square pairs. These map to TMDB Discover with_original_language=en and with_origin_country=US; language=en-US alone is not the filter. Trending/top-rated pools need the same exact-title eligibility predicate after retrieval. US co-productions qualify. The policy applies to the revised proofs and future sourcing for these shapes; published artwork and Builder definitions are unchanged.

The seventeen selected source identities were checked using eight live movie-detail requests and nine cached TV metadata records. The Early Spring (zh, CN) is removed from New Series and replaced by the eligible cached Furious (en, US). The other selections qualify. The source snapshot and category membership pools otherwise remain unchanged. Exact responses and filter decisions are in metadata/, eligibility.json, source-policy.json and source-plan.json in the new ignored package. The v1 proofs remain preserved.

The v2 package is now ready for review: 30 centered covers and 30 matching focus WebPs, across all 15 identities. Dimensions remain 800 x 1200 poster and 800 x 800 square. review.html has Cover/Focus, media and group filters, with direct links to each version. The four complete review sheets and previews/new-cover-comparison.webp / new-focus-comparison.webp show the designs at smaller display sizes. All sixty outputs were visually inspected via those sheets, with New Movies focus and New Series square also checked at full size.

Exact review bindings: review-bindings.json SHA-256 46881956ccd48c3f1ab3d4b5da1165362832bbb7a07f5b4989bfcc371f70bf3b. render-report.json records exact assets, crops, title/caption centers, shared layers, hashes and encoding quality. validation.json records all sixty image/master checks, seventeen source-image hashes and eligibility checks, thirty focus-pair comparisons and 186 existing local gallery links. Cover and focus share identical sharp artwork/caption layers, and lossless pixels outside the title layers are identical. The group title and complete icon/caption row both center at x400. All 136 existing tests passed. The current public manifest still validates. The new WebPs total 2,054,172 bytes.

The first preservation check caught an inherited v1 hash for the independently updated Decades handover. Its newer Decades proof entries were inspected, preserved and reconciled in the v2 baseline; this task did not edit that file. All 101 current protected baseline files then matched, including the sixty published Discover images, canonical metadata, old v1 proof files and preexisting tracked work. No unresolved failures, public-asset writes, canonical-manifest writes, Builder edits, commits or pushes occurred. Preflight and final Git states are saved in the package. The only tracked edits for Discover remain this handover and its shared-workflow row.

Reproduction uses prepare-sources.cjs, render.cjs and package.cjs in the v2 package, run from the repository root. The source preparer reuses its eight detail responses on rerun; it never substitutes display language for original language or a release region for origin country. Existing image files and the verified local Inter font are reused. No image acquisition, AI image generation or font download was needed.

Next concrete action: review these exact centered cover/focus pairs. The earlier acceptance of the two-card layout does not publish the newly filtered/centered bytes. Preserve the old proofs and current public assets; any authorised publication must reconcile new roles with the category schema/consumer and keep personal conversation text out of public metadata.
## Distinct poster/square artwork revision — 2026-09-07

The current proof revision is tools/studio-network-batch/.work/staging/discover-poster-square-proof-v3/. Each of the fifteen collection identities receives two globally distinct title identities and source images, including Mixed. Matching poster/square/cover/focus variants intentionally retain their own collection’s pair. Reacher is assigned only to Popular Series. Preserve the centered two-card design, focus highlight and original-English/US-origin source policy.

The plan retains all seventeen previous title identities somewhere in the family and adds thirteen cached titles from the existing category pools. Thirty unique title keys, source file hashes and decoded image hashes passed; all eligibility predicates passed. Seven additional movie-detail responses were retrieved, eight prior movie-detail responses reused and fifteen cached TV records checked. No images were downloaded. Category membership remains the 2026-09-05 snapshot.

The v3 package is complete: 60 WebPs, comprising 30 covers and 30 focus images in 800 x 1200 poster and 800 x 800 square. Thirty distinct title IDs, source-file hashes and decoded image hashes confirm zero reuse between collection identities. The normal/focus variants retain the same composition within each collection. review.html provides Cover/Focus, media and group filters; all four complete contact sheets and New comparisons are included.

Regenerated 32 files for New Mixed, all three Trending variants, Popular Movies, Popular Mixed, Top Mixed and Upcoming Mixed. The other seven collections retain all 28 v2 output files byte-for-byte, along with their original lossless masters and shared layers. A focused four-file refinement centers the Dark Matter face in Trending Series; Coyote vs. Acme and S.W.A.T. Exiles also have recorded source-framing overrides. No photographic files were edited directly.

Exact review bindings SHA-256: 5b3da4ba36db147ab58c22e92cf743a78b5c9a603be03f221be1dd5c4576d238. Total output size: 2,321,300 bytes. All 60 output/master hash, decoding, dimension and quality checks passed; 30 matching focus pairs preserve identical lossless pixels outside the title layers; 186 local gallery links and gallery script syntax passed. All 60 variants were visually inspected via complete sheets, with the refined Trending Series poster checked at full size. The current canonical manifest validates, and 136 existing utility tests passed. No failures.

All 396 protected baseline files matched, including published Discover assets, canonical metadata, prior proof files and preexisting tracked work. Unrelated Decades/Awards work remains preserved. No public-asset writes, canonical-manifest writes, Builder changes, commits or pushes occurred. baseline.json and final-git-status.txt record repository state.

Reproduce with prepare-sources.cjs, render.cjs and package.cjs in the v3 package. framing-overrides.json preserves manual crop centers. render.cjs also accepts a single stable key for a narrow rerender, checking that all unselected source plans and staged hashes remain unchanged. Validation, source eligibility and exact review bindings remain local proof evidence.

Next concrete action: review the distinct artwork pairings in the v3 gallery. Retain these no-duplicate title/source rules for future refreshes of the poster/square family. Publication and new canonical artwork roles require their own authorised stage; preserve current published URLs and earlier proofs.

## Approved poster/square publication — 2026-09-07

The owner approved the exact v3 review bindings and explicitly authorised commit and push. Sixty new files are copied byte-for-byte from the reviewed staging package; no rerender or new source acquisition occurs during publication. Review-bindings SHA-256: 5b3da4ba36db147ab58c22e92cf743a78b5c9a603be03f221be1dd5c4576d238. Ignored approval, metadata backups, install plan, checks and receipts are under tools/studio-network-batch/.work/staging/discover-poster-square-proof-v3/publication/. The public manifest contains status and hashes, without personal comments or conversation quotes.

The category manifest advances to schemaVersion 2. Each variant adds poster, posterFocus, square and squareFocus; the existing focus role remains the landscape focus. New filenames match their reviewed proposed targets. Shape-specific source lists preserve exact source-image hashes, decoded-image hashes, English original language, US-origin evidence and crops. posterSquarePolicy applies only to the four added roles; the original landscape/hero policy and approval metadata remain unchanged. formatExtensionApproval binds the new roles to the v3 reviewed hashes.

This additive category extension does not update runtime-lookup.json: the existing runtime serves Companies/Networks and legacy People entries, with no general Discover reader. A consumer must explicitly support Discover schemaVersion 2 and select the matching orientation/focus fields. No Builder or other repository was modified. Existing URLs and the original sixty image hashes are unchanged.

Validation passed for 120 installed image hashes, decodes, formats, dimensions, bytes, exact membership and the aggregate fingerprint. All 60 new outputs match approval bindings; all 60 original assets and their source metadata are preserved. Thirty unique title/source/pixel identities satisfy the English/US policy. The candidate schema passed and rejected a wrong poster width, a non-English source and a missing square-focus role. All 136 existing utility tests and the Inter font check passed. New image bytes total 2,321,300; all Discover image bytes total 6,808,090. Manifest SHA-256: 669a0d624c9fc9c3a89bf57f4918b3075a7fc36f5a9193c7e384d07ada70675b. Schema SHA-256: 57feb144d073378c5c94f97fc51ebc1f7c28038afd1b39bb7360dfe5aec62910.

Only the sixty new Discover images, its manifest/schema, this handover, the Discover workflow row and the refresh-investigation note belong in the release. The preexisting .gitignore, README, Decades handover and Awards changes remain outside it. No files are deleted. Reproduction of the install audit: node tools/studio-network-batch/.work/staging/discover-poster-square-proof-v3/publication/release.cjs verify. Avoid rerunning historical proof validators that assert the pre-publication manifest hash; their preservation baselines intentionally predate this authorised extension.

Publication completed in commit 659b243c5ce78b8a1bb1d461e34044d1e682568f, pushed to origin/main. live-url-verification.json records 122 successful canonical /main/ responses: all 120 images and both category metadata files, with zero failures. The release changes no existing images and deletes no files. A documentation-only follow-up records this verification. Final Git state retains only the preexisting unrelated .gitignore, README, Decades handover and Awards work. No Discover automation is scheduled or enabled.

# Discover artwork handover

Last updated: 2026-09-05. Read [the shared workflow](../artwork-workflow.md) first.

## Scope and identity

- Category key: discover; task name: Discover artwork.
- Owner requested replacement Discover covers, focus artwork, title logos and heroes, using real artwork and no AI-generated images.
- Five groups: New, Trending, Popular, Top and Upcoming. The owner explicitly chose Upcoming instead of Anticipated.
- Each group has Movies, Series and Mixed variants: 15 sets, four roles per set, 60 primary runtime images. Mixed displays the group name alone.
- Stable identity: discover:GROUP:VARIANT, with lowercase keys new/trending/popular/top/upcoming and movies/series/mixed.
- Owner chose current titles with refreshes over time. Refresh cadence and scheduling remain undecided; no automation exists.
- Work belongs in nuvio-assets. The People repository and tmdb-id-lookup were inspected read-only; neither was changed. Preserve existing Awards work.

## State and next action

Current state: published to main in asset commit [67c96b6](https://github.com/davecollections/nuvio-assets/commit/67c96b659ce4b169c905e669159ea858b3e8162a). All sixty approved v7 WebPs are available under assets/collection_covers/discover/, organised as five groups x three variants x four roles. The twelve legacy root JPGs were backed up and removed under explicit owner approval. All sixty live image hashes, manifest/schema hashes and twelve retired URL 404 responses were verified at 2026-09-05T06:24:30.839Z.

The owner approved the covers, focus artwork and title logos after v6, then approved the revised heroes and replacement with: "ok i think we have it sorted, happy to approve these, also approve deleting the current files in the discovery folder in the repo and putting these there instead.". Exact final approval bindings for all sixty current hashes and twelve deletions are recorded in v7/publication/approval.json. No artwork approval remains pending for these exact bytes.

The cinematic-black base (#0A0C10), film reel, Series screen icon, typography and focus treatment remain settled. Each hero uses 65–78 distinct titles/images with no duplication within the hero; Mixed remains balanced. The forty-five approved static assets are unchanged from v6.

The owner explicitly authorised Git publication with "ok, commit and push". The release includes only Discover assets and documentation; unrelated Awards changes remain uncommitted. Repository publication and live URL verification are complete. Builder integration and actual Nuvio display remain unverified.

Verified live category manifest: [Discover manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/discover/manifest.json).

Next concrete action: if requested, reconcile Discover source definitions and artwork-role mapping with the actual Builder consumer, then review inside Nuvio. Refresh cadence remains undecided. No artwork generation, deletion or publication work remains for this approved release.

## Design and delivery contract

These are the published repository paths. Their canonical GitHub URLs use /main/; all sixty were verified against the approved bytes.

| Role | Dimensions | Format | Installed target |
| --- | --- | --- | --- |
| Landscape cover | 1200 x 675 | WebP quality 88 | assets/collection_covers/discover/GROUP/VARIANT/landscape.webp |
| Matching focus | 1200 x 675 | WebP quality 88 | assets/collection_covers/discover/GROUP/VARIANT/focus.webp |
| Transparent title logo | 1863 x 673 | Lossless WebP | assets/collection_covers/discover/GROUP/VARIANT/title-logo.webp |
| People T2 hero | 2560 x 1440 | WebP quality 82 | assets/collection_covers/discover/GROUP/VARIANT/hero.webp |

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
- Non-adult records with both poster and backdrop artwork; no language or country restriction.
- New Series and Upcoming Series concern first premieres, not returning seasons or episode dates.
- Do not claim exact Builder collection membership until these source definitions are reconciled. Builder development is outside this artwork task's current write scope.

Approved covers retain their original selection from the eighteen-title v2 pools, with three photographs and source-hash-bound manual crops. Mixed covers include both media types. v2/sources.json remains the unchanged authority for these cover selections. Expanded hero pools, exact metadata URLs/ranks/dates, rejected candidates and page evidence are in v7/source-pools.json and metadata/. Exact per-tile assignments, image URLs, file/pixel hashes and source identities are in v7/plan-GROUP-VARIANT.json. Only the orientation actually assigned to a tile was acquired.

Refresh into a new dated revision, compare selected identities/artwork paths and stage changed artwork for review. Preserve stable public URLs after publication. Do not rerun acquisition over v2/sources.json and lose its manual cover selections. No automatic publication exists.

## Manifest, legacy cleanup and publication

- Current category authority: assets/collection_covers/discover/manifest.json, schemaVersion 1, kind discover-artwork. Strict schema: assets/collection_covers/discover/manifest.schema.json. Both are published and live-hash verified.
- The manifest follows the existing Decades category pattern: group objects with Movies/Series/Mixed entries, stable keys, media types and landscape/focus/titleLogo/hero role metadata. Each role records its path, intended canonical URL, SHA-256, bytes, dimensions, encoding and retained master hash. Cover/hero source identities and image hashes are included.
- Manifest SHA-256: fb46ca7f8fede2b8023c1b7558c4e45160cc379cca1d0566c2ef9646e6da8183. Schema SHA-256: ba45dfeb5e2dd6b00147715ba9cbcb05dc29e3f44f74fda74888990d2755bbbc. Image package: 4,486,790 bytes across sixty WebPs.
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

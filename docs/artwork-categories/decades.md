# Decades artwork handover

Last updated: 2026-09-07. Read the [shared workflow](../artwork-workflow.md) first.

## Current state

The latest set-image release was published to main in commit 9e89b3b8ca9bfb951940f316181b799f8f7062ae. It replaced 24 montage heroes with single-title heroes and corrected the 2000s Movies landscape/focus pair. Seventy other set assets and two parent covers were retained. All 98 canonical artwork URLs stayed unchanged. The previous release is 8147e6dbac84ac4d2f1e8cfb80f164f8032bcf58.

- Category authority: [manifest](../../assets/collection_covers/decades/manifest.json), [schema](../../assets/collection_covers/decades/manifest.schema.json), [published design notes](../../assets/collection_covers/decades/README.md).
- Live manifest: [Decades manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/decades/manifest.json).
- This category is separate from assets/collection_covers/runtime-lookup.json. No master index or general category-reader integration has been implemented in this task.
- The user accepted the prior artwork in Nuvio and supplied a TV photo. The single-hero revision was approved for publication. At 12:46 on 2026-09-05, the user reported that some new heroes were visible in the existing import, with other decades still updating; full-set refresh and acceptance remain unconfirmed. No exact Nuvio version was supplied.
- The user is deliberately leaving the existing imported collection and cache untouched to observe natural image refresh. Do not replace that import, clear its cache, or claim a refresh time as part of unrelated category work.
- Both parent-cover replacements are published and live-hash verified; see the 2026-09-05 parent-cover section below. The small master category index and consistent category-manifest reader remain planned infrastructure work.

- Current release: all 96 approved poster/square cover/focus files and the schemaVersion 2 manifest are published to main in commit 1d2b53407b434398b5acea57e7d06b2738086789. All 194 images and the category metadata passed live-hash verification. The 98 original artwork files and URLs are preserved. No publication work remains; new-shape display inside Nuvio is still untested.

## Identity and published asset roles

Eight stable keys: 1950s-earlier, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s and 2020s. Each has movies, series and mixed variants. Stable identity is decade:DECADE:VARIANT.

Every assets/collection_covers/decades/DECADE/VARIANT directory contains exactly:

| Filename | Role | Dimensions |
| --- | --- | --- |
| landscape.webp | Cover | 1200 x 675 |
| focus.webp | Matching landscape focus | 1200 x 675 |
| poster.webp | Single-image poster cover | 800 x 1200 |
| poster-focus.webp | Matching poster focus | 800 x 1200 |
| square.webp | Single-image square cover | 800 x 800 |
| square-focus.webp | Matching square focus | 800 x 800 |
| title-logo.webp | Transparent white cinematic title | 1863 x 673 |
| hero.webp | Single real artwork image, no added year/logo/caption | 2560 x 1440 |

That is 24 sets and 192 runtime images. The two parent covers are separate root files, giving 194 total images and 16,024,420 bytes. The original 96 set images and two parents are unchanged; the 96 added poster/square cover/focus files total 4,497,940 bytes. The approved 2026-09-07 format expansion supersedes the original four-file limit. Do not assume these counts or sizes for another category.

## Locked design decisions

Landscape covers have five real-artwork panels, full-height backgrounds with soft transitions, and a full year such as 1990s in glassy silver chrome with a smooth reflection. Characters should be visible. The small s is intentional. Artwork displays 1950s; the folder identity/metadata retains the earlier bucket through 1959.

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

The 98 artwork files, their URLs, hashes, source records, and manifest artwork fingerprint are unchanged. Both category schemas validate. Manifest SHA-256 at cleanup: 2155224101f2f0aa45c4fe711138a982c3961538f0b55e727321e13a394262b5. Schema SHA-256 at cleanup: 9712ae0a64bd541aef779dacfd461b0923a0defcdee63d05f4478d50ef7864dc.

This is a metadata-only maintenance change. The original artwork release remains as documented above. Historical release validators that compare the original whole-manifest hash predate this cleanup; use the current schema for the current manifest. Cleanup evidence and original metadata backups are ignored under tools/studio-network-batch/.work/staging/manifest-comment-cleanup-v1/.

## Parent-cover replacement release — 2026-09-05

The owner approved replacing both parent covers and committing/pushing this release. The approved files are published to main in commit 49f19b94d56064c0ea2947f4eb94a30a8d7f4438 and live-hash verified. The two old files and prior manifest/schema are backed up. All 96 published set assets, set metadata and stable artwork URLs remain unchanged.

The design uses eight chronological real-title panels, a cinematic black background, large silver Movies/Series headings and a spaced By Decade caption. Series replaces the old TV Shows wording. Both parent covers retain 1695 × 928 dimensions and their existing root paths. No additional roles or variants are introduced.

| Stable key | Canonical target | Approved SHA-256 | Bytes |
| --- | --- | --- | --- |
| decade:root:movies | assets/collection_covers/decades/movies-by-decade.webp | e5316790958c99781d7c67953a7663a21cf27b437bc23aec5df0cfd84b64d631 | 108888 |
| decade:root:series | assets/collection_covers/decades/series-by-decade.webp | e089f6be18982f30f09ecc89636a95e24bd5796a42b67084bc9f3f8274ed175d | 106750 |

Sources reuse the sixteen current Decades hero title identities, with alternative cached photographs for I Love Lucy, Star Trek and M*A*S*H. Exact source image hashes, dimensions, crops, colour adjustments, mirror decisions and panel positions are now recorded in each rootCovers entry. Each parent also has its stableKey and owner-approved status/date/review-hash metadata. Optional parent-only schema fields support those records; schemaVersion remains 1. The original set-image approval and all other top-level metadata are retained. The artwork fingerprint was recomputed from decades and rootCovers. Public metadata contains no personal approval wording.

No artwork was regenerated or re-encoded for publication. The original reviewed WebPs were copied exactly. The two covers total 215,638 bytes; the unchanged 96 set images total 11,310,842 bytes. All 98 images therefore total 11,526,480 bytes.

Validation before installation: 136 existing tests passed; 100 original public Decades files matched the preserved baseline; two WebPs fully decoded at their expected dimensions; both lossless master hashes and all 16 source hashes/crop bounds passed. The prepared manifest passed its schema.

Local-only evidence:

- Reviewed source package: tools/studio-network-batch/.work/staging/decades-parent-covers-v1/. review-bindings.json SHA-256 is e173c734e8cf3a5f692e05d7b0b64e4185b287e87e513146e40f36ccbdc52d8d. The original pending-review file is retained unchanged; the subsequent publication approval is separate.
- Release: tools/studio-network-batch/.work/staging/decades-parent-release-2026-09-05/. approval.json binds the exact owner-approved keys/targets/hashes. backup/ retains replaced assets, metadata and working documentation. snapshot.json records the original Git state and unrelated Awards file hashes. manifest-before.json, plan.json and subsequent validation/live-verification reports document the narrow delta.
- Earlier draft, review gallery, source contact sheets and masters remain in the source package. Fonts were already installed locally and were not copied or downloaded. No source/API/image-generation requests were needed.

The parent package render.cjs/package.cjs baseline checks describe the pre-replacement public tree; do not rerun them against the new release as though their old baseline were current. Use the release verification evidence and published manifest for the installed images. Keep all ignored backups and proof revisions.

Unrelated Awards preparation in .gitignore, the root README, data/awards/, schemas/awards-*.schema.json and tools/awards-artwork/ is preserved and excluded from this release. Based on artwork and metadata are unchanged. Next: no artwork publication work remains. Nuvio client acceptance and natural refresh of these parent covers remain untested; do not clear or replace the existing import.

## Parent release verification — 2026-09-05

Release commit: 49f19b94d56064c0ea2947f4eb94a30a8d7f4438. At 2026-09-05T10:56:30.336Z, both stable /main/ parent-cover URLs and their immutable commit URLs returned the exact approved hashes. The manifest, schema and README also passed both URL checks: ten successful responses, no mismatches. Current manifest SHA-256: 1209bbf0e51fcdeb0283a1e4d357eee5a40d69fd710f0ecc62483338120a07e5. Current schema SHA-256: 920e17f23df98e9b8f000dd084f361b82c69b63607ee649745d6a1e629d0aee6.

The release replaced only the two parent images, updated rootCovers metadata/fingerprint, added optional root-only schema fields, and updated three documentation files. All 96 set images and their metadata are unchanged; all 98 canonical artwork URLs are preserved. Two old parent files and prior metadata are backed up locally. No artwork was regenerated, no external source acquisition occurred, and no unresolved failures remain. The 136 repository tests passed. All 44 unrelated working files were hash-checked and preserved.

Final evidence in the ignored release directory: publication-validation.json, live-verification.json, approval.json, snapshot.json, final-release.json and final-git-status.txt. The only remaining uncommitted work is the preexisting Awards preparation.

## Poster and square cover/focus proofs — 2026-09-07

The requested scope is new poster and square covers with matching focus images. Heroes and title logos do not need new versions. Prepared a representative 1990s proof for Movies, Series and Mixed: six covers and six focus WebPs. Other decades and all current public assets remain unchanged. These are staged design proofs, not an approved expansion of the published four-file sets; no final filenames, manifest migration, commit or push is authorised by this proof request.

The official NuvioTV source was checked at commit 23d1fe478e380860dae3eb41c8770533361a0cc5. CollectionRowSection.kt lines 253–256 give SQUARE equal width/height; the image uses ContentScale.FillBounds at line 309. PosterCardDefaults.kt delegates to ComponentTokens.kt, where the default poster is 126 by 189 dp (2:3). There is no fixed source-image pixel requirement in this collection renderer. Proof delivery is our choice: 800 by 800 square and 800 by 1200 poster. Saved source files, URLs and hashes are in the proof evidence/ directory.

The design retains the original five real artwork title selections, translucent silver chrome, smooth reflection and spaced ice-blue captions; Mixed remains caption-free. Images are reframed as three upper and two lower panels for these shapes. The first draft was retained; the current crop refinement makes the lower characters visible above the year. The matching focus blurs the background and caption, preserving exactly 98,703 fully opaque year-interior pixels in each lossless master. WebP encoding is quality 82, effort 6 with smart subsampling; final individual files range from 19,516 to 81,754 bytes, totalling 506,918 bytes for all twelve.

Ignored local package: tools/studio-network-batch/.work/staging/decades-poster-square-proof-v1/. Open review.html to toggle Cover/Focus and compare the published landscape; comparison.webp shows all six covers. Reproduction: run node tools/studio-network-batch/.work/staging/decades-poster-square-proof-v1/render.cjs from the repo root. Validation: run the adjacent verify.cjs. The source plan remains the v9 character-framing package; original sources and fonts were reused, with no TMDB acquisition, image generation or font download. Initial outputs are preserved under drafts/initial/; masters/ contains lossless current layers and images.

Evidence: proof-report.json contains crops, source hashes, dimensions, encoding and output hashes; review-bindings.json identifies the exact pending-review outputs; validation.json records full decoding, thirty bounded source placements, ten verified original sources, exact focus-year comparisons, thirty-one local gallery links and all 145 protected baseline files unchanged. All 136 existing repository tests and the font check passed after rerunning with permitted temporary-file writes. The initial read-only sandbox test failures were resolved; no unresolved failures remain.

Only the ignored proof package and this tracked handover were changed for the request. No public artwork, canonical manifest, hero or title-logo writes occurred. Preexisting Awards preparation is preserved. Next: owner review of these poster/square cover and focus proofs before any wider decade generation or publication.

## Reduced-image cover/focus comparison — 2026-09-07

The five-image poster/square design was judged too crowded and is superseded for this review. Preserve v1 as evidence; it is not approved for publication. Prepared a focused 1990s Movies comparison with three images (Terminator 2, Jurassic Park, The Matrix), two (Terminator 2, Jurassic Park) and one (Jurassic Park). Each option has poster and square cover/focus pairs: twelve WebPs. The single-title option reuses the previously approved decade-defining Movies hero title and original high-resolution source; the new cover crop is still pending review. Series, Mixed and other decades have not been regenerated in this round.

The year is raised 32 pixels in every new proof while the caption baseline stays unchanged. Conservative clearance from the year to the caption is about 59 pixels in poster and 34 pixels in square, excluding shadows. Full-height backgrounds, the glassy silver-chrome year and ice-blue cinema caption are retained. The focus background/caption is blurred with the matching sharp year. Heroes and title logos remain outside the requested scope.

Ignored package: tools/studio-network-batch/.work/staging/decades-poster-square-proof-v2/. review.html compares all three counts in each shape and has a Cover/Focus toggle; comparison.webp is the six-cover board. Reproduction uses the package render.cjs from the repository root; verify.cjs validates the outputs. Source hashes/crops and output hashes are in proof-report.json, review-bindings.json and validation.json. The v1 package contains the already-verified Nuvio aspect-ratio source evidence. There are no new source downloads or AI-generated images.

Validation passed: all twelve WebPs fully decoded and matched expected dimensions/hashes, all twelve crop placements were inside the three verified original sources, all six master focus pairs preserved 98,703 year-interior pixels, twenty-six local gallery links resolved, and all 223 baseline files remained unchanged, including the entire v1 package and protected published/unrelated files. All 136 existing repository tests passed. The new WebPs total 558,006 bytes. No public assets, canonical manifests, heroes or title logos were written; no commit or push occurred. The existing Awards changes and earlier handover edits are retained.

Next: review image count in each shape and confirm the single-title approach if preferred, before generating further decades. The three/two/one options are alternatives, not a mandate to deliver all counts.

## Single-image title alternatives — 2026-09-07

The owner favours a single image for both poster and square, but the Jurassic Park shot may be the issue. Archive, physical-media, iconic-detail and cinema-photography concepts were discussed only; no such new design was rendered or approved. The current practical comparison keeps the approved chrome/caption design and tests four other cached 1990s film artworks: Terminator 2, The Matrix, Titanic and Toy Story. Each has poster and square covers plus matching focus, sixteen new WebPs. Four existing Jurassic Park cover/focus proofs are reused unchanged as references.

Ignored package: tools/studio-network-batch/.work/staging/decades-poster-square-proof-v3/. review.html has the Cover/Focus toggle and all five films side by side; comparison.webp shows the covers. All outputs remain 800 by 1200 / 800 by 800 with the year raised 32 pixels and the caption baseline retained. The Toy Story poster centres on Woody; the square includes Buzz and Woody. Sources remain original cached artwork with manually bounded crops, no source download or AI generation. Heroes and title logos were not changed. Reproduce with the package render.cjs from the repository root; run verify.cjs for validation.

Validation passed for all sixteen WebPs, eight source crops against four original source hashes, four exact unchanged Jurassic Park references, eight matching sharp-year masters (98,703 year-interior pixels each), caption clearance, forty-two local gallery links and all 264 protected baseline files, including earlier proofs and the concurrent Discover/Awards work. The existing 136 tests passed. New WebPs total 655,580 bytes. proof-report.json, review-bindings.json and validation.json record exact source/output evidence. No public artwork or canonical manifest was written, and no commit/push occurred.

Next: owner review of the single-image title choice and framing. Terminator 2 is the assistant's visual preference, not an owner-approved replacement or a change to the currently published 1990s hero. Other decades, Series and Mixed have not been regenerated for this comparison.


## Complete single-image poster/square proof set — 2026-09-07

The owner selected the face-led Terminator 2 option for the 1990s and requested the same direction across every decade using existing artwork. Prepared 96 WebPs: eight decades, Movies/Series/Mixed, poster/square, cover/focus. This expands the local proof review only. It does not change the current published four-file contract, heroes, title logos, stable URLs, category manifest or schema. The 1990s Movies poster/square cover/focus files are byte-identical to the selected v3 Terminator 2 proofs. The published 1990s hero remains Jurassic Park.

| Decade label | Movies and Mixed image | Series image |
| --- | --- | --- |
| 1950s | Singin' in the Rain | I Love Lucy |
| 1960s | 2001: A Space Odyssey | Star Trek |
| 1970s | Star Wars | M*A*S*H |
| 1980s | Back to the Future | The A-Team |
| 1990s | Terminator 2: Judgment Day | Friends |
| 2000s | The Lord of the Rings: The Fellowship of the Ring | Lost |
| 2010s | Avengers: Endgame | Game of Thrones |
| 2020s | Spider-Man: Brand New Day | Severance |

Design retains the translucent silver chrome year with smooth reflection, raised by 32 pixels, and the spaced ice-blue cinema/TV caption below. Mixed has no caption. Each image fills its 800 x 1200 poster or 800 x 800 square with a separately selected crop, without mirroring. Focus blurs the matching artwork and caption while retaining the exact sharp year in the lossless master. The 1950s-earlier identity still displays only 1950s. Dimensions follow the already-verified Nuvio 2:3 and 1:1 aspect ratios recorded in the first proof evidence; these are chosen delivery pixels, not mandatory Nuvio source sizes.

Sources reuse the established title identities and cached originals. Terminator 2 and the Star Trek cast image reuse the v9 source files; the other images reuse the parent-cover sources. I Love Lucy and M*A*S*H use the front-facing cast photographs. Their cached originals are 780 x 439, so these two poster crops upscale by approximately 2.74x and are softer than the larger originals; this is recorded for owner review. No new source/API requests, AI image generation or font acquisition occurred.

Ignored package: tools/studio-network-batch/.work/staging/decades-poster-square-all-v1/. Open review.html for Movies/Series/Mixed/All, Poster/Square/Both and Cover/Focus controls. Six KIND-SHAPE-comparison.webp contact sheets show the cover family. source-plan.json contains the 16 exact sources and shape-specific crops; proof-report.json records all 48 compositions and 96 output/master hashes. review-bindings.json SHA-256: bae017bef7bf594e01e601dfc9a849a9a8ebba71b933e1ef892b11045ee9cbf0. These bindings are pending full-set owner review and assign no canonical publish targets.

Initial renders and masters are retained under drafts/initial/. Visual review led to a tighter Star Wars poster crop to include Leia's face, a tighter A-Team poster crop around Mr. T, and the M*A*S*H cast image so faces stay above the year in both shapes. Sixteen outputs across four decade/variant selections were rerendered; 10 changed bytes and 6 reproduced identically. The other eighty files were retained. Reproduce current output from the repository root using node tools/studio-network-batch/.work/staging/decades-poster-square-all-v1/render.cjs, followed by gallery.cjs and verify.cjs in the same directory. render.cjs also accepts selected DECADE-VARIANT arguments. Use the current source-plan.json; bootstrap.cjs/refine.cjs are historical preparation steps and must not be rerun over the completed package.

Validation passed: 96 complete WebP decodes with dimensions and exact output/master hashes, 16 source hashes, 48 bounded source crops, 48 matching focus-year comparisons, all caption clearances, four exact approved 1990s references, sixteen identical Movies/Mixed background pairs and 201 existing gallery links. Gallery JavaScript syntax passed. The 136 preflight repository tests and font check passed. Total delivery size: 4,411,636 bytes, individual files 14,234–172,304 bytes. Six cover boards were visually inspected, followed by the refined Series board, full-size Star Wars and M*A*S*H examples and Terminator 2 focus. Nuvio client rendering of these shapes is still untested.

Preservation: all 311 unchanged protected files matched their initial hashes, including the entire published Decades tree, earlier proof packages and unrelated Awards preparation. Two additional baseline files, the Discover handover and shared workflow, changed independently during rendering. Their Discover v2 documentation diffs were inspected and left intact; concurrent-documentation-changes.json records the original and new hashes without replacing the original baseline. The first preservation check stopped on this external change, then passed after this explicit reconciliation. No unresolved failures remain. Only this Decades handover and the new ignored proof package were written by this task. No public assets or canonical manifests were written, and no commit or push occurred.

Next concrete action: review the complete staged proof gallery. Keep earlier proofs and existing published artwork intact. If these new shapes are subsequently approved for publication, separately resolve their canonical filenames and category/consumer role mapping while preserving current assets and stable URLs.


## Star Wars poster contrast revision — 2026-09-07

The owner accepted the complete set apart from the Star Wars poster, where the glassy silver year blended into the pale clothing. Keep Star Wars and the typography. Prepared a darker, text-free composition from the same 1977 movie, with Vader above the main characters and dark terrain behind the year. Only 1970s Movies/Mixed poster cover and focus were regenerated: four 800 x 1200 WebPs. All 48 square proofs and the other 44 poster proofs are byte-identical to the accepted v1 files. The earlier complete package remains untouched.

Latest package: tools/studio-network-batch/.work/staging/decades-poster-square-all-v2/. review.html retains the complete family and Cover/Focus controls; use #1970s-movies-poster to jump to the revision. accepted-v1-bindings.json records the 92 accepted unchanged identities/hashes separately from the four pending revised files. revision-validation.json lists the exact four changes. The review-bindings.json hash for the complete current package is 4ac230174a675ed8efa916f6fa50bf1dab4cc848148d3c514cca75e1ebc28196. Neither design acceptance nor this requested correction authorises publication, commit or push.

After checking cached sources, one exact TMDB movie/11/images request supplied 21 small candidate previews; one selected original was acquired. Saved metadata, previews and selection are under sources/. Selected artwork path: /zqkmTXzjkAgXmEWLRsY4UpTWCeo.jpg, 3840 x 2160. Source SHA-256: 97666fb50961c53d51aed6b8570672c7d57f032a6b72119a90df0b0d2598e0d5. Poster crop is left 2240, top 0, width 1440, height 2160, with no mirroring. The current source plan uses a poster-only source override so the old Star Wars square source and all existing heroes remain intact. No AI generation or font download occurred.

Visual review confirmed the clearer year against the dark foreground, with the main faces above the typography. Year position, glass/chrome treatment, caption spacing and focus method are unchanged. All 96 WebPs decode and match their expected dimensions/hashes; 17 distinct source hashes and 48 crops passed. All 48 focus pairs preserve their sharp year; approved 1990s byte parity and Movies/Mixed background equality also passed. All 723 baseline files matched, including published Decades assets, the complete previous proof package and unrelated working files. The 136 existing tests passed. Current proof images total 4,497,940 bytes. No unresolved failures remain.

Reproduce the four changed images from the repository root with node tools/studio-network-batch/.work/staging/decades-poster-square-all-v2/render.cjs 1970s-movies 1970s-mixed --shape=poster, followed by gallery.cjs and verify.cjs. prepare-revision.cjs and find-star-wars.cjs record completed acquisition/setup steps; do not rerun them over the completed proof package. Only this Decades handover and the new ignored package were changed by this task. Independent Discover publication preparation and Awards work were preserved. No public Decades asset, canonical manifest, hero or title-logo writes occurred; no commit or push was performed.

Next: review this Star Wars poster/focus replacement. Keep the accepted 92 proofs exactly, with any future final-file role/manifest migration handled only during an explicitly authorised publication stage.


## Poster and square format release — 2026-09-07

The owner approved all v2 proofs and explicitly authorised commit and push. The release adds poster.webp, poster-focus.webp, square.webp and square-focus.webp under every existing DECADE/VARIANT directory. No assets were replaced or deleted; all 98 original files, their metadata and canonical URLs are preserved. Each set now has eight image files. The added 96 files are exact reviewed copies, with no rendering or re-encoding during publication.

The category manifest is schemaVersion 2, using poster, posterFocus, square and squareFocus fields consistent with Discover. artworkSources.poster and artworkSources.square record each single source, its original hash, dimensions and crop. The 1970s poster-specific source override and the 1990s Terminator 2 choice are preserved. Existing artworkSources.cover/hero, heroYears, original approval and original delivery records are unchanged. formatExtensionApproval/Delivery and posterSquarePolicy describe this extension. counts now includes totalImageBytes; fingerprint retains the existing JSON.stringify({decades,rootCovers}) method. No general Builder reader or master index was added.

Exact review bindings: 4ac230174a675ed8efa916f6fa50bf1dab4cc848148d3c514cca75e1ebc28196. Manifest SHA-256: 39031d9b2b0ec1cd442146ca60cbbcc0b5598bc56d0b56dd29b56d73c395d932. Schema SHA-256: 70acd9e58d0c68e25a15c5c8d42b91684f66fbfd7173f54ae8ced85ddc8b8e81. Added bytes: 4,497,940; complete category: 16,024,420 bytes. Original files and metadata were backed up or hash-protected before installation.

Local release evidence is tools/studio-network-batch/.work/staging/decades-poster-square-all-v2/publication/: approval.json binds 96 stable keys to their final paths and exact hashes; publish-plan.json lists additions and preserved images; backup/ retains earlier manifest/schema/README and working documentation; preflight.json and protected-files.json preserve the initial state. Candidate and installed validators checked all 194 decoded image files, all 96 master hashes, 17 unique source hashes, 48 crops, original metadata equality, exact directory membership and 433 protected files. All 136 existing tests passed. The bundled Python lacked jsonschema; an isolated Ajv 8.17.1 validator was installed under ignored release storage and validated the draft 2020-12 schema and manifest. No project dependency files were changed. No unresolved validation failures remain.

This release changes only Decades images, category metadata/README, this handover and the Decades entry/shared role guidance. The preexisting Awards files, root README and .gitignore changes remain outside the commit. Actual display in Nuvio for the new shapes has not been tested. Next: finish Git publication and verify live stable URLs against the committed hashes; then record the completed release.


## Format release verification — 2026-09-07

Artwork release commit: 1d2b53407b434398b5acea57e7d06b2738086789. Live verification completed at 2026-09-07T10:04:01.512Z: all 194 stable image URLs, three stable metadata URLs (manifest, schema and README), and the three matching immutable metadata URLs returned the exact committed hashes. All 200 checks passed with no failures. The original tool-runner interruption happened after the successful push; the resumed connection completed verification without republishing images.

The manifest remains schemaVersion 2 at assets/collection_covers/decades/manifest.json. All 96 added WebPs match their reviewed bytes; all 98 original images and their stable URLs remain unchanged. Manifest SHA-256: 39031d9b2b0ec1cd442146ca60cbbcc0b5598bc56d0b56dd29b56d73c395d932. Schema SHA-256: 70acd9e58d0c68e25a15c5c8d42b91684f66fbfd7173f54ae8ced85ddc8b8e81. No new render, source acquisition, image or canonical-manifest writes occurred during final verification.

Evidence is saved in the existing ignored publication/ directory: git-publication-receipt.json, live-url-verification.json, installed-validation.json, schema-validation.json and handoff.json. All 433 protected files matched their saved hashes during completion. The 136 existing tests passed before release; no implementation changes required another test run. Only this handover and the Decades publication-map status changed in the completion commit. Unrelated Awards preparation, the root README and .gitignore edits are preserved outside these commits.

Next: no required publication work remains. Builder consumption and actual Nuvio display of poster/square shapes are separate follow-up work when requested; do not clear the existing Nuvio cache or replace its import as part of this completed release.

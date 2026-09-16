# Decades artwork handover

Last updated: 2026-09-17. Read the [shared workflow](../artwork-workflow.md) first.

## Current state

The full 144-file pearl-white cover/focus replacement is owner-approved and installed on work/decades-pearl-artwork-release for the requested commit, PR and merge process (2026-09-17). All original filenames, paths and canonical URLs are preserved; heroes, title logos and parent covers are retained. The final section records release status. Earlier layout and media-object studies are superseded.

The preceding single-hero release was published to main in commit 9e89b3b8ca9bfb951940f316181b799f8f7062ae. It replaced 24 montage heroes with single-title heroes and corrected the 2000s Movies landscape/focus pair. Seventy other set assets and two parent covers were retained. All 98 canonical artwork URLs stayed unchanged. The previous release is 8147e6dbac84ac4d2f1e8cfb80f164f8032bcf58.

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


## Library cohesion proof — 2026-09-17

The owner requested a new Decades proof to sit more comfortably beside Discover, Based on and Genre rows, questioning the translucent chrome. This authorises local proof work only. Existing published artwork, exact release approvals and canonical URLs remain unchanged. No publication, commit or push is authorised for these new bytes.

Current package: tools/studio-network-batch/.work/staging/decades-library-proof-v1/. Open review.html directly. It offers Pearl white / Matte silver / Current chrome, Landscape / Poster / Square, Movies / Series / Movies + Series, and Cover / Focus controls. The full-size image dialog links the WebP. The combined rows use exact existing Based on and Discover artwork plus the newer genre-colour-cards-v1 colour/type proposal. The 32 original Decades comparison files and 36 neighbouring-category references are exact local copies. This is an illustrative library layout, not a Nuvio rendering test.

Generated selection: 64 new WebPs, 3,209,406 bytes. All eight Mixed landscape sets have two finishes and matching focus (32 outputs). 1990s Movies and Series add both landscape finishes/focus (8 outputs). 1990s Movies, Series and Mixed also have both finishes/focus in poster and square (24 outputs). No other poster/square decades, Movies/Series landscape decades, parent covers, heroes or title logos were regenerated.

Proposed design:
- Keep Impact numerals and an explicitly smaller lowercase s. Pearl white is opaque #F5F5F0; matte silver is an opaque, gentle cool gradient without chrome/refraction, bevel or hard reflection.
- Landscapes retain 1200 x 675. The year is centre-left, at x=52 with visible height 151 px and a 458 px width limit. Three real-image panels sit to the right over #080B10 with a smooth left fade. The year has no added shadow.
- Posters remain 800 x 1200 and squares 800 x 800, with the existing independently cropped single-image sources. The year is left-aligned at x=64 over a lower fade; visible heights are 187 and 169 px respectively.
- Movies and Series retain their spaced Palatino captions, A DECADE OF CINEMA / A DECADE OF TV, now in restrained #B6C9D8 below the year. Mixed remains caption-free.
- Focus blurs the exact matching background and caption while preserving the solid year. All 32 lossless cover/focus pairs passed exact opaque-year pixel comparisons.

All 28 distinct source files were reused from existing verified caches; no TMDB/API requests, image generation or font downloads occurred. The 1990s Movies landscape uses Terminator 2, The Matrix and Toy Story; Series uses Friends, Buffy and The X-Files; Mixed uses Terminator 2, Friends and Toy Story. The 1950s Mixed montage reuses the clearer front-facing Lucy source from the parent-cover work. Other landscapes reuse the original movie/TV selections. The first sample and the pre-refinement Lucy/Titanic compositions are preserved in drafts/. Existing source-resolution limitations remain; this proof does not acquire new high-resolution originals.

Validation: 136 existing repository tests and Inter font check passed after granting required temporary-file access. All 64 outputs fully decode as WebP at the expected dimensions, with exact output/master/review-target hashes. All source hashes, bounded crops, 32 focus pairs, typography bounds and caption clearances pass. WebP quality 86, effort 6, smart subsampling; maximum RGB mean absolute error from the lossless master is 2.081. All 132 image references and every gallery control's data combination resolve, and gallery JavaScript parses. Visual review covered the full eight-decade board, library-context board, both finishes, portrait/square examples, all 1990s variants and a matching focus.

The gallery was opened through Codex open_in_codex. Automated browser inspection of the file URL was blocked by Browser Use URL policy, so no browser-interaction pass is claimed and no workaround was attempted. Local decoding, source/pixel checks, gallery syntax/data checks and direct artifact inspection passed. Nuvio client behaviour remains untested.

Preservation: 9,101 protected files retain exact hashes and modification times, including all public artwork, the prior Decades proof/release and the prior Genre type study. Two additional baseline documents changed independently in the Genre task: docs/artwork-categories/genre.md and docs/artwork-workflow.md. Their updated direction notes were inspected and preserved; concurrent-documentation-changes.json records both old and observed hashes without replacing the original baseline. This task did not edit those documents or the preexisting Awards work.

Evidence: render-report.json, review-bindings.json, baseline.json, reference-bindings.json, concurrent-documentation-changes.json, validation.json, final-git-status.txt. Visual summaries: library-overview.webp, all-landscapes.webp and overview.webp. Only this handover and the ignored proof package were written by this task. Public assets and canonical manifests have zero writes; no deletion, commit or push occurred.

Recovery: inspect current reports and preserve reviewed bytes before changing anything. render.cjs --only=DECADE-VARIANT-SHAPE can narrow a deliberate rerender; its default renders the whole proof selection. gallery.cjs refreshes references/review data and boards; library-board.cjs creates the library context board; verify.cjs validates the current package. refine.cjs and reconcile.cjs are completed one-time preparation steps and must not be rerun over this revision. Relative gallery paths work without a server.

Next concrete action: owner comparison of pearl-white and matte-silver finishes and the new landscape layout. Pearl white is the current recommendation, not an approval. Wait for direction before expanding the remaining media/shape sets or preparing publication.


## Custom landscape composition study — 2026-09-17

The owner selected the opaque pearl-white finish and rejected the smaller-left-year / three-squeezed-right-images composition. The new brief permits a full custom card redesign, retaining real imagery and fitting beside typography-only Genre cards and the existing library. Pearl white is an accepted finish direction; no layout, exact output, publication, commit or push is approved.

Current isolated package: tools/studio-network-batch/.work/staging/decades-layout-study-v2/. Open review.html. Three directions are compared:

- Cinematic: one full-frame real image with the pearl-white year at the lower left.
- Panorama: two wide blended photographic areas, with the year centred below the main faces. This is the current recommendation.
- Archive: a centred pearl-white year above two separate widescreen stills on a restrained dark colour ground.

All retain the small lowercase s. Movies and Series retain the spaced Palatino A DECADE OF CINEMA / A DECADE OF TV captions; Mixed has none. Focus keeps the exact pearl-white year sharp and blurs the matching imagery/caption. The finish is #F5F5F0, with no chrome or transparency.

Generated selection: 30 WebPs, 1,512,698 bytes: 15 landscape covers and 15 matching focus images. Every concept has 1980s/1990s/2000s Mixed examples and additional 1990s Movies and Series examples. All are 1200 x 675. Other decades, posters, squares, heroes, title logos and parent covers were skipped. The previous 64-file layout proof remains preserved.

Source reuse: 8 verified cached real-artwork files. Cinematic Mixed uses the movie source. Panorama/Archive Mixed pair Back to the Future with The A-Team, Terminator 2 with Friends, and The Fellowship of the Ring with Lost. 1990s Movies adds Jurassic Park for the two-image layouts; 1990s Series adds The X-Files. Crops, source URLs/hashes/dimensions and scale factors are in render-report.json. No external/API/image-generation requests or font downloads occurred.

QA refined only the A-Team and Lost panorama crops to retain important faces, preserving prior bytes under drafts/before-cast-crop/. A validation check found colour overshoot at resized type edges; the year layer was normalised to the accepted pearl RGB while retaining the resized alpha. All 30 files were rerendered for this correction. Prior bytes and masters remain under drafts/before-year-edge-normalisation/. No public files were touched.

The gallery compares the three concepts, toggles Movies/Series/Mixed and Cover/Focus, and switches the Decades row in the library context. A collapsible section retains the previous pearl-white layout. The 18 exact reference copies include the newer six-genre refinement direction (Action, Adventure, Romance and Science Fiction), current Based on and Discover, and previous Decades covers/focus. These are local illustrative rows, not actual Nuvio behaviour. The gallery was opened via Codex file preview; no browser-interaction validation is claimed because local-file browser inspection was blocked in the prior proof.

Validation passed: 136 repository tests; all 30 WebP decodes/dimensions/output/master/review-target hashes; 8 source hashes and bounded crops; 15 exact focus-year pixel comparisons; exact opaque pearl RGB, typography bounds and caption clearance; all 48 gallery image references and control-data combinations; gallery JavaScript syntax. WebP uses quality 86 / effort 6 / smart subsampling. Maximum RGB mean absolute error against lossless masters: 2.114. All three-concept/deacde boards, library context, media captions, revised cast crops and focus examples were visually inspected. No unresolved image or data validation failures remain.

Preservation: 8514 baseline files matched hashes and modification times before this handover update. The Genre handover and shared workflow changed independently while that task completed its six-genre refinement; both were inspected and preserved with old/observed hashes in concurrent-documentation-changes.json. The original baseline remains intact. This task changes only this Decades handover and its new ignored package; Awards work, published artwork/manifests, existing proofs and unrelated working files remain untouched. No deletion, publication, commit or push occurred.

Evidence: render-report.json, review-bindings.json, baseline.json, reference-bindings.json, concurrent-documentation-changes.json, validation.json, final-git-status.txt and README.md. Static boards: concepts-overview.webp and library-cinematic.webp / library-panorama.webp / library-archive.webp.

Recovery: render.cjs supports --only=DECADE-VARIANT-CONCEPT for a narrow intentional rerender. Preserve the current review bytes first. gallery.cjs refreshes local review artifacts; verify.cjs validates the current package. refine-crops.cjs, normalise-year.cjs and finish.cjs are completed one-time steps and must not be rerun over this revision. All artwork remains needs-review; publicationAuthorized is false.

Next: owner comparison of the three custom compositions. Once a layout is selected, refine that direction and consider other shapes/decades within the requested scope. Do not infer exact-output or publication approval from the accepted pearl-white finish.


## Era televisions and playback formats proof - 2026-09-17

The owner found the prior three-layout study still unsuitable and requested a new exploration: pearl-white year centre-left, with era television hardware or a playback format on the right containing a popular film from that decade. This is a request for a new proof, not approval of a layout or publication.

New local-only package: tools/studio-network-batch/.work/staging/decades-media-objects-v1/. The review.html page compares Through the screen (televisions) and On the shelf (formats), with Cover/Focus controls, full-size previews and an illustrative library context. Six Movies samples cover 1960s, 1980s, 1990s, 2000s, 2010s and 2020s. Reused films: 2001: A Space Odyssey, Back to the Future, Terminator 2, The Fellowship of the Ring, Avengers: Endgame and Spider-Man: Brand New Day.

Generated: 12 landscape covers and 12 matching focus assets, 24 WebPs, 579,686 bytes total. Each is 1200 x 675, WebP quality 86 / effort 6 / smart subsampling. The full decade uses Impact with a smaller lowercase s, opaque pearl-white #F5F5F0 at x=61/y=254 and visible height 149 px. A spaced Palatino A DECADE OF CINEMA caption sits below, baseline 449. Focus blurs the exact matching background and caption by 14 px, retaining the sharp year. No Series, Mixed, 1950s, 1970s, poster/square, hero, title-logo or parent-cover assets were generated.

TV housings progress through a wood cabinet, plastic CRT, rounded CRT, silver widescreen, slim LED and nearly frameless screen. Formats use a film reel/sleeve, VHS, LaserDisc, DVD, Blu-ray and a streaming tile/remote. All objects are original deterministic code-drawn mockups containing real existing film artwork. They are not AI-generated images, product photographs, exact model replicas or official release packaging. No new source-artwork requests or font downloads occurred.

These formats are visual associations, not an exclusive chronology: LaserDisc is a collector reference, the reel represents cinema, and DVD/Blu-ray overlap. The proposed GE 807 reference dates from 1949, so the 1960s television is generic. Historical references are recorded in the local README and review page (Radiomuseum GE 807; Computer History Museum optical laser disc; Science Museum television collection). The visual recommendation is to consider the formats because their silhouettes vary more clearly across the modern decades; the owner has not chosen either direction.

Library references: 12 exact copies of the latest genre-original-type-colour-v3 samples and existing Based on/Discover artwork. Other category files were not modified. comparison-sheet.webp and library-television.webp / library-format.webp show all twelve compositions and the neighbouring rows. This is an illustrative layout, not Nuvio display acceptance.

Validation passed: 136 existing repository tests before generation; all 24 WebP decodes/dimensions/byte counts/output/master hashes; six source hashes and bounded crops; twelve exact cover/focus year-pixel checks; opaque pearl RGB, year bounds and caption clearance; exact proposed targets against the published category manifest; 12 reference bindings; 36 gallery image paths and every direction/decade/role data combination; gallery JavaScript syntax and static local links. Maximum RGB mean absolute error against lossless masters: 1.151. All covers were visually reviewed on the comparison board, four full-size samples, the VHS focus and the library context. Browser interactions were not exercised; local-file browser inspection was blocked in the preceding proof. No Nuvio test is claimed.

Preflight retained the existing dirty .gitignore, README, Decades/shared workflow edits and unrelated untracked Awards/Genre work. Before this handover append, 8754 protected files matched their baseline hashes and modification times. Two concurrent Genre documentation updates (focus design discussion and shared status row) were inspected and recorded separately with original/current hashes, preserving the original baseline. After this expected handover edit, 8753 remain identical. This task changes only this handover and its new ignored proof package. Published assets/manifests, preceding proof packages and unrelated work remain unchanged. No deletion, final-asset writes, canonical-manifest writes, publication, commit or push occurred. Final Git-status path list matches preflight.

Evidence: render-report.json, review-bindings.json, baseline.json, handover-before.md, reference-bindings.json, concurrent-documentation-changes.json, validation.json, final-git-status.txt and README.md. The exact candidates remain needs-review, with publicationAuthorized false.

Recovery: open review.html directly. Do not rerun render.cjs over reviewed bytes; further design changes belong in a new revision. gallery.cjs rebuilds local review artifacts and verify.cjs validates the package. record-context.cjs is a completed one-time context capture, not a way to reconcile unknown changes. Next: owner review of the television versus format concept before extending or refining a chosen direction.


## VHS silhouette correction - 2026-09-17

The owner is receptive to the formats direction but found the 1980s mockup too similar to an audio cassette. New proof package: tools/studio-network-batch/.work/staging/decades-media-objects-v2/. Open review.html#1980s; it defaults to the formats view. This is a local correction, not publication approval.

Only the 1980s Movies format cover/focus pair was regenerated: 36,134 and 11,470 bytes respectively, both 1200 x 675 WebP with the existing quality-86 encoding. The illustrated tape is wider, with two separate tall reel windows, a central cream film label, a long hinged top flap, lower grip ribs and VHS markings. The shared window and bottom trapezoid that suggested an audio cassette were removed. The sleeve, real Back to the Future artwork, year, caption, colours and overall layout are retained. A Wikimedia VHS top-view image was consulted for geometry only; no source photo was downloaded or included, and no AI image generation was used.

All other 22 proof exports, their lossless masters and the twelve neighbouring-category references are byte-identical copies from v1. The full gallery now totals 586,664 bytes of candidate artwork. Original v1 and all published artwork/manifests remain untouched. Other decades, media variants, poster/square, hero and title-logo assets were skipped.

Validation passed: 136 existing repository tests; all 24 exports/hashes/dimensions/source/review-target checks; exact hashes for the 22 retained outputs and masters; pixel-identical year/caption and upper sleeve; all twelve focus/year checks; gallery data/links/syntax and reference bindings. Both revised files were visually inspected at full size. Before this handover append, all 8288 protected baseline files matched hashes and modification times; afterwards 8287 remain identical with this expected handover change. No concurrent documentation changes occurred during this bounded revision. Browser interaction and Nuvio display were not tested. No unresolved failures.

Evidence: revision.json, render-report.json, review-bindings.json, baseline.json, handover-before.md, reference-bindings.json, validation.json and final-git-status.txt. Existing dirty/untracked repository work was preserved, with unchanged preflight/final Git-status paths. Changes are this handover, the new ignored package and its ignored setup script. No final-asset or canonical-manifest writes, deletion, publication, commit or push.

Recovery: do not rerun the one-time setup or finish-revision.cjs over reviewed bytes. verify.cjs can revalidate the package. Further visual changes belong in a new revision. Next: owner review of the corrected VHS appearance.


## Media-object direction stopped; original composition / pearl fill proof - 2026-09-17

The owner stopped the media-object replacement release and then agreed to test a return to the original montage with only a pearl-white year fill. The earlier publication/commit/push authorisation for the format-object design was withdrawn. Do not publish the media-object proofs or the expanded decades-format-library-v1 candidate. That stopped package contains 144 staged cover/focus assets and a candidate manifest/replacement plan, but it was not published, committed or pushed; its final end-to-end release validation was not completed before the stop. All public assets remain unchanged.

Current active proof: tools/studio-network-batch/.work/staging/decades-original-pearl-v1/. Open review.html for the original/proposed comparison; comparison.webp is the side-by-side sheet. Scope is intentionally one decade and variant: 1990s Movies landscape cover and matching focus. Two new 1200 x 675 WebPs total 82,828 bytes, quality 86 / effort 6 / smart subsampling.

This is a fill-only edit. The exact original Impact mask (990 x 318 at x=105/y=236, including its original lowercase s) is recoloured opaque #F5F5F0 over verified lossless original masters. Both input master hashes match the sourceSha256 fields in the current published manifest. The five-image montage, source crops, fades, text shape/size/position, surrounding rim/shadow, caption and original focus blur remain unchanged. The two before references are exact current published WebPs. No source acquisitions, font downloads or AI generation occurred.

Validation passed: 136 existing repository tests; two output/master hashes, WebP decoding/dimensions/quality; five source-image hashes; locked original font hash; original-reference/master hashes; 598,366 exact unchanged master pixels outside the year fill in each image; 191,190 opaque pearl pixels in each image and exact corresponding focus/year pixels; static gallery links. Maximum RGB mean absolute error after WebP encoding: 1.288. Cover comparison and focus were visually inspected. No actual Nuvio or browser-interaction test is claimed.

Before this handover update, all 8814 protected baseline files matched hashes and modification times; afterwards 8813 remain identical with this expected handover edit. Existing dirty .gitignore/README/shared workflow and untracked Awards/Genre work are preserved. Only this handover and the new ignored proof package changed. All other decades/variants/shapes, heroes, title logos and parent covers were skipped. No public asset/manifest writes, deletion, publication, commit or push. Final Git-status paths match preflight.

Evidence: render-report.json, review-bindings.json, baseline.json, handover-before.md, validation.json, final-git-status.txt and README.md. Both new files are needs-review; no publication approval is inferred from the earlier abandoned direction.

Recovery: do not rerun render.cjs over reviewed bytes. verify.cjs can revalidate the proof. Next: owner comparison of this single fill change before any wider generation or release.


## Original composition with pearl-white fill approved - 2026-09-17

The owner approved the decades-original-pearl-v1 proof. The selected Decades treatment is the original artwork/layout with only the year fill changed to opaque pearl-white #F5F5F0. Retain the original source images/crops, montage fades, font, year geometry, surrounding rim/shadow, subtitle and matching focus treatment. The media-object direction remains abandoned.

Local owner-approval.json binds the approved 1990s Movies landscape and focus to their exact hashes and existing publish targets. Landscape SHA-256: 459ce64e75f9be9500a30501f77bf56762d3f875c35924357c91685381cfd6dd. Focus SHA-256: 7952798d8b9385831ae41a5a5adce69aa9660e32b2b449d1137e793ac9aa4fac. The earlier needs-review bindings remain historical; this new approval record supersedes their review status for those two exact files.

This confirms the design and reviewed pair. It does not authorise publishing an unrendered wider set or revive the withdrawn media-object commit/push permission. No new artwork was generated for this acknowledgement; both staged hashes were rechecked. Existing image validation and 136-test pass remain applicable. Only this handover and the local approval record changed; existing working changes and public assets/manifests are preserved. Git-status paths are unchanged. No publication, commit or push occurred.

Next: carry the same fill-only change forward to the broader Decades set when the rollout is requested, using verified original masters and exact-output bindings; do not redesign or regenerate unrelated imagery.


## Full original-composition pearl expansion - 2026-09-17

The owner requested expansion of the approved fill-only treatment to all decades and matching focus. The complete staged proof is tools/studio-network-batch/.work/staging/decades-original-pearl-all-v1/. Open review.html to select Movies, Series or Movies + Series and Landscape, Poster or Square. Every view displays cover/focus pairs and can switch to exact copies of the published original chrome for comparison.

Selection: all eight decades, all three media variants, all three cover shapes and their matching focus, totalling 144 WebPs / 72 pairs. Generated 142 new exports and retained the two approved 1990s Movies landscape/focus exports and masters byte-for-byte. Runtime candidates total 6,973,886 bytes, quality 86 / effort 6 / smart subsampling. Dimensions remain landscape 1200 x 675, poster 800 x 1200 and square 800 x 800. No heroes (24), title logos (24) or parent covers (2) were regenerated.

This is the approved original design, not the rejected left-year or media-object layouts. Only the exact original year fill becomes opaque #F5F5F0. Original images, crops, fades, Impact geometry/lowercase s, rim/shadow, captions and focus blur remain unchanged. Every source master matches sourceSha256 in the current published category manifest. The corrected 2000s Movies landscape/focus masters come from decades-revision-v1/revised; other landscape masters come from decades-artwork-v1. Poster/square masters come from decades-poster-square-all-v2, preserving its approved alternative Star Wars poster. Input hashes and exact geometry are recorded in input-plan.json and render-report.json.

Validation passed: 136 existing repository tests, locked Impact font hash, all 144 source-master/output/master/reference hashes, WebP decoding and dimensions, 72 exact opaque-year cover/focus pixel comparisons, and pixel-for-pixel preservation outside the year fill in every lossless master. Maximum mean absolute RGB error after WebP encoding is 2.303. All 288 candidate/reference gallery images resolve, all nine media/shape views are complete, and gallery JavaScript parses. Nine paired contact sheets cover the complete collection and were visually inspected. Full-size inspection additionally covered the corrected 2000s Movies landscape, 1950s Mixed focus and 2020s Series square. Browser interactions and actual Nuvio display were not tested.

Preflight retained dirty .gitignore, README, this handover and shared workflow, plus unrelated Awards and Genre preparation. Before the handover update, all 8,980 protected files retained their original hashes and modification times; afterwards 8,979 remain identical with this expected handover edit. No concurrent changes occurred during this generation/validation window. The new ignored proof package and this handover are the only task writes. Final Git-status paths match preflight. Zero public-asset/canonical-manifest writes, deletions, commits or pushes; no unresolved failures.

Evidence: input-plan.json, render-report.json, review-bindings.json, baseline.json, handover-before.md, validation.json, visual-review.json and final-git-status.txt. The two copied approved files retain owner-approved review status; the other 142 exact outputs await owner review. The approved design direction does not revive the withdrawn publication permission for media objects.

Recovery: do not rerun render.cjs over completed/reviewed outputs; it refuses a completed revision. gallery.cjs only rebuilds local review artifacts; verify.cjs revalidates the complete proof. The original masters and all earlier proofs, including the stopped media-object package, remain preserved. Next: owner review of the expanded collection, then explicit publication authorisation before installing replacements at existing URLs and updating canonical metadata.


## Approved pearl-white replacement release - 2026-09-17

The owner approved the full decades-original-pearl-all-v1 gallery and explicitly authorised replacement through a branch, commit, pull request and merge. All 144 reviewed output hashes are bound to their unchanged stable keys, roles and targets in the local publication/owner-approval.json. This approval supersedes the needs-review statuses in the original proof bindings. No artwork was regenerated or re-encoded for publication.

Preflight: main and origin/main both resolved to 8f76a7b after fetching. The newly merged Genre release is retained. The release branch is work/decades-pearl-artwork-release. Existing unrelated .gitignore, root README and untracked Awards preparation are preserved and excluded from the release. The existing Decades handover edits are included so the approved direction and abandoned experiments remain recoverable.

Installed selection: 144 replacements (landscape, focus, poster, posterFocus, square and squareFocus for eight decades x Movies/Series/Mixed), totalling 6,973,886 bytes. No added or deleted images. Fifty retained images comprise 24 heroes, 24 title logos and two parent covers. All 194 filenames, paths, URLs, identities, role names and dimensions remain unchanged. Current total artwork size is 16,736,762 bytes. The schema remains version 2. Asset hashes, source-master hashes, byte counts and encoding records are refreshed; the manifest fingerprint is recalculated. New coverReplacementApproval and coverReplacementDelivery metadata record this release while prior approval/delivery history is retained. Image-source records are unchanged.

Validation: 136 repository tests passed. Candidate and installed manifests pass JSON Schema 2020-12 validation. All 194 images fully decode and match dimensions, lengths and manifest hashes. All 144 replacements match their exact reviewed bytes and lossless-master hashes. The proof pixel/visual validation remains applicable because no reviewed image changed. The fifty retained assets and their metadata are identical. All 8,701 protected files match the publication baseline, including the new Genre assets and unrelated working files. Zero path/URL changes, no missing or extra category files, and no unresolved failures. Actual Nuvio cache/display behaviour remains outside this release validation.

Changed tracked scope: the 144 existing image files, Decades manifest/schema/README, this handover and the Decades row in the shared workflow (149 paths). Source backups, exact approval, publish plan, candidate/installed validation and preflight are retained under tools/studio-network-batch/.work/staging/decades-original-pearl-all-v1/publication/. No existing ignored proof was removed.

Next: review the branch diff, commit only the 149 release paths, push the branch, create and merge its PR after checks, fast-forward local main and verify the live manifest/artwork hashes. Update this section with the PR and completion evidence. Keep stable URLs; do not clear Nuvio caches or modify Builder imports as part of publication.

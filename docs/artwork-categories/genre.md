# Genre artwork handover

Last updated: 2026-09-17. Read [the shared workflow](../artwork-workflow.md) first.

## Scope and identity

Category key: genre. The owner selected original lettering on photo-free colour cards, separate photographic heroes, and focus treatment A. The release supplies eight roles for all 31 genres (248 WebPs): landscape/focus, poster/posterFocus, square/squareFocus, titleLogo and hero. Stable keys, TMDB genre IDs, editorial distinctions and source-film identities remain in the preserved genre-full-v1 package. These are shared artwork sets without Movies/Series/Mixed variants; source titles do not define collection membership.

Release record: [PR #18](https://github.com/davecollections/nuvio-assets/pull/18); artwork commit [50d05d7](https://github.com/davecollections/nuvio-assets/commit/50d05d7590a25f500cc77826ed1c7a932dd9b7df). The PR records merge status and subsequent live URL verification. [Canonical manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/genre/manifest.json).

## State and next action

State: the authorised Genre release supplies 248 WebPs across 31 complete eight-role sets, replacing all 62 legacy JPGs. All eight images now live together in each genre folder with explicit shape filenames. The category authority is assets/collection_covers/genre/manifest.json, schemaVersion 2, with a strict sibling schema. It records exact URLs, dimensions, byte counts, source hashes, role bindings and every retired-path replacement. The selected original lettering, colour cards, A focus and photographic heroes are delivered byte-for-byte from genre-focus-full-v1. The owner authorised branch, commit, push, PR and merge. General Builder integration and actual Nuvio display acceptance remain absent.

Next: consumers should use the role URLs in the Genre category manifest and migrate old JPG references using retiredLegacyFiles; migrate the earlier WebP layout using relocatedFiles. These mappings are not redirects. Actual Nuvio display/crop acceptance and general Builder integration are separate work. Preserve the published paths and reviewed output hashes for later refreshes.

## Design and delivery contract

Selected design: photo-free cards with muted genre colours, quiet abstract contours and the original distinctive lettering, including case, cuts and ornaments. Photographic heroes remain separate. Focus treatment A adds a genre-coloured outer halo and background colour lift while preserving letter geometry and opaque fill. The complete stage now includes matching focus artwork for all three card shapes. Earlier studies and photographic covers remain preserved. No generated scene imagery or font downloads.

| Role | Dimensions | Format | Published path |
| --- | --- | --- | --- |
| Poster | 800 x 1200 | WebP | assets/collection_covers/genre/SLUG/poster.webp |
| Square | 800 x 800 | WebP | assets/collection_covers/genre/SLUG/square.webp |
| Landscape | 1200 x 675 | WebP | assets/collection_covers/genre/SLUG/landscape.webp |
| Landscape focus | 1200 x 675 | WebP | assets/collection_covers/genre/SLUG/landscape-focus.webp |
| Poster focus | 800 x 1200 | WebP | assets/collection_covers/genre/SLUG/poster-focus.webp |
| Square focus | 800 x 800 | WebP | assets/collection_covers/genre/SLUG/square-focus.webp |
| Title logo | 1863 x 673 | Transparent lossless WebP | assets/collection_covers/genre/SLUG/title-logo.webp |
| Hero | 2560 x 1440 | WebP | assets/collection_covers/genre/SLUG/hero.webp |

Heroes retain the accepted photographic selections from the earlier photo-card proof. Romance uses Titanic; Horror and Science Fiction retain their original film selections. Current cards are typography-only. No hero has a baked-in title or added fade. Combined previews are illustrations, not Nuvio evidence.

## Manifest and builder contract

Category authority: assets/collection_covers/genre/manifest.json, schemaVersion 2, kind genre-artwork. It supplies 31 stable genre keys and all eight roles, with a strict manifest.schema.json. The 62 old JPG paths are retired by the authorised replacement; their hash-bound mappings are in retiredLegacyFiles. All eight role files live below each stable genre slug. The former wide/vertical folders and generic focus.webp filenames are retired; relocatedFiles maps their 93 previous WebP paths directly to current targets. Original JPG migration mappings also resolve directly to current targets. All image hashes are unchanged. No shared master index, studio/network runtime entry or general Builder integration is added.

## Review and publication evidence

Approved complete review package: tools/studio-network-batch/.work/staging/genre-focus-full-v1/. Its owner-selection.json binds the twelve original A proofs and review-bindings.json covers all 93 focus outputs. The later complete-release authorisation supersedes their earlier needs-review state. Release evidence in tools/studio-network-batch/.work/staging/genre-release-20260917/publication-approval.json records the initial publication targets. The owner subsequently authorised the grouped folder layout; tools/studio-network-batch/.work/staging/genre-layout-20260917/publication-approval.json and reviewed-bindings.json bind all 248 unchanged hashes to the current targets. Base cards come unchanged from genre-original-type-colour-v3; original title logos and heroes trace back to genre-full-v1. Earlier source-photo selection, crop evidence and proofs remain preserved. The milestone sections below describe historical states; the current release contract above takes precedence.

Preflight: 136 repository tests passed and Inter font check confirmed after rerunning with required temporary-file access. The initial sandbox-only EPERM failures were environmental and resolved.

## Recovery notes

Sources, masters, review gallery, render scripts, hashes and local review evidence are ignored and may be absent in another checkout. This handover is part of the Genre publication. Do not rerun prepare.cjs over a completed revision. Inspect source-plan.json and review bindings before any revision; use a new revision directory for changed artwork. Do not publish, commit, push, delete or regenerate other categories.

## Completed proof milestone — 2026-09-08

Fifteen runtime proofs are in assets/SCIENCE-FICTION|HORROR|ROMANCE/ within the ignored package (actual directory slugs are lowercase). Total: 2,555,708 bytes. Each genre supplies poster, square, landscape, transparent title-logo and hero. No other genres or focus variants were generated. No public artwork or canonical manifest writes, no deletes, no commits and no pushes occurred. All 62 legacy genre covers and all unrelated assets remain preserved.

The real images are verified against exact TMDB movie identities and genre IDs. Source acquisition reused the existing La La Land metadata and made two metadata requests, 36 preview-image downloads and six selected original-image downloads. Sources are recorded with URLs, image paths, identities, hashes and dimensions in selected-sources.json. This proves TMDB source provenance, not a separate rights-holder audit of uploads. No AI imagery, font downloads or sibling-repository writes were used.

Final design: Science Fiction uses Century Gothic Bold with geometric spacing and narrow horizontal letter cuts, with a cyan accent. Horror uses stretched Impact, thin vertical cuts and red accents. Romance uses italic Palatino with a drawn underline and a rose accent. The shared dark ground is #080B10, lettering is pale #F5F5F0, with a short top-left accent and a fine lower rule. Portraits reserve a lower title area with a smooth fade; landscape subjects sit right of the title. Full source crop/placement records are in render-report.json. The three covers for each genre share one source, with manually selected crops and no upscaling.

Heroes use different photos from the same films, no baked-in title and no added fade. The Romance hero is horizontally mirrored to keep the couple on the right. Other sources are not mirrored. Hero/source pixel parity is verified against those exact deterministic transforms. Title logos use transparent lossless WebP, with visible pixels and alpha matching the retained PNG master. Colour testing accounts for alpha on antialiased edge pixels.

The first nine cover drafts remain under revisions/initial-crops/. All nine covers were refined to improve image-to-title transitions and preserve character expressions in landscape. The initial Romance hero remains under revisions/romance-hero-before-mirror/. Only that hero was then revised; the other fourteen output files were retained. New final outputs remain needs-review; source selection and internal visual QA do not imply owner approval.

Review entry: review.html. The current localhost URL and hidden server PID are in server-info.json. overview.webp compares posters and landscapes; previews/SLUG-board.webp shows all five formats; family-comparison.webp shows four current published references. previews/SLUG-hero-logo.webp illustrates a separate logo over a faded hero, not actual Nuvio behaviour. No claim of client crop acceptance or Builder integration is made.

Validation: all fifteen WebPs decode at the required dimensions, with exact output/master/review-target bindings; six sources and twelve source crops/transforms passed. All three lossless logos passed transparency and pixel checks. Lossy WebPs pass block and detail SSIM >= 0.97 and RGB mean absolute error <= 2 against the lossless master, using the first passing quality in 82/88/92/96/100. No source crop is upscaled. Validation protects hashes and modification times of 8,402 preexisting files, including 8,136 files under assets/. Only this handover and the shared workflow are exempted from the baseline. The existing 136 repository tests and Inter availability check passed. Initial verification assumptions about low-alpha RGB values and requiring more empty space than lettering were corrected after inspecting the actual antialiased and heavy Horror glyph pixels; all final checks pass.

The local gallery returned 23 exact byte-matching responses. Browser review verified poster/square/landscape controls, the combined Romance hero preview, 22 successfully loaded images and no horizontal overflow at the tested desktop viewport. The gallery was left on Poster. Nuvio itself was not exercised. Evidence: validation.json, gallery-validation.json, browser-review.json, review-bindings.json and render-report.json.

Reproduction, from repository root (inspect before rerunning; keep approved/reviewed bytes frozen in a fresh revision):

    node tools/studio-network-batch/.work/staging/genre-proof-v1/render.cjs --only=SLUG
    node tools/studio-network-batch/.work/staging/genre-proof-v1/render.cjs --covers-only
    node tools/studio-network-batch/.work/staging/genre-proof-v1/gallery.cjs
    node tools/studio-network-batch/.work/staging/genre-proof-v1/verify.cjs

prepare.cjs, refine.cjs and refine-hero.cjs record completed one-time steps and must not be rerun over this package. Restart server.cjs hidden if the review URL stops responding. The render uses the existing skia-canvas installation and the read-only codec helpers in the earlier Decades proof; their originals were not changed. final-git-status.txt records the exact final status. Tracked-scope changes are this new handover and the Genres row in docs/artwork-workflow.md; the preexisting Awards working tree remains unchanged.

## Full-set expansion authorised — 2026-09-08

The owner accepted the design and requested the complete existing genre set, with the Romance hero changed to a different film from its cover. All 31 legacy genres are now in scope, each with five roles (155 final staged files). Preserve the fourteen accepted proof outputs exactly. The Science Fiction and Horror hero choices remain accepted; the new genres and revised Romance use different title identities for cover and hero. This authorises generation and review, not publication, commit, push or retirement of the 62 legacy files.

Current package: tools/studio-network-batch/.work/staging/genre-full-v1/. plan.json defines the 31 stable keys and source candidates; acceptance.json binds the fourteen retained hashes to their intended targets. The original genre-proof-v1 package is preserved. Membership remains distinct from artwork: source titles illustrate the genre, not collection filters. Disaster, Queer, Rom Com and Musicals are editorial categories; the TV-only genre IDs are recorded separately from movie genre IDs. No additional media variants are being introduced.

State: the owner has endorsed the original lettering on photo-free colour cards in genre-original-type-colour-v3 as the working design direction, and has requested consideration of matching focus artwork. The package contains 93 cards, 31 exact original title logos and retained photographic heroes. Focus artwork is not yet generated or selected. Earlier studies remain preserved. This design endorsement does not authorise publication, commit, push or Builder integration; Nuvio display remains untested.


## Completed full set — 2026-09-08

All 31 legacy categories now have five staged WebPs, totalling 34,933,630 bytes. Generated selection: 140 outputs for the 28 additional genres and one replacement Romance hero; retained selection: all five Science Fiction outputs, all five Horror outputs and the four Romance cover/logo outputs, exactly matching the accepted hashes. No genres were skipped or left incomplete. Narrow internal QA revised the three Drama covers, three TV Movie covers and Thriller poster/square; prior versions remain under revisions/qa-framing/. No unrelated category was regenerated.

Romance uses La La Land covers and the unmirrored Titanic bow scene for the hero. Horror and Science Fiction retain their accepted same-title image pairs. The other 29 sets use different title identities for cover and hero. Music cover imagery is mirrored for framing; sources and transform flags are recorded. The shared dark framing, margins, accent rules and pale lettering match the proof. New genres use installed Inter, Century Gothic, Impact, Palatino, Georgia and Courier typography with restrained genre-specific treatments; eight local font-file hashes are recorded. No font files were downloaded or committed.

| Genre | Cover title | Hero title |
| --- | --- | --- |
| Action | Mad Max: Fury Road | Mission: Impossible - Fallout |
| Action & Adventure | The Last of Us | The Mandalorian |
| Adventure | Raiders of the Lost Ark | Jurassic Park |
| Animation | Spider-Man: Into the Spider-Verse | Toy Story |
| Comedy | The Grand Budapest Hotel | The Hangover |
| Crime | The Godfather | GoodFellas |
| Disaster | The Day After Tomorrow | Twister |
| Documentary | Free Solo | Planet Earth II |
| Drama | The Shawshank Redemption | The Green Mile |
| Family | Paddington 2 | E.T. the Extra-Terrestrial |
| Fantasy | The Lord of the Rings: The Fellowship of the Ring | The Chronicles of Narnia: The Lion, the Witch and the Wardrobe |
| History | Oppenheimer | Lincoln |
| Horror | The Shining | The Shining |
| Kids | Bluey | Sesame Street |
| Music | Whiplash | Bohemian Rhapsody |
| Musicals | Singin' in the Rain | The Greatest Showman |
| Mystery | Knives Out | Rear Window |
| News | 60 Minutes | Newsnight |
| Queer | Moonlight | Brokeback Mountain |
| Reality | Survivor | The Amazing Race |
| Rom Com | When Harry Met Sally... | 10 Things I Hate About You |
| Romance | La La Land | Titanic |
| Sci-Fi & Fantasy | Stranger Things | Game of Thrones |
| Science Fiction | Blade Runner 2049 | Blade Runner 2049 |
| Soap | The Bold and the Beautiful | Dynasty |
| Talk | The Graham Norton Show | The Tonight Show Starring Jimmy Fallon |
| Thriller | Se7en | The Silence of the Lambs |
| TV Movie | High School Musical | Duel |
| War | Saving Private Ryan | Apocalypse Now |
| War & Politics | Band of Brothers | The West Wing |
| Western | The Good, the Bad and the Ugly | Unforgiven |

Source provenance: 58 TMDB metadata requests, one cached metadata reuse, one focused Newsnight identity search, 232 preview downloads and 58 selected-original downloads including the Drama refinement. Five original-proof sources were copied unchanged. The final set has 62 source bindings. An initial incorrect Newsnight candidate (tv:8416, The Little Nyonya) was rejected; verified Newsnight is tv:841. Days of Our Lives was considered but Dynasty was selected for Soap because of image quality. The unused source evidence remains preserved. Source identity/hash checks establish TMDB provenance, not a separate rights-holder audit of uploads.

Category notes: Disaster, Musicals, Queer and Rom Com are editorial categories. The Last of Us and The West Wing illustrate Action & Adventure and War & Politics respectively despite current TMDB Drama-only classifications; the editorial choices are recorded explicitly. No artwork selection changes a Builder filter or creates a runtime genre mapping.

Quality: all 155 WebPs decode at the contracted dimensions. All 31 transparent logos pass visible-pixel and alpha parity against retained PNG masters. All 124 photo/crop records pass source binding and crop-bound checks; all 31 hero transforms reproduce exact master pixels. Photo exports meet block/detail SSIM >= 0.97 and RGB mean absolute error <= 2. Disaster and Reality poster/square use lossless WebP after all lossy qualities failed the detail gate. Newsnight alone uses a 1920 x 1080 original resized 1.333x to 2560 x 1440; the source-resolution limitation is visible in its review details. No other source is upscaled. No unresolved generation or validation failures remain.

Review: twenty format contact sheets cover every output, 31 illustrative hero/logo previews show separate roles together, and overview.webp samples twelve sets. The review gallery provides all five format views, genre search and five-format detail dialogs. Combined previews are illustrative; Nuvio rendering itself remains untested. Local server URL and PID are in server-info.json.

Validation preserves all 8,541 protected preexisting files including 8,136 public assets, 62 legacy genre JPGs, the original proof package and preexisting Awards work. All 136 repository tests passed and Inter availability was confirmed. All 209 gallery resources return the exact staged bytes. Browser checks covered five format switches, case-insensitive search, Romance and News detail dialogs, image loading, close behaviour and desktop overflow. Evidence: validation.json, gallery-validation.json, browser-review.json, render-report.json, review-bindings.json and final-git-status.txt.

Only this handover, the Genres row in the shared workflow and the ignored genre-full-v1 package were changed for this expansion. There were zero final/public asset writes, canonical manifest writes, deletions, commits or pushes. Final git-status paths match preflight.

Recovery: inspect the current report before making changes. Do not rerun prepare.cjs, acquire.cjs, extra-sources.cjs, select.cjs, build-renderer.cjs or qa-framing.cjs over completed work. Preserve prior bytes before a targeted rerender. render.cjs accepts --only=SLUG and --roles=ROLE,ROLE; the fourteen accepted outputs are retained by the renderer. gallery.cjs regenerates review artifacts; verify.cjs checks the complete current set. Restart server.cjs with a hidden process if its localhost URL has expired. These scripts are ignored local evidence, not published category infrastructure.


## Typography cohesion study — 2026-09-17

Owner direction: keep the liked image choices and differences between genres, but make the titles read as one collection when adjacent. This supersedes the earlier title treatment as the active design question without changing or deleting the old output files. The exact 31 liked hero hashes are recorded in owner-direction.json; all revised cover/logo hashes remain needs-review in review-bindings.json.

Current proposal uses the existing distinct installed typefaces, consistent uppercase labels, measured visible letter heights, a common left edge and shared lower alignment. Condensed action lettering, italic romance lettering, literary serifs, geometric science-fiction lettering, and the small horror/military/science-fiction letter cuts remain. Extra underline/diamond/equalizer decorations and artificial height stretching were removed. TV Movie becomes a single line; the four long compound labels retain two lines. Titles are scaled by visible letter height with a width limit, instead of making every word fill its entire available rectangle. Longer words may reduce within that limit.

Layout record: poster left 64 px / lower edge 1105 px / target cap height 92 px; square 64 / 727 / 86; landscape 52 / 612 / 82; transparent title-logo 120 / 523 / 205. Poster cap heights span approximately 70.5–92 px after long-word fitting. Font shapes are not horizontally stretched. All role dimensions, source crops, image placement, fades, accent colours and rules remain as before. The comparison includes separate illustrative Hero + title views; they are not Nuvio evidence.

Generated selection: poster, square, landscape and transparent title-logo for all 31 stable genre keys, exactly 124 revised WebPs. Retained selection: 31 heroes, byte-identical to the prior set. No genre skipped; no unrelated category regenerated. Total current asset bytes: 34,364,358. The 155 previous WebPs and 31 prior hero/logo previews are also copied into original/ solely for comparison. Every file in the original genre-full-v1 package remains untouched. No new source images or fonts were requested.

Validation passed for all 155 current assets, all 31 transparent logos and all exact review-target bindings. All 93 cover source/crop/placement records match the prior set, and pixels outside the union of the old/new title-and-shadow regions match the prior lossless masters exactly. All 31 heroes match prior output and master hashes. Photo encodings pass the existing quality gates; Disaster and Reality poster/square again use lossless WebP. The existing News hero resolution note is retained. All 136 repository tests pass; Inter availability was rechecked. There are zero unresolved render or validation failures.

Preservation: hashes and modification times pass for 9,238 protected preexisting files, including 8,136 public assets and the prior full-set working package. Preflight and final Git-status path lists are unchanged. The only tracked-scope edits are this handover and the Genres row of docs/artwork-workflow.md; the new renderer, masters, comparison copies, gallery and evidence are ignored local work. No final/public asset or canonical-manifest writes, deletions, commits or pushes occurred.

Review evidence: render-report.json, owner-direction.json, review-bindings.json, baseline.json, validation.json, gallery-validation.json, browser-review.json and final-git-status.txt. Sixteen contact sheets cover the four revised roles. overview.webp shows eight representative revised posters. The gallery serves 391 exact byte-matching resources. Browser checks cover all 18 version/format combinations, case-insensitive search, a loaded Romance original/revised dialog and its asset links, modal closing, and no horizontal overflow at 1280 x 720. It is left on Revised / Posters with all 31 genres shown.

Recovery: inspect this new package before changing typography. prepare.cjs is a completed one-time preservation snapshot and must not be rerun. render.cjs defaults to skipping completed rows; --only=SLUG,SLUG narrows any intentional rerender (preserve old bytes first). gallery.cjs refreshes comparison artifacts; verify.cjs validates output and preservation. Restart server.cjs hidden if the local preview expires; its current URL/PID are in server-info.json. All source files, original reports and the installed canvas/codec dependencies are read from the preserved prior packages. These ignored artifacts remain local-only.


## Combined collection browsing preview - 2026-09-17

The owner requested the revised Genres alongside Based on, Discover and Decades as one scrollable setup. The isolated local package is `tools/studio-network-batch/.work/staging/collection-library-preview-v1/`; enter through `review.html`. Four horizontal collection rows support Landscape, Posters, Squares and Titles. Discover and Decades can independently switch between Mixed, Movies and Series. Selecting a card opens its existing hero and separate transparent title logo; arrows navigate within the row, Escape closes, and the banner can be hidden for comparison.

The preview copies 400 existing WebPs across 80 sets (31 Genres, 10 Based on, 15 Discover, 24 Decades), without re-rendering artwork. Initial Mixed view displays 54 cards. Genres uses `genre-type-study-v2`; the other categories use their current schemaVersion 2 manifests. Focus roles and Decades parent covers are not used in this five-role preview and remain preserved. All originals, four source reports/manifests, copied assets and 404 local HTTP responses passed hash checks. Browser verification covered the four formats, three media variants, row/keyboard navigation, hero/logo display, modal dismissal and desktop overflow, with no remaining failures.

The package has relative paths and opens directly in a browser without a server; this avoids dependency on a temporary localhost session for later review. An optional `server.cjs` starts the localhost view and reuses the saved port in `server-info.json`. Full usage, source hash bindings, browser checks, validation and unchanged preflight/final Git status are retained as ignored local evidence. No artwork or canonical manifest was changed, published, committed or pushed. This is an illustrative layout, not evidence of actual Nuvio framing or a general Builder integration. Typography approval remains pending.


## Colour and type card alternative - 2026-09-17

The owner proposed using styled genre names with colour/background detail, reserving film photography for the hero, to provide a visual pause between photographic rows. This is an exploration, not a final selection or publication approval. A full comparison is staged under `tools/studio-network-batch/.work/staging/genre-colour-cards-v1/`.

Generated selection: all 31 genres in landscape, square and poster, exactly 93 new lossless WebPs (11,861,652 bytes). Existing title letterforms were reused from the retained line masters, with no font downloads. The cards use muted genre colours, low-contrast diagonal/orbital/geometric patterns, shared left insets and vertically centred text. Landscape titles have a larger 114 px target visible height, with proportional fitting for long labels. There are no photographs in these cards. All existing photo cards, 31 title logos and 31 photographic heroes remain byte-identical and available for comparison. No genre skipped; no other category regenerated.

The self-contained `review.html` shows all four collection rows. The Genres selector toggles Colour & type / Photography; Landscape, Posters and Squares switch shape. Titles and hero previews retain the existing assets. The banner begins hidden. Based on, Discover and Decades use exact copies of their existing artwork; Decades redesign remains a separate unimplemented proposal. This is illustrative, not actual Nuvio crop or integration evidence.

Validation: 136 repository tests passed; all 93 new files passed decoding, dimensions, exact lossless master-pixel checks, text bounds and vertical-centering checks. All 400 retained comparison images and their source files matched their hashes, along with 441 protected preview/type-source files. All 497 local page/image responses matched disk bytes. Browser checks covered both styles in all four views, 54 loaded cards per combination, scrolling, independent media selection, photographic hero/title display, Escape dismissal and no desktop overflow. No unresolved failures.

Evidence: `render-report.json`, `review-bindings.json`, `preservation-baseline.json`, `original-asset-bindings.json`, `validation.json`, `browser-review.json`, `contact-sheet.webp`, `README.md` and `git-status.txt`. Source record/hash bindings and planned targets remain local-only. Candidates are needs-review. Public artwork, canonical manifests, earlier previews and unrelated Awards work are preserved; no deletion, commit, push or publication occurred. The preflight and final Git-status path lists are unchanged. Only this handover, the shared Genres status row and the new ignored proof package changed for this request.

Recovery: open the self-contained review.html directly, or restart server.cjs hidden using server-info.json. Do not rerun build.cjs over the completed proof. Any visual revision belongs in a new preserved revision. Next: choose or refine the colour/type direction from the combined view before preparing a release.


## Preferred direction and refinement discussion - 2026-09-17

The owner prefers the minimalist colour/type cards because they provide relief among the photographic library rows. This records a direction preference only; exact output approval, typography choices, final background treatment and publication are not established. The owner asked for the background rationale and whether the type styling/sizing should become more uniform.

The current code uses three background families: diagonals for Action, Action & Adventure, Disaster, War, War & Politics and Western; angular geometry for Science Fiction, Sci-Fi & Fantasy, News, Crime and Thriller; orbital curves for the remaining genres. These are loose mood/visual groupings. All share muted gradients, subdued linework and right-weighted decoration. The current title art is reused from genre-type-study-v2, so condensed heavy, broad sans, serif, italic and mono treatments retain noticeably different optical weights.

Design recommendation, not yet an owner-selected revision: preserve subtle motif variation but equalise line weight, contrast, occupied area and right-edge cropping; soften the filled circular centres. Tighten type into a smaller set of compatible treatments, balance visible size and weight, preserve common left/vertical alignment, and avoid forcing short and long names to identical widths. Test a representative row before a full rerender. No assets were regenerated during this discussion. Only direction notes changed; prior proof validation remains applicable. Preflight and final Git-status path lists remain unchanged.


## Six-genre refinement proof - 2026-09-17

The owner authorised beginning the proposed representative refinement. The new isolated package is `tools/studio-network-batch/.work/staging/genre-colour-refinement-v2/`. Selected: Action, Adventure, Crime, Romance, Family and Science Fiction. It contains 18 new cards across landscape/square/poster and six matching transparent title logos, 24 WebPs totalling 2,356,968 bytes. All six photographic heroes are retained exactly. The other 25 genres were skipped, and no other artwork category was regenerated.

Typography uses three coordinated families from existing installed fonts: Arial Narrow Bold/Bold Italic (Crime/Action), Georgia Bold/Bold Italic (Adventure/Romance), and Inter weight 650 (Family/Science Fiction). Prior decorative letter cuts, very heavy condensed lettering and typewriter lettering are removed in these selected proofs. Titles retain common left and vertical alignment, with proportional width fitting rather than letter stretching. Landscape target cap height is 112 px; square/poster target is 84 px. Longer and two-line labels fit within these limits. Initial larger square/poster drafts are preserved under revisions/initial-narrow-shape-sizing/.

Background colours and gradients remain from v1. Each motif has three unfilled contours with a common 1.6 px stroke at 1200-wide landscape size, .08 opacity and the same rightward fade. Filled circular centres and filled diagonal bands are removed. Exact clear-edge background pixel parity passes for all 18 cards. The transparent title logos follow the revised lettering over the unchanged photographic heroes.

Review: review.html provides a Current/Refined selector in the combined library; comparison.html shows all six pairs side by side, with all four formats available. Both are self-contained offline pages. comparison-sheet.webp is a landscape overview. Other library rows use 245 exact artwork copies. This is an illustrative layout, not Nuvio acceptance or Builder integration.

Validation: 136 repository tests passed; all 24 WebPs pass decoding, dimensions, hashes, exact lossless master-pixel parity and text bounds. Six title logos have valid transparency. All 275 retained images and 281 protected source/code files pass hash checks. All 305 local page/artwork responses match disk. Browser checks passed eight current/refined format combinations (29 loaded cards each), unchanged hero with appropriate current/refined logo, modal dismissal, all twelve comparison images in each format, and no desktop overflow or console errors. No unresolved failures.

Evidence: render-report.json, review-bindings.json, retained-asset-bindings.json, preservation-baseline.json, validation.json, browser-review.json, README.md and git-status.txt. All candidates remain needs-review; no release approval is inferred. Prior proofs, published assets and manifests remain untouched. Existing Awards work and a concurrent Decades handover edit were preserved. No external requests, font downloads, public asset writes, canonical manifest writes, deletion, commit or push occurred. Next: review these six examples before extending the selected treatment to the remaining genres. Do not rerun the one-time build or sizing-adjustment scripts over this completed proof; use a new preserved revision for further changes.


## Original lettering restored on colour cards - 2026-09-17

The owner clarified that they wanted the original font styling from the supplied first-proof screenshot now that the cards use typography without photography. The new isolated package is `tools/studio-network-batch/.work/staging/genre-original-type-colour-v3/`. All 31 original transparent title masters from `genre-full-v1` are reused, preserving original letterforms, case, letter cuts and ornaments. They are trimmed and proportionally placed without redrawing fonts or changing internal layout. Card scale derives from the original role text bounds, constrained by the current 64 px portrait/square safe inset; landscape uses 72 px left inset. The complete mark is vertically centred. The quieter three-contour backgrounds and genre colours are retained from the refinement.

Generated: 93 new lossless WebPs, comprising 31 landscapes, 31 squares and 31 posters, totalling 11,707,760 bytes. Reused exactly: 31 original transparent title logos and 31 accepted photographic heroes. Romance retains Titanic. No genres skipped and no other category regenerated. 431 retained images include the uppercase colour comparison and the other library categories. All preceding proofs remain untouched.

Review: review.html contains all four collection rows with Original lettering as the default and Uppercase study as the comparison. comparison.html shows all 31 pairs in each shape and title-logo format. Science Fiction, Horror and Romance are first. The earlier uppercase comparison also retains its earlier background pattern; the new proof uses the quieter contour treatment. The pages have relative local assets and can open offline. This is an illustrative library, not actual Nuvio display acceptance or a Builder integration.

Validation: all 136 existing repository tests passed with temporary-folder access; initial sandbox-only EPERM failures were resolved. All 93 exports pass dimensions, exact lossless master-pixel parity, proportional bounds, vertical centering and pixel-identical recomposition from the original wordmark. All 31 logo and hero hashes match the original report. 479 protected source files, 431 retained copies, 124 exact-output review bindings and 530 local HTTP resources passed verification. Browser checks passed both styles in all four formats with 54 loaded cards each, all 62 comparison images in each format, the original Romance logo over the retained Titanic hero, modal closing, and no desktop overflow or console warnings/errors. No unresolved failures.

Evidence: render-report.json, review-bindings.json, preservation-baseline.json, retained-asset-bindings.json, validation.json, browser-review.json, contact-sheet.webp, overview.webp, README.md and git-status.txt. Only this handover, the Genres workflow row and the new ignored proof were changed. Preflight/final Git-status path lists match; existing Awards and concurrent Decades edits are preserved. No external source requests, font downloads, public asset writes, canonical manifest writes, deletion, commit or push occurred.

Recovery: open review.html directly, or restart server.cjs hidden; server-info.json records the saved localhost port. Do not rerun build.cjs over the completed proof. verify.cjs --http validates a running preview. Further artwork changes belong in a preserved revision. Next action is owner review of the original lettering on the colour backgrounds.


## Focus design discussion - 2026-09-17

The owner confirmed that the original lettering works now that the cards are text-only, then asked what kind of focus treatment would suit them. This endorses the current working visual direction, not a focus design or publication. The reviewed base package remains genre-original-type-colour-v3; its render-report.json and review-bindings.json retain the exact staged hashes.

Reference check: current Based on focus uses a stronger blue-white outer title outline/glow with the normal letter interiors preserved. Discover keeps its composition sharp and highlights only the group name with blue-white fill and a controlled blue halo. Holiday uses theme-coloured outer title outlines. These repository contracts support highlighting the genre name as a shared library convention, while allowing each genre colour to remain distinctive.

Recommendation: a soft, restrained halo in a lighter shade of the genre colour around the original title, accompanied by a modest lift in the existing background gradient. Preserve the pearl-white letter fill, exact placement, size, case, cuts and ornaments. Keep linework subordinate. Apply one visual rule across the set, balancing apparent strength for the different fonts. Examples: cyan for Science Fiction, muted crimson/plum for Horror, blush for Romance and amber for Action. This is a proposed static focus asset; motion, borders, scaling and Nuvio behaviour are not assumed.

A useful first comparison is the recommended title-halo treatment versus a quieter background-only colour lift, on Science Fiction, Horror, Romance and Action. These cover multi-line geometry, heavy condensed type, fine italic strokes/underline and slanted action lettering. Check the distinction at actual card size before extending to all 31. Eventual roles would follow focus (landscape), posterFocus and squareFocus paired with the exact matching base shape; no new roles are implemented by these notes.

No images, render scripts, public assets or canonical manifests changed during this discussion. No generation, external requests, tests, deletions, commit or push were needed or performed. Changes are limited to this handover and the shared Genres status row. Prior artwork validation remains applicable. Existing unrelated work is preserved; final Git-status paths match preflight. Next concrete action: owner consideration of the focus recommendation, then a small comparative proof if requested.

## Four-genre focus comparison - 2026-09-17

The owner authorised trying both recommended focus treatments. The isolated package is `tools/studio-network-batch/.work/staging/genre-focus-study-v1/`. Selected: Science Fiction, Horror, Romance and Action. Generated: 24 lossless WebPs (two variants x four genres x landscape/square/poster), totalling 3,507,902 bytes. A is a soft genre-coloured title halo with a background colour lift; B uses the same lift without the halo. The comparison changes only the focus artwork, preserving exact base files, typography geometry and opaque letter fills. Fine letter cuts are shielded from the added halo.

All 12 base card files, four photographic heroes, four original transparent logos and 24 library-context covers are copied exactly (44 retained images). The other 27 genres were skipped. No other category, normal card, title logo or hero was regenerated. Intended eventual roles are focus, squareFocus and posterFocus at the dimensions of their bound landscape/square/poster bases. Both variants target the same eventual role and are mutually exclusive candidates, not parallel runtime assets.

Review: review.html is a self-contained offline page. It opens on A / Landscape with Science Fiction selected; hover, click or keyboard arrow keys move selection. A/B, shape and Focus on controls change the view. Enter on a card opens its original hero/logo; Escape closes. Based on and Discover appear below as unchanged context, followed by a four-genre Resting/A/B comparison. comparison-sheet.webp captures all landscape pairs. This is illustrative interaction, not Nuvio integration evidence or an assertion of Nuvio animation/selection behaviour.

Validation: 136 existing repository tests passed. All 24 focus files decode at exact dimensions and have exact lossless master-pixel parity and review hashes. All 12 base-to-focus pairs retain 620,436 opaque letter pixels and protect 2,048 small cut pixels from the halo. Text placement and size match the original masters; clear changes distinguish both focus options from the base and each other. All 44 retained copies, 64 protected sources and 72 local HTTP resources passed hashes. Browser verification covered all 24 genre/treatment/shape selections (24 loaded page images each), exactly one selected card, no desktop overflow, keyboard navigation, Focus off restoring original artwork, Romance hero/title loading, Escape dismissal and no console errors or warnings.

During development an initial grayscale blur returned interleaved RGB channels; this was corrected with explicit single-channel conversion and length assertions before review. The initial draft renderer, masters, outputs and reports remain in revisions/initial-channel-draft/. Current validation covers the corrected outputs. No unresolved failures remain.

Evidence: render-report.json, review-bindings.json (variant and exact base/output hash bindings), retained-bindings.json, preservation-baseline.json, validation.json, browser-review.json, comparison-sheet.webp, README.md and preflight/final Git-status files. Only this handover, the shared Genres row and the ignored study package changed. Existing Awards and concurrent Decades work are preserved. Final Git-status paths match preflight. No source requests, font downloads, final/public asset writes, canonical manifest writes, deletions, commits or pushes occurred.

Recovery: open review.html directly, or restart server.cjs hidden using the saved port in server-info.json. verify.cjs --http validates a running local preview. Do not rerun build.cjs over the completed package; preserve further changes in a new revision. Next: owner selects or refines the focus treatment before expansion.


## Selected A extended to the complete set - 2026-09-17

The owner selected A. The new isolated package is `tools/studio-network-batch/.work/staging/genre-focus-full-v1/`. The selected parameters are copied exactly from the reviewed study: a colour-tinted outer title halo and the same background channel gain/offset, with glyph masks and a small cut shield preserving fine details. The twelve reviewed A files for Science Fiction, Horror, Romance and Action are copied byte-for-byte along with their masters and masks; their source hashes and planned targets are preserved. owner-selection.json records the selection and exact reviewed-output bindings without implying publication.

Generated: 81 new focus WebPs for the remaining 27 genres across landscape, square and poster. Retained approved proofs: 12. Complete focus count: 93, totalling 14,804,790 bytes. Complete genre role count: 248 (93 normal cards, 93 focus cards, 31 original title logos, 31 photographic heroes). No genre skipped; no base card, logo, hero or unrelated category regenerated. The 412 retained image copies include the twelve approved focus files, all 155 base genre assets and 245 context assets from Based on/Discover/Decades. Previous A/B studies remain preserved.

Review: review.html shows all four library rows. Genres has Hover focus, All focused and Resting modes; keyboard focus also displays A. Focus is disabled in the title-logo view. comparison.html shows resting and focused versions of all 31 genres in three shapes. The three focus-board WebPs cover every genre in landscape. Relative files make the gallery usable offline. The preview uses actual staged image pairs and does not claim Nuvio implementation or framing acceptance.

Validation: all 136 repository tests passed. All 93 focus exports pass decoding, dimensions, lossless master-pixel parity, unique planned targets, exact base-focus hash bindings and preserved text geometry. 3,606,397 opaque letter pixels match the bases exactly; 7,025 fine cut pixels are protected from the halo. All 12 accepted output/master hashes match the reviewed study. All 412 retained copies, 592 protected source files and 499 local HTTP resources pass hashes. Browser checks passed all nine shape/focus-mode combinations (85 loaded image layers each, exact overlay alignment, 31 focused overlays in All focused and none in Resting), title-logo mode (54 loaded images and focus disabled), keyboard selection including the last genre, Romance hero/logo display, Escape dismissal and the 62 comparison images in each shape. No desktop overflow or console warnings/errors remained.

Evidence: render-report.json, owner-selection.json, review-bindings.json, retained-bindings.json, preservation-baseline.json, validation.json, browser-review.json, focus-board-1/2/3.webp, README.md and preflight/final Git-status files. The only edits outside the new ignored stage are this handover and the shared Genres status row. Existing Awards and concurrent Decades work are preserved. Final Git-status paths match preflight. No external source requests, font downloads, final/public asset or canonical manifest writes, deletion, commit or push occurred. No failures remain.

Recovery: open review.html directly, or restart server.cjs hidden using server-info.json. verify.cjs --http validates a running preview. build.cjs is a completed one-time generator and must not overwrite this package. Preserve further revisions. Next: review the completed set; A is selected, and publication remains a separate explicit step.


## Authorised complete replacement - 2026-09-17

The owner authorised replacing all existing Genre artwork with the completed set, creating a branch, committing, pushing, opening a PR and merging. This supersedes the earlier needs-review/publication-not-authorised notes for these exact 248 staged outputs only. No unrelated category is included. The isolated branch is work/genre-artwork-release. Local release evidence is tools/studio-network-batch/.work/staging/genre-release-20260917/; publication-approval.json and reviewed-bindings.json bind every stable key, role, actual final target and exact reviewed hash.

Release: 248 byte-identical staged WebPs across 31 genres and eight roles, totalling 46,377,380 bytes. The 62 legacy JPGs are backed up and retired. No images are rerendered or re-encoded. The 31 wide and 31 vertical replacements retain their existing folders and filename stems, changing .jpg to .webp; only the stray apostrophe in queer wide'.jpg is cleaned. All new roles use clear names under each genre slug. The manifest contains all 62 old-path to new-path mappings, including the distinction between Science Fiction and Sci-Fi & Fantasy. Old JPG URLs require migration; cache refresh timing is not asserted.

The new category manifest and strict draft-2020-12 schema follow the existing category metadata direction. Role sourceSha256 values identify the render masters; artworkSources.hero preserves exact TMDB image identity, source hash, crop and scaling. Original cut/colour cards and their focus pairs retain exact hashes; heroes and title logos are unchanged. The News hero retains its previously reviewed resolution limitation. No canonical shared master index, runtime lookup or Builder code is changed.

Validation: 136 existing repository tests; all 248 reviewed image hashes, dimensions, alpha roles and decodes; all 93 focus-base bindings; all 31 hero identities/crops; 62 backed-up legacy hashes and replacement mappings; exact category membership; strict manifest schema. The prior full-set pixel and browser checks remain applicable because image bytes are unchanged. Hero scale values are derived from recorded pixel crop and output dimensions, completing two inherited missing values and normalising one rounded-crop value before schema validation. No artwork changed. Live URL verification is recorded in the release evidence and release PR after publication.

The source workspace stays separate from this release checkout. Existing Awards, README, ignore-file and concurrent Decades work are excluded. Only the Genre folder, this handover and the Genres workflow entry are in release scope. The retired JPGs are the only authorised image deletions.


## Grouped genre folders - 2026-09-17

The owner requested that every genre keep all its artwork together. All 31 genres now have eight files in one folder: landscape.webp, landscape-focus.webp, poster.webp, poster-focus.webp, square.webp, square-focus.webp, hero.webp and title-logo.webp. The manifest role keys are unchanged.

Exactly 93 existing WebPs are relocated: 31 landscape covers, 31 poster covers and 31 landscape focus files. The other 155 assets retain their paths. All 248 image hashes, source/master metadata and dimensions are unchanged; zero artwork is regenerated. Old wide/vertical directories are removed from the published tree. relocatedFiles maps all 93 former WebP paths, and retiredLegacyFiles maps all 62 original JPG paths, directly to the final locations. There are no duplicate aliases or redirect promises.

Local evidence is tools/studio-network-batch/.work/staging/genre-layout-20260917/. backup/ preserves the previous category; publication-approval.json and reviewed-bindings.json bind stable keys, roles, final paths and exact approved bytes. Validation covers all 31 eight-file folders, 248 hashes/dimensions/alpha roles, 93 focus pairs and 155 direct migration records, plus the strict manifest schema and 136 existing repository tests. Only the Genre folder, this handover and the Genre workflow row are changed. Unrelated Awards and Decades work is preserved.

The owner-approved Genre publication workflow continues through a dedicated branch, commit, PR and merge. Consumers should use the manifest role URLs; Nuvio acceptance and Builder integration remain separate work. Subsequent live verification is recorded in local release evidence and the publication PR.

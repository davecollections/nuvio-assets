# Based on artwork handover

Last updated: 2026-09-05. Read [the shared workflow](../artwork-workflow.md) first.

## Scope and identity

Category key: based_on. Stable keys: based_on:SLUG. Ten film-artwork categories, with no added Movies/Series/Mixed variants. Category membership is an editorial decision; an artwork source does not define a Builder filter. History and True Stories may overlap. Toys & Games covers physical toys and board games; Video Games is separate. The mythology stable key displays as Myths & Legends and covers myths, legends and folklore. Holiday artwork remains separate future work.

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

Release state: owner-approved files installed in the isolated release checkout; commit, push and live verification pending. Approval covers all forty v3 images, retirement of all five legacy JPGs, category metadata, commit and push. The stronger focus treatment is selected. General Builder integration is absent and Nuvio client framing remains untested.

The current original checkout has unrelated Awards/Decades changes. Those are preserved and excluded from this release. The isolated checkout starts from origin/main at 972a744056b0e372f408dae4c2c034afad556285 and uses branch work/based-on-artwork-release. Local main was not advanced.

Next: commit and push the bounded release, then verify every public artifact against its published hash.

## Design and delivery contract

| Role | Dimensions | Format | Public path |
| --- | --- | --- | --- |
| Cover | 1200 × 675 | WebP | assets/collection_covers/based_on/SLUG/landscape.webp |
| Focus | 1200 × 675 | WebP | assets/collection_covers/based_on/SLUG/focus.webp |
| Title logo | 1863 × 673 | Transparent lossless WebP | assets/collection_covers/based_on/SLUG/title-logo.webp |
| Hero | 2560 × 1440 | WebP | assets/collection_covers/based_on/SLUG/hero.webp |

Covers use real film artwork, a small BASED ON caption and large pearl-white category text. Title logos use category-specific white typography and motifs, with about 25 pixels between the caption and main glyphs. Focus adds the stronger blue-white outer stroke/glow; normal letter interiors and areas outside the glow are preserved in the masters. Heroes use one visually different source image from their corresponding covers, with no baked-in text or added fade. Harry Potter replaces the rejected LOTR Books artwork and differs from the Decades Harry Potter composition. Only already-installed local fonts were used.

## Manifest and Builder contract

- Category authority: assets/collection_covers/based_on/manifest.json.
- Schema: assets/collection_covers/based_on/manifest.schema.json, schemaVersion 1, kind based-on-artwork.
- The sets object maps each slug to stableKey, labels, basis, mediaTypes, landscape/focus/titleLogo/hero, and artworkSources. Every role has a path, URL, SHA-256, dimensions, bytes and encoding. Focus also binds its base-cover hash. Asset sourceSha256 is the lossless render-master hash; artworkSources retains the original film-image identity/hash and mirror decision.
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

# Holiday and seasonal artwork handover

Last updated: 2026-09-05. Read [the shared workflow](../artwork-workflow.md) before resuming.

## Scope and identity

Category key: holiday. Five owner-selected editorial themes with one shared set per theme, suitable for movie or TV collections. No separate Movies/Series/Mixed variants. Verified TMDB movie IDs identify source films; artwork choices do not define collection membership or prove catalog size.

| Display title | Stable key | Film artwork / TMDB movie ID |
| --- | --- | --- |
| Christmas | holiday:christmas | Home Alone / 771 |
| Halloween | holiday:halloween | Hocus Pocus / 10439 |
| Valentine’s | holiday:valentines | Notting Hill / 509 |
| Summer Holidays | holiday:summer-holidays | Mamma Mia! / 11631 |
| Winter Favourites | holiday:winter-favourites | Frozen / 109445 |

Other holidays, Awards, Builder development and the sibling tmdb-id-lookup repository are excluded.

## State and next action

State: published and live-hash verified. The owner authorised the exact reviewed set, three legacy JPG retirements, commit and push on 2026-09-05. Local main and fetched origin/main both started at 51a463d711a720e46a83f61d3d8a17fec96b6134; main was checked again before staging and had not moved. Artwork release: [7d0ae9c](https://github.com/davecollections/nuvio-assets/commit/7d0ae9c354696ab9f190c4f6202758a9a1c2a4aa).

The requested artwork publication is complete. No further artwork changes are pending. A future owner-requested Nuvio preview or Builder integration is separate work; general Builder integration is absent and Nuvio acceptance is untested.

Preexisting Awards changes in .gitignore, README.md, data/awards, schemas/awards-* and tools/awards-artwork are excluded from the release and preserved.

## Design and delivery contract

One large circular real-film image at right, a dark surround, pale custom lettering, thin accent rings and small seasonal motifs. Christmas uses warm gold, bold Palatino and a small holly title mark; Halloween uses amber, Impact and bats; Valentine’s uses rose, italic Palatino and hearts; Summer uses gold/teal, Inter and sun/wave details; Winter uses ice blue, Inter and snowflakes.

| Role | Dimensions | Format | Stable target |
| --- | --- | --- | --- |
| Landscape cover | 1200 × 675 | WebP | assets/collection_covers/holiday/SLUG/landscape.webp |
| Matching focus | 1200 × 675 | WebP | assets/collection_covers/holiday/SLUG/focus.webp |
| Transparent title logo | 1863 × 673 | Lossless WebP | assets/collection_covers/holiday/SLUG/title-logo.webp |
| Single-image hero | 2560 × 1440 | WebP | assets/collection_covers/holiday/SLUG/hero.webp |

Focus adds a season-coloured outer outline to the large title. The smaller Holidays/Favourites caption, motifs, scene and opaque letter fills are preserved in the lossless masters; independently encoded lossy files are not claimed to be pixel-identical. Title logos are flat white with alpha and compact spacing.

Each hero uses a distinct image and pose/composition from the cover, from the same film, without added title, fade, mirroring or upscaling. Gallery hero/logo composites are illustrative and are not Nuvio screenshots.

The final Christmas cover/focus omit the lower-right pine sprigs and berries. Valentine’s uses Notting Hill: Julia Roberts and Hugh Grant smiling at each other on the cover, and a distinct portrait/poster composition for the hero. Its title-logo bytes remain unchanged from the initial design.

## Manifest and builder contract

Published [category manifest](https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/holiday/manifest.json): assets/collection_covers/holiday/manifest.json. Schema: manifest.schema.json in the same folder, schemaVersion 1. It records five sets, twenty images, 4,934,172 image bytes, stable identities, role URLs, hashes, dimensions, encoding settings and source provenance. titleLogo maps to title-logo.webp.

Asset sourceSha256 identifies a lossless render master; artworkSources identifies original TMDB image bytes. The manifest binds approval to the exact reviewed candidate and review-bindings hashes. It contains no raw approval conversation.

Christmas.jpg, Halloween.jpg and Valentines.jpg were backed up and retired with owner approval. Their old URLs are not redirects; imports must use the new manifest WebP paths. Existing client caches may retain old imagery. No shared master index, general Builder reader, runtime-lookup entry or Nuvio import was created.

## Review and publication evidence

Ignored/local-only stage: tools/studio-network-batch/.work/staging/holiday-artwork-v1. review.html and four contact sheets contain the final owner-reviewed design. manifest.candidate.json, review-bindings.json, source-plan.json, metadata/, sources/, masters/ and validation.json retain exact reviewed output and source evidence. The historical staging bindings retain publicationAuthorized false; the subsequent release approval below is authoritative for publication.

Ignored/local-only release: tools/studio-network-batch/.work/staging/holiday-release-2026-09-05. approval.json authorises the twenty stable-key/role/target/hash records and three retirements. reviewed-* files freeze review evidence; prepared/ freezes delivered bytes; legacy-backup/ preserves all three old JPGs; documentation-before-release/ preserves the full earlier handover. plan.json limits the release to twenty WebPs, three category metadata files, two documents and three JPG deletions.

Validation before installation: 136 studio/network tests passed; artwork verification passed all twenty outputs, identity/source hashes, dimensions, membership, focus master preservation, white-alpha logo bounds, distinct heroes and quality gates; candidate and public schemas passed PowerShell Test-Json; all twenty-eight gallery image responses matched local bytes. Publication verification passed all twenty delivered hashes and exact folder membership, all three legacy backups, 250 protected files and 44 unrelated dirty files with unchanged hashes and modification times. The three approved legacy JPG deletions are the only protected-file retirements.

live-verification.json records 49 successful HTTP checks on 2026-09-05: twenty image hashes and three metadata hashes at both main and the immutable artwork commit, plus 404 responses for the three retired main-branch JPG URLs. Default URLs were verified without cache-busting parameters. Remote main matched the artwork commit at verification. No live failures or source failures remain.

No artwork was regenerated for publication: all twenty approved files were copied byte-for-byte. No new TMDB requests or font downloads. Unrelated artwork and Awards work remain untouched. The release contains only the Holiday final assets, manifest/schema/README and the two artwork documents. Final git status retains only the preexisting Awards files listed above; no Holiday changes remain uncommitted after publication and verification documentation.

## Recovery and revision history

Staging and release evidence are ignored and may be absent in another clone. Public metadata and this handover are tracked. Sources are real film artwork, composed deterministically using Canvas/Sharp and existing local fonts. No AI-generated scene imagery or font files were committed.

Current source-plan.json is authoritative. Final cover/hero candidate indices: Christmas 2/4; Halloween 0/2; Notting Hill Valentine’s 12/37; Summer 1/4; Winter 7/2. Thirteen cached originals include three superseded images. Notting Hill sources use the valentines-notting-hill-509 prefix to avoid old La La Land cache collisions.

Preserved revisions: revisions/initial-layout/, revisions/christmas-clean-corner/ and revisions/valentines-notting-hill/. Christmas changed two images and retained eighteen; Notting Hill changed three and retained seventeen. Their validation reports retain exact preservation evidence.

For a future requested revision, preserve the current stage, select only the requested theme/roles and update the expected verification baseline before rendering:

    node tools/studio-network-batch/.work/staging/holiday-artwork-v1/render.cjs --only=SLUG --roles=ROLE
    node tools/studio-network-batch/.work/staging/holiday-artwork-v1/gallery.cjs

The original acquire.cjs still describes the superseded La La Land bootstrap. Do not rerun it, refine.cjs or the one-time Christmas/Notting Hill migration scripts over the final stage. Existing verify.cjs is a historical prepublication check that requires the retired JPGs; use release verify-release.cjs after publication.

The read-only gallery server records its ephemeral URL/PID in server-info.json. Restart it hidden if needed. No new rendering or source acquisition is needed to reproduce the approved release from prepared/; validate exact hashes before any future publication.

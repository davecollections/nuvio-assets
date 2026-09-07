# Decades artwork

Eight decades, three content variants and eight WebP assets per set. The two parent covers remain separate root images at 1695 x 928. Manifest schemaVersion 2 adds poster and square cover/focus pairs and preserves all original files and URLs.

| Manifest field | Filename | Dimensions | Role |
| --- | --- | --- | --- |
| landscape | landscape.webp | 1200 x 675 | Landscape cover |
| focus | focus.webp | 1200 x 675 | Landscape focus |
| poster | poster.webp | 800 x 1200 | Poster cover |
| posterFocus | poster-focus.webp | 800 x 1200 | Poster focus |
| square | square.webp | 800 x 800 | Square cover |
| squareFocus | square-focus.webp | 800 x 800 | Square focus |
| titleLogo | title-logo.webp | 1863 x 673 | Transparent white title |
| hero | hero.webp | 2560 x 1440 | Hero background |

Use manifest.decades[decade][kind][role].url, where kind is movies, series or mixed. The original focus field remains the landscape focus. The same hero and title logo serve all three cover shapes. These role names match Discover's format extension. The category manifest remains separate from the company/network runtime lookup; a general Builder category reader is not supplied by this repository change.

The 1950s-earlier identity includes releases through 1959 and displays 1950s on its artwork. Series selections use first-air year. heroYears continues to describe existing hero sources.

Landscape covers retain their five-image compositions. Posters and squares use one real artwork image, a glassy silver year, and a spaced A DECADE OF CINEMA or A DECADE OF TV caption. Mixed uses the matching Movies artwork without the caption. Focus blurs the matching image and caption while keeping the year sharp.

| Decade | Movie poster/square title | Movie hero | Series title |
| --- | --- | --- | --- |
| 1950s-earlier | Singin' in the Rain | Singin' in the Rain | I Love Lucy |
| 1960s | 2001: A Space Odyssey | 2001: A Space Odyssey | Star Trek |
| 1970s | Star Wars | Star Wars | M*A*S*H |
| 1980s | Back to the Future | Back to the Future | The A-Team |
| 1990s | Terminator 2: Judgment Day | Jurassic Park | Friends |
| 2000s | The Lord of the Rings: The Fellowship of the Ring | The Lord of the Rings: The Fellowship of the Ring | Lost |
| 2010s | Avengers: Endgame | Avengers: Endgame | Game of Thrones |
| 2020s | Spider-Man: Brand New Day | Spider-Man: Brand New Day | Severance |

Each shape can have its own source and crop. The 1970s Movies/Mixed poster uses a darker Star Wars image than the square. artworkSources.cover and artworkSources.hero retain their original records; artworkSources.poster and artworkSources.square describe the new cover/focus pairs. The asset sourceSha256 identifies its lossless master; each artwork source sha256 identifies the original source image.

All 96 new images are copied exactly from the reviewed WebPs, without re-encoding: quality 82, effort 6, smart subsampling. They total 4,497,940 bytes. The 192 set images total 15,808,782 bytes; including the two parent covers, all 194 images total 16,024,420 bytes. counts contains current totals. The original delivery object retains the original four-role optimisation history; formatExtensionDelivery describes the added shapes.

The manifest fingerprint is SHA-256 of UTF-8 JSON.stringify({decades: manifest.decades, rootCovers: manifest.rootCovers}). formatExtensionApproval records the approved new-shape release separately from the original approval. Original sources, masters and exact review bindings remain in ignored staging.

Canonical URLs stay on /main/. A changed image has a new sha256; this metadata does not itself invalidate an image already cached by Nuvio. Versioned query URLs are not a guaranteed cache bypass. An immutable commit URL can identify exact release bytes for an intentional preview. No automatic artwork refresh is configured.

Source images and metadata: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Artwork belongs to its respective rights holders. All images use real artwork; no AI image generation was used.

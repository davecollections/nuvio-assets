# Decades artwork

Eight decades, three content types and exactly four WebP assets per set: landscape.webp (1200 x 675), focus.webp (1200 x 675), title-logo.webp (1863 x 673, transparent) and hero.webp (2560 x 1440). The two existing parent covers remain separate.

Heroes use one defining title per decade. Mixed uses the matching movie hero under its own path. Hero images contain no added year, title logo or caption. The white cinematic title logo is separate; covers and focus retain their approved silver glass styling.

The 1950s-earlier folder includes releases through 1959; its artwork displays 1950s. Series selection uses first-air year. heroYears lists the distinct source years represented in each group.

| Decade | Type | Hero |
|---|---|---|
| 1950s-earlier | movies | Singin' in the Rain |
| 1950s-earlier | series | I Love Lucy |
| 1960s | movies | 2001: A Space Odyssey |
| 1960s | series | Star Trek |
| 1970s | movies | Star Wars |
| 1970s | series | M*A*S*H |
| 1980s | movies | Back to the Future |
| 1980s | series | The A-Team |
| 1990s | movies | Jurassic Park |
| 1990s | series | Friends |
| 2000s | movies | The Lord of the Rings: The Fellowship of the Ring |
| 2000s | series | Lost |
| 2010s | movies | Avengers: Endgame |
| 2010s | series | Game of Thrones |
| 2020s | movies | Spider-Man: Brand New Day |
| 2020s | series | Severance |

Use manifest.decades[decade][kind].landscape.url, focus.url, titleLogo.url and hero.url. For changed artwork at stable paths, append ?v= followed by the first 12 characters of that asset sha256. The manifest is separate from the company/network/people runtime lookup.

The manifest fingerprint is SHA-256 of UTF-8 JSON.stringify({decades: manifest.decades, rootCovers: manifest.rootCovers}). Approval records bind stable keys, targets and exact reviewed hashes. Changes require a reviewed release; no automatic refresh is configured.

The 96 set images total 11.31 MB. All dimensions are retained; all title logos are byte-identical to the previous release. Photos use per-image WebP quality checks against lossless masters. Original sources and render evidence remain in ignored staging. Some heroes are mirrored or shifted to leave room for the Nuvio title; transformations are recorded in artworkSources.

Source images and metadata: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Artwork belongs to its respective rights holders. No AI image generation was used.

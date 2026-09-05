# Decades artwork

Approved artwork for eight decade groups and three content types. There are 24 sets and 96 runtime images, plus two existing parent-folder covers converted to WebP.

## Folder layout

```text
{decade}/{movies|series|mixed}/
  landscape.webp    1200 x 675 collection cover
  focus.webp        1200 x 675 blurred background, sharp year
  title-logo.webp    1863 x 673 transparent white cinematic lettering
  hero.webp         2560 x 1440 multi-image background, no added text
```

Decade keys: 1950s-earlier, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s. The earlier bucket includes releases through 1959 and displays 1950s on its artwork. Movies maps to TMDB movie; Series maps to tv; mixed includes both.

## Builder manifest

The Decades manifest is separate from the existing company/network/people runtime lookup. Its stable URL, once these files are committed and pushed to main, is:

```text
https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/decades/manifest.json
```

Choose a set by decade key and content type. All four assets contain a ready-to-use full URL, repository-relative path, SHA-256, dimensions and byte count. A builder can pass the URL directly to Nuvio. Paths also allow a configurable CDN, proxy or local base.

```js
const entry = manifest.decades['1990s'].movies;
const coverUrl = entry.landscape.url;
const focusUrl = entry.focus.url;
const titleLogoUrl = entry.titleLogo.url;
const heroUrl = entry.hero.url;

// Optional cache version when replacing an approved asset at the same path.
const url = new URL(entry.hero.url);
url.searchParams.set('v', entry.hero.sha256.slice(0, 12));
```

Validate against manifest.schema.json. The manifest fingerprint is SHA-256 of UTF-8 JSON.stringify({decades: manifest.decades, rootCovers: manifest.rootCovers}), preserving object order. Each approval binds its stable key, final path and exact reviewed asset hash; the cover, focus and hero delivery copies use measured WebP compression; transparent title-logo pixels and alpha are preserved losslessly.

The existing company, network and people index remains at ../runtime-lookup.json. Its entries provide relative paths and hashes. This Decades release does not change that schema or builder integration code.

## Approved design and maintenance

These preserve the approved decades-artwork-v2 design and dimensions in optimised WebP delivery copies. The selected hero is the static multi-image montage. Single-title hero alternatives, full-size PNG cover/focus masters, source evidence, render scripts and review boards remain in ignored staging. The yearly montage uses ten images per completed decade and seven for 2020-2026. The earlier montage covers 1950-1959. No automatic refresh is configured. Further changes, including adding later 2020s years, require a new reviewed release.

The owner approved repository placement; comparison inside Nuvio remains pending. This is not a claim that the files are already available remotely. URLs become available after commit and push.

The source shortlist, crops, title choices and imagery were preserved from the approved proofs. Series use first-air year and imagery can come from later seasons. The mixed hero alternates movies in even years and series in odd years. The hero has no added year, logo or caption; title logos are separate. Approved source identities and source image hashes are retained in artworkSources.

The two existing parent-folder covers are available separately as movies-by-decade.webp and series-by-decade.webp via manifest.rootCovers. Their JPEG originals are backed up in ignored staging. Every decade/media folder contains exactly four WebP files; parent covers do not add files to those sets.

## Attribution

Existing imagery and metadata are sourced from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Artwork belongs to its respective rights holders. No AI image-generation tool was used.

## Delivery sizes

The 96 set assets total 8.44 MB, reduced from 14.17 MB (40.4% smaller). Dimensions and artwork layout are preserved. Title logos use lossless WebP with unchanged visible pixels and alpha. Photos use the smallest tested encoding that passed the role-specific quality checks, or retain the approved WebP when that is preferable. Full original masters remain in staging.

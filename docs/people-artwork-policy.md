# People artwork policy

Nuvio uses one category-neutral person identity, keyed as `person:{tmdbPersonId}`. Actor and director collections reuse that identity’s artwork; a person who belongs to both catalogues does not receive duplicate artwork.

## Formats and content

Each person can have two independently rendered WebP formats:

- landscape: 1200 × 675, using the approved Subtle Toned Archive R1 system;
- poster: 1000 × 1500, using the approved Subtle Toned Archive R2 system.

Both formats start from the original validated portrait source. A landscape or poster output is never used as the source for another format. The only cover text is the canonical person name, with punctuation, accents, and initials preserved. Names use Cormorant Garamond genuine weight 700 and deterministic one-or-two-line fitting. Role labels, collection labels, dates, titles, awards, rankings, icons, logos, borders, outlines, synthetic bold, and other metadata are prohibited.

## Portrait source resolution

`data/people/portrait-source-decisions.json` is separate from catalogue membership and has this precedence:

1. use `approvedProfilePath` for a matching `use-owner-selected` decision;
2. otherwise use `profilePath` from `data/people/people-registry.json`, including `retain-registry-source` decisions;
3. use the text-only fallback when the exact resolved portrait is absent or invalid.

The renderer never rewrites registry profile paths. It never searches for an alternate portrait, calls TMDB person search, person details, or person-images endpoints, broadens to another profile path, or uses a general-web image. Optional acquisition is limited to the official original-resolution TMDB image-CDN URL derived from the already resolved path.

Offline rendering is the default. Portrait acquisition requires `--allow-network`; font acquisition is a separate explicit command. Downloads use timeouts, bounded retries, exact-path validation, atomic cache writes, image validation, and recorded source hashes and dimensions.

## Fallbacks

A missing or invalid exact portrait activates the first-class text-only fallback. Landscape begins at 96 px; poster begins at 114 px. Both use a flat dark-warm background, subtle deterministic grain, and the centred canonical name. Fallback artwork contains no portrait, portrait-like image, face, silhouette, initials-only substitution, icon, logo, role label, error message, or additional wording.

Machine-readable fallback reasons are `no-profile-path`, `source-not-cached`, `source-fetch-failed`, `source-http-invalid`, `source-content-type-invalid`, `source-empty`, `source-decode-failed`, `source-dimensions-invalid`, and `source-validation-failed`.

## Processing boundary

Permitted deterministic processing is limited to EXIF orientation correction, colour-space normalisation, crop, resize, the approved monochrome and warm-grey treatment, contrast, seeded grain, gradient, and canonical-name typography.

AI portraits, generative fill, facial reconstruction, face recognition, face swapping, mirroring, retouching, age or expression changes, hair or clothing changes, and background invention are prohibited. Completed artwork is never accepted as a portrait source.

## Font lock

The approved font lock is `tools/people-seed/config/cormorant-garamond-700.json`. Normal rendering verifies the exact font and OFL hashes, the variable `wght` axis, genuine weight 700, and required glyph coverage. The font binary and licence remain in an ignored cache and are not installed into Windows or committed.

Explicit commands:

```powershell
npm --prefix tools/people-seed run verify-people-font
npm --prefix tools/people-seed run acquire-people-font -- --font-dir tools/people-seed/.work/fonts/cormorant-garamond
```

## Rendering and validation

```powershell
npm --prefix tools/people-seed run renderer-help
npm --prefix tools/people-seed run render-people-offline -- --stable-key person:3894 --format both --output-dir tools/people-seed/.work/example --source-cache tools/people-seed/.work/people-source-cache
npm --prefix tools/people-seed run render-people-offline -- --seed data/people/actors-seed.json --tier initial --stable-key-file tools/people-seed/.work/keys.json --output-dir tools/people-seed/.work/example --source-cache tools/people-seed/.work/people-source-cache
npm --prefix tools/people-seed run validate-renderer
npm --prefix tools/people-seed run promotion-parity
npm --prefix tools/people-seed run deterministic-replay
```

The renderer writes deterministic JSON and CSV render metadata. Metadata binds identity, category-neutral reuse, source resolution, source and output hashes, preset IDs and hashes, crop and typography details, fallback reasons, and stable ordering. It is render evidence, not a production people-artwork manifest.

## Provenance and licensing boundary

Source paths, hashes, dimensions, and acquisition results are retained as provenance. The repository’s code licence does not grant rights to third-party portraits, photographs, source images, or media derived from them. Nuvio does not claim ownership of third-party portrait photography. TMDB attribution and the artwork removal or replacement process are documented in the root README.

# Based on artwork

Ten owner-approved film artwork sets, each containing landscape, focus, title logo and hero. The focus image uses the selected stronger outline. Heroes use a different source image from the cover.

[Manifest](manifest.json) · [Schema](manifest.schema.json) · [Handover](../../../docs/artwork-categories/based-on.md)

| Role | Size | File |
| --- | --- | --- |
| Cover | 1200 × 675 | SLUG/landscape.webp |
| Focus | 1200 × 675 | SLUG/focus.webp |
| Transparent title logo | 1863 × 673 | SLUG/title-logo.webp |
| Hero | 2560 × 1440 | SLUG/hero.webp |

Stable identity is based_on:SLUG. The manifest supplies hashes, byte counts, dimensions, source identities and full artwork URLs. Its titleLogo field maps to title-logo.webp. Asset sourceSha256 records the lossless render master; artworkSources records each original film image.

Categories: Books, Video Games, Comics, True Stories, Myths & Legends (mythology), History, Fairy Tales, Stage Shows, Toys & Games, and TV Shows. Toys & Games covers physical toys/board games; History and True Stories can overlap. These artwork categories do not assert collection membership.

The five old JPGs were retired with owner approval and backed up locally. Their old URLs are not redirects; use the WebP URLs from this manifest for new imports. Existing client caches may retain old images.

The shared master index and general Builder reader are not implemented. Nuvio client framing remains untested.

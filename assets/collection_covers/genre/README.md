# Genre artwork

31 genre sets, eight WebP roles each. `manifest.json` is the category authority; `manifest.schema.json` validates it. Each role includes its exact URL, SHA-256, dimensions and byte count. No general Collection Builder integration is supplied here.

| Role | Location | Dimensions |
| --- | --- | --- |
| Landscape | `wide/<existing stem>.webp` | 1200 x 675 |
| Poster | `vertical/<existing stem>.webp` | 800 x 1200 |
| Landscape focus | `<genre-slug>/focus.webp` | 1200 x 675 |
| Poster focus | `<genre-slug>/poster-focus.webp` | 800 x 1200 |
| Square / square focus | `<genre-slug>/square.webp`, `square-focus.webp` | 800 x 800 |
| Transparent title logo | `<genre-slug>/title-logo.webp` | 1863 x 673 |
| Photographic hero | `<genre-slug>/hero.webp` | 2560 x 1440 |

Cards use original genre lettering on colour backgrounds. Focus adds a coloured title halo and background lift. Heroes and transparent titles remain separate.

The former 62 JPGs are retired. Their replacements preserve the wide/vertical locations and filename stems, except the stray apostrophe in the Queer landscape filename. Extensions change to `.webp`; existing JPG URLs must be updated. `retiredLegacyFiles` in the manifest maps every old path to its new path. Spaces in URL paths are percent-encoded. Science Fiction (`Sci-Fi.webp` poster) and Sci-Fi & Fantasy remain distinct identities.

See [the category handover](../../../docs/artwork-categories/genre.md) for provenance and publication details.

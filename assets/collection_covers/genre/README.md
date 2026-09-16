# Genre artwork

Each of the 31 genre folders contains all eight WebP roles. There are 248 images in total. manifest.json is the category authority; manifest.schema.json validates it. Every role records its exact URL, SHA-256, dimensions and byte count.

| Role | Filename within each genre folder | Dimensions |
| --- | --- | --- |
| landscape | landscape.webp | 1200 x 675 |
| focus | landscape-focus.webp | 1200 x 675 |
| poster | poster.webp | 800 x 1200 |
| posterFocus | poster-focus.webp | 800 x 1200 |
| square | square.webp | 800 x 800 |
| squareFocus | square-focus.webp | 800 x 800 |
| titleLogo | title-logo.webp | 1863 x 673 |
| hero | hero.webp | 2560 x 1440 |

Cards use original genre lettering on colour backgrounds. Focus adds a coloured title halo and background lift. Heroes and transparent titles remain separate.

The former wide and vertical folders are retired. Landscape and poster covers now live beside their matching square, focus, hero and logo files. The formerly generic focus.webp is named landscape-focus.webp. Every artwork byte is unchanged.

Existing references must use the current manifest URLs. retiredLegacyFiles maps all 62 original JPG paths directly to current files. relocatedFiles maps all 93 moved or renamed WebP paths directly to their current files. These mappings are metadata, not HTTP redirects. Science Fiction and Sci-Fi & Fantasy remain distinct genre folders.

No general Collection Builder integration is supplied here. See [the category handover](../../../docs/artwork-categories/genre.md) for provenance and publication details.

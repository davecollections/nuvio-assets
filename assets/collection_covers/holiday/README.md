# Holiday and seasonal artwork

Five approved sets: Christmas, Halloween, Valentine’s, Summer Holidays and Winter Favourites. The seasonal spotlight design uses circular real-film imagery, individual lettering and a matching coloured focus outline.

[Manifest](manifest.json) · [Schema](manifest.schema.json) · [Handover](../../../docs/artwork-categories/holiday.md)

| Role | Dimensions | File |
| --- | --- | --- |
| Cover | 1200 × 675 | SLUG/landscape.webp |
| Focus | 1200 × 675 | SLUG/focus.webp |
| Transparent title logo | 1863 × 673 | SLUG/title-logo.webp |
| Hero | 2560 × 1440 | SLUG/hero.webp |

| Theme | Slug | Film artwork |
| --- | --- | --- |
| Christmas | christmas | Home Alone |
| Halloween | halloween | Hocus Pocus |
| Valentine’s | valentines | Notting Hill |
| Summer Holidays | summer-holidays | Mamma Mia! |
| Winter Favourites | winter-favourites | Frozen |

Stable identity is holiday:SLUG. One shared artwork set is suitable for movie or TV collections; no separate media variants are supplied. These are editorial themes, and the film-artwork choices do not define collection membership or prove catalog availability.

The manifest supplies SHA-256 hashes, dimensions, bytes and full URLs. titleLogo maps to title-logo.webp. Asset sourceSha256 is the lossless render master hash; artworkSources identifies original TMDB film images. Every hero uses a distinct image from its cover. Heroes have no added title or fade. Focus retains the main letter fill and adds a seasonal outline; smaller captions remain unchanged. The Christmas cover has no lower-right foliage.

Christmas.jpg, Halloween.jpg and Valentines.jpg were backed up and retired with approval. Their old URLs are not redirects. New imports should use the manifest’s WebP URLs; existing client caches may retain older images.

The shared master index and general Builder reader are not implemented. Nuvio client framing remains untested.

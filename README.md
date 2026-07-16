# nuvio-assets

Artwork assets for Nuvio, including posters, backdrops, collection covers, and related artwork.

## Studio and network collection covers

The reviewed studio/network library is published by TMDB identity:

- company covers: `assets/collection_covers/companies/{tmdb_id}.webp`;
- TV-network covers: `assets/collection_covers/networks/{tmdb_id}.webp`;
- canonical metadata: `assets/collection_covers/manifest.json`.

Release `studio-network-v1-2026-07-16` contains 1,797 company covers and 569 network covers. Each TMDB ID has its own physical 1200×675 WebP, including identities that share the same source logo. The manifest contains 2,366 deterministically ordered entries and binds every published path to its reviewed hash and byte count.

The batch utility and maintenance policy are documented in `tools/studio-network-batch/README.md`. Artwork that later falls below an automatic eligibility threshold or disappears from current source data is retained as legacy state; it is never deleted automatically.

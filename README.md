# nuvio-assets

Artwork assets for Nuvio, including posters, backdrops, collection covers, and related artwork.

## Studio and network collection covers

The reviewed studio/network library is published by TMDB identity:

- company covers: `assets/collection_covers/companies/{tmdb_id}.webp`;
- TV-network covers: `assets/collection_covers/networks/{tmdb_id}.webp`;
- canonical metadata: `assets/collection_covers/manifest.json`.

Release `studio-network-v1-2026-07-16` contains 1,797 company covers and 569 network covers. Each TMDB ID has its own physical 1200×675 WebP, including identities that share the same source logo. The manifest contains 2,366 deterministically ordered entries and binds every published path to its reviewed hash and byte count.

The batch utility and maintenance policy are documented in `tools/studio-network-batch/README.md`. Artwork that later falls below an automatic eligibility threshold or disappears from current source data is retained as legacy state; it is never deleted automatically.

## People candidate identity foundation

The tracked people foundation contains 619 resolved TMDB candidate identities, 325 actor memberships, and 300 director memberships. Six people belong to both categories through one shared registry identity. Proposed rollout is 200 initial, 100 later, and 25 review actors; and 154 initial, 102 later, and 44 review directors.

These are candidate data and workflow proposals, not a published people collection or artwork approval. The 69 supplement candidates still require individual owner selection. No portrait was generated or downloaded, no TMDB-ID people asset was published, and no people artwork manifest exists.

The model and policy are documented in `data/people/README.md`. Canonical data lives under `data/people/`, strict schemas live under `schemas/`, and fully offline validation lives under `tools/people-seed/`.

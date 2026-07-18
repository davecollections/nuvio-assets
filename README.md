# nuvio-assets

Artwork assets for Nuvio, including posters, backdrops, collection covers, and related artwork.

## Studio and network collection covers

The reviewed studio/network library is published by TMDB identity:

- company covers: `assets/collection_covers/companies/{tmdb_id}.webp`;
- TV-network covers: `assets/collection_covers/networks/{tmdb_id}.webp`;
- canonical metadata: `assets/collection_covers/manifest.json`.

Release `studio-network-v1-2026-07-16` contains 1,797 company covers and 569 network covers. Each TMDB ID has its own physical 1200×675 WebP, including identities that share the same source logo. The manifest contains 2,366 deterministically ordered entries and binds every published path to its reviewed hash and byte count.

The batch utility and maintenance policy are documented in `tools/studio-network-batch/README.md`. Artwork that later falls below an automatic eligibility threshold or disappears from current source data is retained as legacy state; it is never deleted automatically.

## People candidate identity and artwork workflow

The tracked people foundation contains 817 resolved TMDB candidate identities, 523 actor memberships, and 300 director memberships. Six people belong to both categories through one shared registry identity. Proposed rollout is 295 initial, 203 later, and 25 review actors; and 154 initial, 102 later, and 44 review directors.

Reusable tooling is available for explicitly bounded, offline people-artwork publication candidates. No numeric people portrait set is currently published, no production people artwork manifest is committed, and no raw GitHub people-artwork URL is claimed live. The completed locked-40 artwork candidate is held only in ignored local evidence pending a separate portrait-rights and redistribution decision; its artwork and technical package remain approved.

Portrait sources are third-party material. TMDB metadata and hosting do not establish ownership of the underlying photography, and the repository's code licence does not automatically cover portrait rights. Every future candidate record must remain `third-party-portrait-review-required` and preserve exact source provenance. The publication tooling has no network, commit, or push capability and requires an explicit bounded scope.

The identity model is documented in `data/people/README.md`; the offline candidate publication workflow and rights boundary are documented in `tools/people-seed/PUBLICATION.md`. Canonical data lives under `data/people/`, strict schemas live under `schemas/`, and validation lives under `tools/people-seed/`.

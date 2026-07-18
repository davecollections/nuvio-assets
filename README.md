# nuvio-assets

Artwork assets for Nuvio, including posters, backdrops, collection covers, and related artwork.

## Studio and network collection covers

The reviewed studio/network library is published by TMDB identity:

- company covers: `assets/collection_covers/companies/{tmdb_id}.webp`;
- TV-network covers: `assets/collection_covers/networks/{tmdb_id}.webp`;
- canonical metadata: `assets/collection_covers/manifest.json`.

Release `studio-network-v1-2026-07-16` contains 1,797 company covers and 569 network covers. Each TMDB ID has its own physical 1200×675 WebP, including identities that share the same source logo. The manifest contains 2,366 deterministically ordered entries and binds every published path to its reviewed hash and byte count.

The batch utility and maintenance policy are documented in `tools/studio-network-batch/README.md`. Artwork that later falls below an automatic eligibility threshold or disappears from current source data is retained as legacy state; it is never deleted automatically.

## People collection artwork

The tracked people foundation contains 817 resolved TMDB candidate identities, 523 actor memberships, and 300 director memberships. Six people belong to both categories through one shared registry identity. Proposed rollout is 295 initial, 203 later, and 25 review actors; and 154 initial, 102 later, and 44 review directors.

The published people-artwork collection contains exactly 40 TMDB person identities, with one landscape and one poster WebP per person:

- landscape: `assets/collection_covers/people/landscape/{tmdbPersonId}.webp`;
- poster: `assets/collection_covers/people/poster/{tmdbPersonId}.webp`;
- public metadata: `assets/collection_covers/people/manifest.json`.

Actor and director memberships reuse the same category-neutral person artwork identity, including people who belong to both collections. The complete 523-actor and 300-director catalogues are not published. Future people-artwork publication remains explicitly bounded; the tooling has no network, commit, or push capability.

The identity model is documented in `data/people/README.md`, and the offline publication workflow is documented in `tools/people-seed/PUBLICATION.md`. Canonical data lives under `data/people/`, strict schemas live under `schemas/`, and validation lives under `tools/people-seed/`.

## TMDB attribution

[The Movie Database (TMDB)](https://www.themoviedb.org/) is the metadata and image source used by this repository.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Artwork licensing exclusion

The repository's code licence applies to code only. It does not grant rights to third-party artwork, portraits, photographs, logos, trademarks, film or television imagery, source images, or media assets derived from third-party source material. No ownership of third-party artwork is claimed.

## Artwork removal or replacement

To request removal, replacement, or an attribution correction for an artwork asset, open an [artwork removal or replacement issue](https://github.com/davecollections/nuvio-assets/issues/new?template=artwork-removal-or-replacement.yml) and identify the affected repository path or URL. Please do not post sensitive personal information. The asset can be reviewed and, where appropriate, removed or replaced. A text-only person fallback is available when a portrait asset is removed.

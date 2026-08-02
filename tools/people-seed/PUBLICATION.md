# People artwork publication workflow

The people publication workflow is offline and explicitly bounded. It validates already selected artwork, preserves exact technical provenance, and writes repository asset paths and manifests. It does not search for people, broaden a selection, access the network, download sources or fonts, commit, push, or upload.

## Current publication

The published scope is the frozen pre-v3 snapshot of 817 of the current 1,480 registry identities. It records the earlier 523-person Actor and 300-person Director catalogue state across their initial, later, and review tiers. Each published identity has one 1200 × 675 landscape WebP and one 1000 × 1500 poster WebP, for 1,634 files total and zero fallbacks.

The manifest intentionally excludes the 663 net-new People v3 identities. It also retains Director-only membership metadata for already illustrated Greta Gerwig (45400) and Erich von Stroheim (8630); their newly approved Actor memberships exist only in the tracked catalogue until a later atomic publication. Actor/director overlap remains category-neutral, so a shared identity has one landscape and one poster rather than category-specific duplicates.

Published paths are:

```text
assets/collection_covers/people/landscape/{tmdbPersonId}.webp
assets/collection_covers/people/poster/{tmdbPersonId}.webp
assets/collection_covers/people/manifest.json
```

Actor and director memberships reuse the same category-neutral person identity. Already-published overlaps, including later-tier actors who also have director memberships, do not receive category-specific duplicate artwork.

## Manifest contract

`schemas/people-artwork-manifest.schema.json` validates candidate, commit-ready, and published manifests. The published manifest retains identity, category membership, source decisions, source paths, source hashes and dimensions, asset paths, final raw URLs, asset hashes and byte counts, renderer metadata, preset bindings, font bindings, deterministic ordering, and TMDB attribution.

Published records omit internal workflow fields. `publishedAt` is the only timestamp excluded from the published manifest fingerprint; the fingerprint itself is also excluded. Replaying finalization with the same source manifest and fixed timestamp must reproduce identical records, ordering, URLs, counts, and fingerprint.

## Bounded offline workflow

Candidate generation requires an explicit selector (`--locked-pilot`, `--stable-key`, `--stable-key-file`, or a seed with a category tier), explicit paths, and exact parity evidence. There is no `--all` mode. Candidate generation renders offline and stops before permanent writes if parity fails.

Finalization reads an explicitly named ignored source manifest, requires its exact SHA-256 and fingerprint, validates the bound local decision evidence, and verifies every already restored asset before writing the public manifest. It does not render or re-encode artwork.

Validation commands from the repository root:

```powershell
npm --prefix tools/people-seed run publication:validate
npm --prefix tools/people-seed test
npm --prefix tools/people-seed run validate
npm --prefix tools/people-seed run artwork:validate
npm --prefix tools/people-seed run artwork:font-check
```

Commit and push are always separate manual operations outside the publication tooling. Future publication must remain an explicit bounded selection.

## Attribution, licensing, and asset requests

The root README contains TMDB attribution, excludes third-party artwork and imagery from the code licence, and links the GitHub Issue process for artwork removal, replacement, or attribution correction. The text-only person fallback remains available when a portrait asset is removed.

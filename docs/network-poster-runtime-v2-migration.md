# Network poster runtime v2 migration

Status: compatibility and publication tooling implemented; publication not authorised

## Approved contract

The future poster release adds exactly one 1000×1500 WebP for every published network at:

```text
assets/collection_covers/networks/poster/{networkId}.webp
```

It upgrades the studio/network manifest to `studio-network-canonical-manifest-v2` and the runtime lookup to `schemaVersion: 2`. Each v2 network entry has exactly:

```text
id, name, status, landscape, poster, fallbackUsed, reviewRequired
```

Companies remain landscape-only. People and all existing landscape paths and bytes remain unchanged. The shared resolver accepts runtime v1 and v2; v1 network poster is unsupported and v2 network poster is required. The classic v1 adapter retains its landscape-only public interface.

## Manifest and decision rules

Manifest v2 preserves the v1 `entries`, `publicationMetadata`, `stagingContentFingerprint`, and `approvalStateHash` landscape structures. It adds a parallel `posterPublicationMetadata` section whose schema is `tools/studio-network-batch/schemas/network-poster-publication-entry.schema.json`.

Poster-specific background exceptions are stored in `tools/studio-network-batch/config/network-poster-decisions.json`. Each decision binds the exact network ID, TMDB `logo_path`, source SHA-256, output SHA-256/bytes, and approval hash. A changed source path or hash makes the decision stale and blocks publication. These decisions apply only to poster orientation; they do not change landscape artwork or the global Variant B preset.

The approved `network:184` Syndication text fallback is stored separately from source-logo decisions and remains bound to its identity, name, Inter typography, output SHA-256/bytes, and approval hash.

## Release gate and order

The real release ID must match:

```text
studio-network-posters-v2-YYYY-MM-DD
```

The release timestamp and ID are supplied only during the authorised publication task. Before any public write, the transaction must prove:

- all 572 candidate bytes, dimensions, hashes, deterministic replay evidence, source bindings, and approval hashes still match;
- no target path exists and no network poster identity is missing or duplicated;
- manifest v2 and runtime v2 validate, with exactly 572 network posters;
- the shared resolver passes v1 and v2 tests, company poster remains unsupported, and the v1 adapter interface remains unchanged;
- the repository is clean and the public landscape/people inventories match their protected baseline.

Preparation occurs below ignored `.work`; it does not write public files. The future authorised install must place the 572 posters, then the canonical manifest, then the runtime lookup last. Those changes form one atomic Git commit so consumers never receive runtime v2 without its referenced assets. A failed local install must roll back before any commit.

## Current state

`npm --prefix tools/studio-network-batch run poster-publication-dry-run` performs the full offline proof against the approved ignored evidence and reports zero public writes. Public installation is deliberately locked until a separate publication instruction supplies the real release ID/timestamp and authorises the atomic release. No runtime v2 UI integration is part of this work.

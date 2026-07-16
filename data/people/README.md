# Nuvio people candidate foundation

This directory contains Nuvio's durable TMDB-ID-first people candidate data. It records resolved identities, source provenance, and proposed category rollout. It is not a published people collection and does not approve any portrait artwork.

## Files and responsibilities

- `people-registry.json` contains each of the 619 resolved TMDB people exactly once. It owns shared identity metadata, relative TMDB profile-path metadata, identity evidence, category membership, and all 737 preserved source occurrences.
- `actors-seed.json` contains 325 category-specific actor memberships and their proposed rollout and selection signals.
- `directors-seed.json` contains 300 category-specific director memberships and their proposed rollout and selection signals.
- `sources.json` records the six source snapshots and cross-checks, their retrieval metadata, hashes where available, extraction boundaries, and known limitations.

The registry deliberately has no global rollout tier or global category selection tier. A person can have different actor and director treatment, so rollout, recommendation, selection basis, and owner decision belong to the category membership records.

## Identity and category membership

Every stable key is `person:{tmdbPersonId}` and every person appears once in the registry. Actor and director records reference that key and ID rather than duplicating profile metadata.

Six current people belong to both categories: Orson Welles, Clint Eastwood, Buster Keaton, Gene Kelly, Charlie Chaplin, and Mel Brooks. Each has one registry record, one actor membership, and one director membership. Their two category records remain independent; neither category's rollout status becomes a global property of the person.

All 619 identities are candidates. The registry's `reviewStatus: candidate`, a membership's `selectionStatus: proposed`, and a proposed `initial` tier do not constitute final inclusion, final ordering, portrait approval, or permission to publish artwork. All `ownerDecision` fields remain null.

## Rollout tiers

Rollout tiers divide a future review workload without claiming artistic superiority:

- `initial`: proposed first rollout — 200 actors and 154 directors;
- `later`: proposed later rollout — 100 actors and 102 directors;
- `review`: individual owner selection remains required — 25 actors and 44 directors.

The `recommendedAction` values preserve the completed build's `include-initial`, `include-later`, and `manual-selection-review` proposals. The 69 review candidates were not silently approved.

## Selection basis

`selectionBasis` is an array because more than one documented signal can apply:

- `ranker-core`: present in the captured Ranker actor ranks 1–300;
- `tspdt-all-time`: present in TSPDT's 2026 all-time top-250 director rows;
- `tspdt-21st-century`: present in TSPDT's 2026 21st-century top-100 director rows;
- `cross-source`: present in more than one relevant source;
- `external-supplement`: proposed from a bounded external cross-check rather than the category's ranking source;
- `modern-supplement`: supported by the bounded TSPDT 21st-century source while absent from its all-time top 250;
- `owner-added`: reserved for a later explicit owner addition.

The 25 ImKaptain-only actor candidates use `external-supplement`; they are not inferred to be modern merely because they appear in that cross-check. The 43 TSPDT 21st-century-only director candidates retain `modern-supplement`. Greta Gerwig remains an `external-supplement` review candidate. Multiple-source evidence is separately represented by `cross-source`.

## Source provenance and ranking semantics

Every original source occurrence is retained in the registry, including source spelling, source rank, row type, Ranker ontology ID where recorded, and secondary MDBList catalogue IDs where recorded. Directing-team rows remain identifiable as `directing-team-member`. Michael Powell retains both TSPDT all-time occurrences: rank 35 as part of “Michael Powell & Emeric Pressburger” and rank 210 as an individual.

Ranker is dynamic and user-voted. TSPDT is a source ranking and critical-list aggregation, not objective truth. `sourceRank` records where a source placed a person; it does not define final Nuvio order. `initial`, `later`, `ranker-core`, and `tspdt-all-time` are workflow and provenance labels, not claims of artistic superiority. Final category inclusion and viewer-facing ordering remain later owner decisions.

The ImKaptain data is identity/catalogue cross-check provenance only. Its artwork fields were not promoted. Its 20 MDBList catalogue IDs remain strings under `secondaryCatalogIds`; none is treated as a TMDB person ID. Tracked people data contains no full portrait URL, external artwork URL, API credential, response token, or local absolute path. `profilePath` is relative TMDB metadata only.

## Artwork and publishing boundary

No portrait was downloaded or generated for this foundation. No TMDB-ID people portrait is published, and no people artwork manifest exists.

The proposed future physical path is:

```text
assets/collection_covers/people/{tmdb_person_id}.webp
```

Future actor and director manifests should reference the same physical person asset for a shared TMDB person ID. Portrait sourcing, visual treatment, final inclusion, manifest design, and publication all require separate owner decisions. Existing generic people artwork is not a dependency of this data foundation, and no third-party artwork dependency was introduced.

## Validation and owner review

The strict schemas are:

- `schemas/people-registry.schema.json`
- `schemas/people-seed.schema.json`
- `schemas/people-sources.schema.json`

Run the fully offline checks from the repository root:

```powershell
npm --prefix tools/people-seed test
npm --prefix tools/people-seed run validate
```

The validator enforces cross-file identity, ordering, rollout, source-occurrence, shared-person, portability, and protected-path rules that JSON Schema cannot express alone.

Blank, ignored owner-review templates are generated under:

```text
tools/people-seed/.work/people-seed-foundation/owner-review/
```

Only the 25 actor and 44 director `review` candidates receive individual decision rows. These templates are not authoritative decisions and are not tracked.

The next artwork step, only after separate owner authorization, is a 40-person visual proof: 24 actors and 16 directors. That proof should define and review portrait sourcing, crop, background, typography, rights/provenance, and shared-person reuse before any larger image run or manifest work.

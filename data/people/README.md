# Nuvio people candidate foundation

This directory contains Nuvio's durable TMDB-ID-first people candidate data. It records resolved identities, source provenance, and proposed category rollout. It is not a published people collection and does not approve any portrait artwork.

## Files and responsibilities

- `people-registry.json` contains each of the 817 resolved TMDB people exactly once. It owns shared identity metadata, relative TMDB profile-path metadata, identity evidence, category membership, and all 1,069 preserved source occurrences.
- `actors-seed.json` contains 523 category-specific actor memberships: the original 325 proposals plus 198 owner-approved supplement additions.
- `directors-seed.json` contains 300 category-specific director memberships and their proposed rollout and selection signals.
- `actor-owner-supplement.json` is the durable, schema-validated record of the 198 approved actor additions, their resolved identities, owner decisions, rollout tiers, provenance, and planning-only specialty tags.
- `sources.json` records 13 source snapshots, cross-checks, and owner-decision provenance records, their retrieval metadata, hashes where available, extraction boundaries, and known limitations.

The registry deliberately has no global rollout tier or global category selection tier. A person can have different actor and director treatment, so rollout, recommendation, selection basis, and owner decision belong to the category membership records.

## Identity and category membership

Every stable key is `person:{tmdbPersonId}` and every person appears once in the registry. Actor and director records reference that key and ID rather than duplicating profile metadata.

Six current people belong to both categories: Orson Welles, Clint Eastwood, Buster Keaton, Gene Kelly, Charlie Chaplin, and Mel Brooks. Each has one registry record, one actor membership, and one director membership. Their two category records remain independent; neither category's rollout status becomes a global property of the person.

All 817 registry identities retain the category-neutral `reviewStatus: candidate`; that status never approves portrait artwork or publication. The original 325 actor memberships and all 300 director memberships remain `selectionStatus: proposed` with blank owner decisions. The 198 supplement actor memberships are different: their catalogue inclusion and initial/later tier were explicitly approved, so they use `selectionStatus: owner-decided` and `ownerDecision: include`. This approval still does not approve final ordering, portrait sourcing, cover artwork, or publication.

## Rollout tiers

Rollout tiers divide a future review workload without claiming artistic superiority:

- `initial`: first rollout — 295 actors and 154 directors;
- `later`: later rollout — 203 actors and 102 directors;
- `review`: individual owner selection remains required — 25 actors and 44 directors.

The actor totals include 95 approved initial additions and 103 approved later additions. No supplement actor was assigned to review. The original 25 actor and 44 director review candidates were not silently approved.

## Selection basis

`selectionBasis` is an array because more than one documented signal can apply:

- `ranker-core`: present in the captured Ranker actor ranks 1–300;
- `tspdt-all-time`: present in TSPDT's 2026 all-time top-250 director rows;
- `tspdt-21st-century`: present in TSPDT's 2026 21st-century top-100 director rows;
- `cross-source`: present in more than one relevant source;
- `external-supplement`: proposed from a bounded external cross-check rather than the category's ranking source;
- `modern-supplement`: supported by the bounded TSPDT 21st-century source while absent from its all-time top 250;
- `owner-added`: explicit owner-approved actor supplement provenance; used by all 198 promoted additions.

The 25 ImKaptain-only actor candidates use `external-supplement`; they are not inferred to be modern merely because they appear in that cross-check. The 43 TSPDT 21st-century-only director candidates retain `modern-supplement`. Greta Gerwig remains an `external-supplement` review candidate. Multiple-source evidence is separately represented by `cross-source`.

## Source provenance and ranking semantics

Every original source occurrence is retained in the registry, including source spelling, source rank, row type, Ranker ontology ID where recorded, and secondary MDBList catalogue IDs where recorded. Directing-team rows remain identifiable as `directing-team-member`. Michael Powell retains both TSPDT all-time occurrences: rank 35 as part of “Michael Powell & Emeric Pressburger” and rank 210 as an individual.

Ranker is dynamic and user-voted. TSPDT is a source ranking and critical-list aggregation, not objective truth. `sourceRank` records where a source placed a person; it does not define final Nuvio order. `initial`, `later`, `ranker-core`, and `tspdt-all-time` are workflow and provenance labels, not claims of artistic superiority. The supplement has explicit category inclusion decisions; original proposed memberships and all viewer-facing ordering remain separate owner decisions.

The 198-person actor supplement was approved after a bounded comparison of a current-famous Ranker list, two IMDb user lists, IMDb STARmeter, a highest-grossing-actors table, Filmaholic's top-100 list, and the owner's catalogue decision. These sources have deliberately limited meanings:

- current-famous and STARmeter evidence describes time-sensitive popularity, not durable importance or acting quality; STARmeter is the volatile weekly snapshot captured July 18, 2026;
- commercial-gross evidence is affected by franchises, methodology, market coverage, credit scope, and changing totals;
- user and editorial lists reflect their authors, voters, language, and selection criteria;
- Filmaholic's rendered page was Cloudflare-blocked, so its complete exact-page list came from a recent search-engine crawl, was weighted conservatively, and never governed inclusion by itself;
- specialty tags are planning-only labels and are not production categories or quality rankings;
- all 198 inclusions and the 95/103 tier split are owner catalogue decisions recorded after the comparison.

Unavailable response hashes and ranks remain null; none was fabricated. The tracked supplement preserves the five approved canonical-name normalisations and retains each relevant owner-supplied spelling as an alias.

The ImKaptain data is identity/catalogue cross-check provenance only. Its artwork fields were not promoted. Its 20 MDBList catalogue IDs remain strings under `secondaryCatalogIds`; none is treated as a TMDB person ID. Tracked people data contains no full portrait URL, external artwork URL, API credential, response token, or local absolute path. `profilePath` is relative TMDB metadata only.

## Artwork and publishing boundary

No portrait was downloaded or generated for this foundation. No TMDB-ID people portrait is published, and no people artwork manifest exists.

The promoted `profilePath` values are relative identity metadata only. They were read from the approved local evidence and do not indicate that an image was fetched, licensed, reviewed, or published.

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
- `schemas/actor-owner-supplement.schema.json`

Run the fully offline checks from the repository root:

```powershell
npm --prefix tools/people-seed test
npm --prefix tools/people-seed run validate
npm --prefix tools/people-seed run check-actor-supplement
```

The validator enforces cross-file identity, ordering, rollout, source-occurrence, shared-person, portability, and protected-path rules that JSON Schema cannot express alone.

`npm --prefix tools/people-seed run build-foundation` deterministically rebuilds the original foundation inputs and then merges `actor-owner-supplement.json`. This prevents a future rebuild from dropping the approved additions. The narrower promotion command is idempotent and rejects supplement overlap, unsupported source IDs, duplicate identities, duplicate actor memberships, unapproved decisions, and tier drift.

Blank, ignored owner-review templates are generated under:

```text
tools/people-seed/.work/people-seed-foundation/owner-review/
```

Only the original 25 actor and 44 director `review` candidates receive individual blank decision rows. The supplement's ignored promotion-proof review files are informational because all 198 inclusion and tier decisions are already approved.

People artwork remains a separate owner-authorised workflow. This data promotion did not change the locked 40-person proof, Stage 3 typography, portrait-source decisions, fallback decisions, permanent assets, or manifests.

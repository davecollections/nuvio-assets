# Nuvio people candidate foundation

This directory contains Nuvio's durable TMDB-ID-first people candidate data. It records resolved identities, source provenance, and proposed category rollout. It is not a published people collection and does not approve any portrait artwork.

## Files and responsibilities

- `people-registry.json` contains each of the 1,480 resolved TMDB people exactly once. It owns shared identity metadata, relative-or-null TMDB profile-path metadata, identity evidence, category membership, and all 1,735 preserved source occurrences.
- `actors-seed.json` contains 1,071 category-specific actor memberships: the original 325 proposals, 198 historical owner-approved supplement additions, and 548 owner-approved v3 additions.
- `directors-seed.json` contains 418 category-specific director memberships: the original 300 proposals plus 118 owner-approved v3 additions.
- `actor-owner-supplement.json` is the durable, schema-validated record of the 198 approved actor additions, their resolved identities, owner decisions, rollout tiers, provenance, and planning-only specialty tags.
- `people-owner-supplement-v3.json` preserves the exact 665-identity, 666-category-action owner-approved v3 package, its authoritative source SHA-256, its audit-workspace path, and the deterministic mapping into active catalogue data. It does not replace or modify the historical Actor supplement.
- `sources.json` records 15 source snapshots, cross-checks, and owner-decision provenance records, their retrieval metadata, hashes where available, extraction boundaries, and known limitations.

The registry deliberately has no global rollout tier or global category selection tier. A person can have different actor and director treatment, so rollout, recommendation, selection basis, and owner decision belong to the category membership records.

## Identity and category membership

Every stable key is `person:{tmdbPersonId}` and every person appears once in the registry. Actor and director records reference that key and ID rather than duplicating profile metadata.

Nine current people belong to both categories: Orson Welles (40), Clint Eastwood (190), Roberto Benigni (4818), Erich von Stroheim (8630), Buster Keaton (8635), Gene Kelly (13294), Charlie Chaplin (13848), Mel Brooks (14639), and Greta Gerwig (45400). Each has one registry record, one actor membership, and one director membership. Their two category records remain independent; neither category's rollout status becomes a global property of the person.

All 1,480 registry identities retain the category-neutral `reviewStatus: candidate`; that status never approves portrait artwork or publication. The original 325 actor memberships and 300 director memberships remain `selectionStatus: proposed` with blank owner decisions. The historical 198-person Actor supplement retains its approved initial/later decisions. Every v3 category action uses `selectionStatus: owner-decided`, `ownerDecision: include`, and initial rollout. These catalogue decisions still do not approve final ordering, portrait sourcing, cover artwork, manifest membership, runtime availability, or publication.

## Rollout tiers

Rollout tiers divide a future review workload without claiming artistic superiority:

- `initial`: first rollout — 843 actors and 272 directors;
- `later`: later rollout — 203 actors and 102 directors;
- `review`: individual owner selection remains required — 25 actors and 44 directors.

The historical Actor supplement contributes 95 initial and 103 later memberships. People v3 contributes 548 initial Actor and 118 initial Director memberships, with no later, review, held, or ask-owner decisions. The original 25 actor and 44 director review candidates were not silently approved.

## Selection basis

`selectionBasis` is an array because more than one documented signal can apply:

- `ranker-core`: present in the captured Ranker actor ranks 1–300;
- `tspdt-all-time`: present in TSPDT's 2026 all-time top-250 director rows;
- `tspdt-21st-century`: present in TSPDT's 2026 21st-century top-100 director rows;
- `cross-source`: present in more than one relevant source;
- `external-supplement`: proposed from a bounded external cross-check rather than the category's ranking source;
- `modern-supplement`: supported by the bounded TSPDT 21st-century source while absent from its all-time top 250;
- `owner-added`: explicit historical owner-approved Actor supplement provenance; used by all 198 earlier additions;
- `owner-approved-v3`: exact hash-bound owner approval provenance; used by all 548 Actor and 118 Director v3 actions.

The 25 ImKaptain-only actor candidates use `external-supplement`; they are not inferred to be modern merely because they appear in that cross-check. The 43 TSPDT 21st-century-only director candidates retain `modern-supplement`. Greta Gerwig's Director membership remains an `external-supplement` review candidate. Multiple-source evidence is separately represented by `cross-source`.

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

The category-neutral People v3 supplement embeds the authoritative package verbatim and binds it to SHA-256 `4cfa65603935726d21fef8ce6919f344e6ab834f7a8b730711415ecef730d650`. Exact set reconciliation adds 663 registry identities, adds Actor membership to existing Greta Gerwig and Erich von Stroheim identities, and creates Roberto Benigni once with both Actor and Director membership. Two category-scoped owner-package source records preserve all 666 actions with `sourceRank: null` and `retrievalTimestamp: null`; no source rank or retrieval event was invented. The authoritative package's 32 literal `"-"` alias placeholders remain in the supplement as source evidence but are excluded by the declared mapping from active registry aliases. Other aliases and relative-or-null profile paths are preserved exactly. Career snapshot fields unavailable in the authority remain null rather than being inferred.

The ImKaptain data is identity/catalogue cross-check provenance only. Its artwork fields were not promoted. Its 20 MDBList catalogue IDs remain strings under `secondaryCatalogIds`; none is treated as a TMDB person ID. Tracked people data contains no full portrait URL, external artwork URL, API credential, response token, or local absolute path. `profilePath` is relative TMDB metadata only.

## Artwork and publishing boundary

The identity foundation itself acquired no portrait. A separate, explicitly bounded and validated publication remains frozen at the earlier 817-person snapshot, with 817 landscape and 817 poster WebPs plus a public manifest and zero published fallbacks. It intentionally excludes all 663 net-new v3 identities. Greta Gerwig and Erich von Stroheim already have published artwork as Directors, but the frozen manifest does not yet contain their new Actor memberships. The 1,480-person catalogue must not be described as illustrated, runtime-ready, or published until a separately authorised atomic artwork publication.

The promoted `profilePath` values are relative identity metadata only. A profile path by itself does not indicate the state of any corresponding artwork asset.

The exact v3 readiness audit currently identifies 663 catalogue-only identities: 496 have usable tracked profile paths requiring bounded source acquisition and 167 have no usable tracked profile path and therefore require fallback or owner investigation. No existing approved local source-cache entry applies to that delta. These counts are audit evidence, not publication authority; the tooling recalculates the exact ID sets from tracked catalogue, manifest, runtime, and physical-file state.

Published physical paths are:

```text
assets/collection_covers/people/landscape/{tmdb_person_id}.webp
assets/collection_covers/people/poster/{tmdb_person_id}.webp
assets/collection_covers/people/manifest.json
```

Future presentation assets remain ungenerated and unpublished. The prepared contract keeps transparent `title-logo/{tmdb_person_id}.png` files and the single existing `people hero backdrop.jpg` in a separate additive `presentation-manifest.json`; runtime schemaVersion 2 continues to resolve only Poster and Landscape assets. The final focused proof uses the locked Cormorant Garamond 700 Person name plus the fixed word `COLLECTION` in the exact locked, unmodified Limelight 400 font. D1 and D2 in `tools/people-seed/presets/people-title-logo-collection-options-v3.json` differ only in COLLECTION scale, tracking, and vertical spacing; no permanent option is selected. No graphic element is part of the title-logo contract. Any exceptional line break must be exact-ID-bound and schema-valid in `data/people/title-logo-line-break-overrides.json`.

The 13 owner-approved chin-safe Landscape corrections are active, source-bound additions in `data/people/landscape-chin-safe-overrides.json`. They are merged with the unchanged original 154-record Landscape override file by the shared resolver, preserving the locked right edge and top alignment while ensuring chin, jawline, beard, and neck breathing room. They never apply to Poster rendering.

Actor and director collections reference the same physical person assets for a shared TMDB person ID. Published actor/director overlaps reuse the same category-neutral artwork and do not create category-specific duplicates. Existing generic people artwork is not a dependency of this workflow. Publication scope must always be explicitly bounded, and the tooling contains no network, commit, or push automation.

The public manifest preserves source and output provenance, exact hashes, dimensions, preset bindings, and final raw asset URLs. TMDB attribution and the repository's third-party artwork licensing exclusion are stated in the root README. See `tools/people-seed/PUBLICATION.md`.

## Validation and owner review

The strict schemas are:

- `schemas/people-registry.schema.json`
- `schemas/people-seed.schema.json`
- `schemas/people-sources.schema.json`
- `schemas/actor-owner-supplement.schema.json`
- `schemas/people-owner-supplement-v3.schema.json`
- `schemas/people-artwork-manifest.schema.json`
- `schemas/people-presentation-manifest.schema.json`
- `schemas/people-landscape-chin-safe-overrides.schema.json`
- `schemas/people-title-logo-line-break-overrides.schema.json`

Run the fully offline checks from the repository root:

```powershell
npm --prefix tools/people-seed test
npm --prefix tools/people-seed run validate
npm --prefix tools/people-seed run check-actor-supplement
npm --prefix tools/people-seed run validate-people-owner-supplement-v3
npm --prefix tools/people-seed run check-people-owner-supplement-v3
```

The staged v3 artwork preparation modes are explicit and must use one unique ignored attempt root. Run audit first, acquire only the representative proof sources, generate the two-run proof, then prepare plans and verify the protected public state:

```powershell
npm --prefix tools/people-seed run artwork-v3:audit -- --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ
npm --prefix tools/people-seed run artwork-v3:acquire-proof-sources -- --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ
npm --prefix tools/people-seed run artwork-v3:proof -- --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ
npm --prefix tools/people-seed run artwork-v3:plan -- --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ
npm --prefix tools/people-seed run artwork-v3:verify-protected -- --attempt-root tools/people-seed/.work/people-v3-artwork-proof/attempt-YYYYMMDDTHHMMSSZ
```

These modes guard all outputs below ignored `.work`, do not authorise the complete 1,480-title-logo or 663-pair generation, and do not write the public People manifest, runtime lookup, presentation manifest, or permanent artwork.

The validator enforces cross-file identity, ordering, rollout, source-occurrence, shared-person, portability, and protected-path rules that JSON Schema cannot express alone.

`npm --prefix tools/people-seed run build-foundation` deterministically rebuilds the original foundation inputs, merges the historical `actor-owner-supplement.json`, and then merges `people-owner-supplement-v3.json`. This prevents a future rebuild from dropping either approved workstream. The v3 validator compares the complete embedded package meaning and canonical bytes with the exact authoritative hash when the ignored authority is available; it also rejects identity/action drift, unsupported identifier namespaces, incorrect current-state classification, duplicate identities or categories, and non-initial or non-include decisions.

`npm --prefix tools/people-seed run verify-actor-supplement-build` performs two complete rebuilds in disposable directories, requires byte-identical replay and exact parity with the tracked foundation, and never points the builder at active tracked People files. The builder also preserves the exact-ID correction from commit `18e0748`: the invalid source alias `markiplier` is excluded only from TMDB person `115440` (Sydney Sweeney). Alias corrections are keyed only by exact TMDB Person ID, never by record position or display name.

Blank, ignored owner-review templates are generated under:

```text
tools/people-seed/.work/people-seed-foundation/owner-review/
```

Only the original 25 actor and 44 director `review` candidates receive individual blank decision rows. The supplement's ignored promotion-proof review files are informational because all 198 inclusion and tier decisions are already approved.

People v3 promotion previews and the tracked-diff review package are generated below `tools/people-seed/.work/people-catalogue-v3-promotion/`. They prove two-run byte parity, exact category-action accounting, preservation of every prior identity and membership, and the artwork/publication boundary without writing artwork.

People artwork remains a separate bounded workflow. The locked 40-person renderer proof remains preserved as historical promotion evidence; publishing the frozen 817-person collection did not rewrite that proof, Stage 3 typography, portrait-source decisions, or fallback decisions.

# People artwork publication workflow

The people publication workflow turns an explicitly bounded, already reviewed artwork selection into local permanent-path candidates. It does not access the network, commit, push, upload, publish, or acquire portrait sources. Candidate generation is always offline and uses the committed deterministic renderer in `src/people-artwork/renderer.mjs`.

No numeric people portrait set or production people artwork manifest is currently committed or published. The completed locked-40 artwork and technical package is approved but held only in ignored local evidence while portrait redistribution rights remain under review. Consequently, no proposed raw GitHub people-artwork URL is currently claimed live.

## Identity and paths

One TMDB person ID owns at most one landscape cover and one poster cover:

```text
assets/collection_covers/people/landscape/{tmdbPersonId}.webp
assets/collection_covers/people/poster/{tmdbPersonId}.webp
assets/collection_covers/people/manifest.json
```

Actor and director memberships reference the same category-neutral person identity. The workflow never creates actor-specific or director-specific artwork copies. Existing generic people JPGs remain separate legacy collection artwork and are not inputs to the TMDB-ID publication workflow.

The manifest is validated by `schemas/people-artwork-manifest.schema.json`. Its fingerprint excludes `publicationCandidateAt` and `manifestFingerprint`; all identity, provenance, asset, renderer, preset, font, status, URL-proposal, and rights fields remain fingerprint-bound.

## Locked-40 pilot and current hold

The completed pilot used only:

```text
tools/people-seed/.work/people-proof-selection/drafts/people-proof-set.lock.draft.json
```

That lock contains 24 actor selections, 16 director selections, and 40 unique people in an owner-approved order. The pilot requires both formats, exact byte-and-hash parity with `tools/people-seed/.work/people-production-promotion-proof`, all 40 approved cache hits, and zero network requests. A parity failure stops before any permanent candidate asset or manifest write.

The exact candidate is retained in an ignored workspace such as `tools/people-seed/.work/people-publication-pilot/held-publication-candidate/`. That relative path is local evidence, not a tracked or public distribution location. All 40 distribution decisions are `hold` pending the separate portrait-rights decision; no visual revision is required.

Generate the candidate from the repository root:

```powershell
npm --prefix tools/people-seed run publication -- --locked-pilot --format both --asset-root assets/collection_covers/people --manifest assets/collection_covers/people/manifest.json --work-root tools/people-seed/.work/people-publication-pilot --source-cache tools/people-seed/.work/people-production-promotion-proof/source-cache --proof-root tools/people-seed/.work/people-production-promotion-proof --candidate
```

Plan without rendering or writing:

```powershell
npm --prefix tools/people-seed run publication -- --locked-pilot --dry-run
```

Validate the framework state, or an existing permanent-path candidate when one is present:

```powershell
npm --prefix tools/people-seed run publication:validate
```

With no candidate present, this succeeds with `candidatePresent: false`. After an explicitly authorised restoration, `--manifest <repository-path>` requires that manifest to exist and performs full manifest and asset validation.

Future runs must use an explicit bounded selector (`--stable-key`, `--stable-key-file`, or `--seed` with an optional category tier), an explicit output root, and an approved parity-evidence root for that exact selection. There is no `--all` mode. `--commit-ready` requires a completed owner-decision CSV and still performs no Git or public distribution action. Commit and push, if later authorised, remain separate manual operations outside this tooling.

## Owner review and URL proposals

New candidate runs write ignored reports, deterministic contact sheets, and an initially blank decision file under:

```text
tools/people-seed/.work/people-publication-pilot/
```

Allowed owner decisions are `publish`, `hold`, `revise`, and `remove-from-pilot`. The completed held pilot has exactly 40 `hold` decisions in ignored owner-review evidence; hold decisions remain separate from the candidate manifest. Candidate manifest URLs use this proposal format:

```text
https://raw.githubusercontent.com/davecollections/nuvio-assets/main/{repositoryPath}
```

They are proposals only. No candidate URL is live until a later explicitly authorised commit and push makes that exact path and hash available.

## Rights and attribution

These covers are transformations of third-party portrait sources. TMDB provides metadata and image hosting but may not own the underlying photography. The repository's code licence does not automatically cover or transfer rights in portrait photography.

Public redistribution therefore requires a separate explicit project decision after rights review. The manifest preserves the exact resolved profile path, source hash, source dimensions, source-decision provenance, and `third-party-portrait-review-required` status for every person. No portrait attribution or rights holder is invented when the evidence does not establish one, and the repository makes no ownership claim over the underlying portrait photography.

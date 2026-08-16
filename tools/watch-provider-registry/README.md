# Watch Provider registry tool

This package owns the deterministic refresh of `data/watch-providers/registry.json`. It does not publish artwork or update runtime lookup data.

Run the offline checks from the repository root:

```powershell
npm --prefix tools/watch-provider-registry test
npm --prefix tools/watch-provider-registry run check
npm --prefix tools/watch-provider-registry run artwork-check
```

## Artwork mapping

`data/watch-providers/artwork-map.json` is the curated Watch Provider artwork contract. Each `provider:<id>` key maps directly to a repository-relative company, network, or provider artwork path. Absence means the provider is unmapped and awaiting artwork review; shared paths are valid.

Prefer an existing published Network cover whenever it accurately represents the provider service or its core service brand. Distribution suffixes such as `Amazon Channel` and `Apple TV Channel` do not require separate provider artwork when the underlying service already has suitable published Network artwork. A small or low-quality TMDB Watch Provider logo does not override a suitable existing Network cover. Use provider-specific artwork only when no accurate published reusable cover exists or the owner explicitly requires a distinct treatment.

The automatic studio/network title-count threshold controls unattended batch eligibility; it does not block an exact provider-driven Network identity. Under the standing owner decision recorded on 2026-08-16, any unmapped provider may use an existing exact Network ID, and the required Network artwork may be staged and published as an explicit below-threshold exception when it is not already public. The normal exact-identity, deterministic staging, review, hash binding, canonical-manifest, runtime, and preservation gates still apply; this does not authorise fuzzy brand matches or bulk publication without verified provider-to-Network identity.

Run `npm --prefix tools/watch-provider-registry run artwork-check` after registry refreshes or mapping edits. It validates the map and lists unmapped providers with their media coverage and TMDB `logoPath`. Maintenance remains: inspect TMDB artwork, prepare a provider cover only if required, save it as `assets/collection_covers/providers/{providerId}.webp`, add the direct mapping, and rerun the check. The provider-specific path is a reserved convention only; this tool does not create provider artwork or publication infrastructure.

V2 consumes the JSON directly:

```js
const path = artworkMap.providers[`provider:${providerId}`];
```

Mapped values are repository-relative. Consumers prepend a configurable repository or CDN asset base URL; no additional generated lookup is required.

The live refresh reads `NUVIO_PEOPLE_SERVICE_TOKEN` from the current process, makes exactly the three catalogue requests defined by issue #7, validates the complete candidate in memory, and atomically writes only changed canonical LF bytes:

```powershell
npm --prefix tools/watch-provider-registry run refresh
```

To exercise the same live generation and diff path without writing the registry, append `-- --check`. Never paste or place the token in a command, URL, file, fixture, or log.

The repository workflow at `.github/workflows/watch-provider-registry-refresh.yml` runs at 03:17 UTC on the 3rd and 17th of each month and can be dispatched from `main` without inputs. It uses the existing refresh command once, validates the result, and treats the actual registry Git diff as authoritative. No-change runs create no branch or PR activity. Changed registries are proposed through the permanent machine-owned `automation/watch-provider-registry-refresh` branch and a reusable owner-review PR; the workflow never publishes directly to `main` or merges the PR.

Generated Watch Provider registry refresh PRs must be accepted with GitHub's **merge commit** method; do not squash or rebase them. This preserves the exact machine-generated commit as an ancestor of `main` for the next branch-safety check. This rule applies to the recurring machine-generated registry refresh PRs, not every PR in the repository.

Hosted acceptance follows this owner-controlled sequence:

1. Finish and review the local A2 implementation.
2. Publish the A2 implementation branch as a review PR, then review and approve that PR.
3. **Before merging the A2 implementation PR**, enable the repository Actions setting commonly labelled `Allow GitHub Actions to create and approve pull requests`. This permits the workflow token to create a registry refresh PR; this workflow still contains no approval, self-review, or merge path.
4. **Before merging the A2 implementation PR**, securely add `NUVIO_PEOPLE_SERVICE_TOKEN` as a repository Actions secret in `nuvio-assets`. Never put its value in this repository, a command, a URL, logs, fixtures, PR text, or chat.
5. Merge the approved A2 implementation PR.
6. Manually dispatch the workflow from `main` and inspect the first hosted acceptance result.

GitHub currently places `pull_request` workflow runs caused by a `GITHUB_TOKEN`-created or updated PR into an approval-required state, while the automation branch push does not trigger ordinary `push` workflows. This is a platform characteristic for future CI design, not a reason to add a PAT to this refresh.

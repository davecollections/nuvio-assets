# Artwork runtime lookup

`assets/collection_covers/runtime-lookup.json` is the compact, browser-friendly index of published company, TV-network, and people artwork. Its stable raw URL is:

```text
https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection_covers/runtime-lookup.json
```

Consumers should keep the raw asset base URL configurable. The current recommended base is:

```text
https://raw.githubusercontent.com/davecollections/nuvio-assets/main/
```

Every artwork path in the lookup is repository-relative. Resolve an asset with `baseUrl + entry.landscape.path` or `baseUrl + entry.poster.path`; individual entries intentionally do not duplicate full raw GitHub URLs. This permits the same lookup to work with raw GitHub, a CDN, a backend proxy, local development, or mirrored/bundled assets.

## Identity and sections

Look up the exact TMDB numeric ID, represented as a string object key, in one of `companies`, `networks`, or `people`. Company and network IDs remain separate identity namespaces. The matching entry repeats its numeric `id` and includes the canonical published `name`.

Company and network entries are landscape-only 1200×675 WebPs. People entries contain a 1200×675 landscape and a 1000×1500 poster. One people entry may contain `actor`, `director`, or both categories; overlap does not create a duplicate identity or duplicate artwork.

The runtime file is generated only from the two complete publication manifests:

- `assets/collection_covers/manifest.json`;
- `assets/collection_covers/people/manifest.json`.

Those manifests remain the source of truth for provenance, source images, rendering, crop, typography, audit, and review metadata.

## Automatic-use and cache policy

Only already-published records safe for automatic use are included. Every runtime entry has `status: "published"` and `reviewRequired: false`. A published fallback remains included with `fallbackUsed: true`; approved-but-unpublished, unpublished, review-required, candidate, internal-only, and removed records are omitted. A removal takes effect on the next rebuild.

Paths are identity-stable but their bytes can change after an approved replacement. Each orientation therefore includes the published asset SHA-256. A cache-safe URL is:

```js
resolvedAssetUrl + "?v=" + assetSha256.slice(0, 12)
```

An approved replacement can retain its path while changing its asset hash and the lookup fingerprint. The lookup fingerprint is deterministic and can also version a lookup request when a consumer already knows the expected release fingerprint.

## Browser example

```js
const baseUrl = "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/";
const lookupUrl = new URL("assets/collection_covers/runtime-lookup.json", baseUrl);
const lookup = await fetch(lookupUrl).then((response) => {
  if (!response.ok) throw new Error(`Artwork lookup failed: ${response.status}`);
  return response.json();
});

const companyId = 10156; // Exact TMDB company ID.
const entry = lookup.companies[String(companyId)];

if (entry) {
  const artworkUrl = new URL(entry.landscape.path, baseUrl);
  artworkUrl.searchParams.set("v", entry.landscape.sha256.slice(0, 12));
  console.log(entry.name, artworkUrl.href);
}
```

## Maintenance

From the repository root:

```powershell
npm --prefix tools/artwork-runtime-lookup run build
npm --prefix tools/artwork-runtime-lookup run validate
npm --prefix tools/artwork-runtime-lookup test
```

Build and validation verify both source manifests, every referenced byte count and SHA-256, WebP decoding and dimensions, schema and semantic rules, deterministic ordering, source parity, unique paths, and the embedded fingerprint. The output is minified JSON with one trailing newline and is not rewritten when its bytes are unchanged.

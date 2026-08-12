# Watch Provider registry tool

This package owns the manual, deterministic refresh of `data/watch-providers/registry.json`. It does not publish artwork or update runtime lookup data.

Run the offline checks from the repository root:

```powershell
npm --prefix tools/watch-provider-registry test
npm --prefix tools/watch-provider-registry run check
```

The live refresh reads `NUVIO_PEOPLE_SERVICE_TOKEN` from the current process, makes exactly the three catalogue requests defined by issue #7, validates the complete candidate in memory, and atomically writes only changed canonical LF bytes:

```powershell
npm --prefix tools/watch-provider-registry run refresh
```

To exercise the same live generation and diff path without writing the registry, append `-- --check`. Never paste or place the token in a command, URL, file, fixture, or log.

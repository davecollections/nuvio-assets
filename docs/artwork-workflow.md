# Shared artwork workflow

Start here for every new artwork category or resumed category task. This guide carries project decisions between tasks; a previous conversation is not required. Read the root [AGENTS.md](../AGENTS.md) and the category's own handover before editing.

## Current publication map

Based on and Holiday last checked: 2026-09-08; other rows retain their category verification dates. Recheck the actual manifests and working tree when resuming; older narrative documentation can describe a previous release.

| Category | Current authority and consumer | Handover |
| --- | --- | --- |
| Companies and Networks | Published together in assets/collection_covers/manifest.json; the builder-facing assets/collection_covers/runtime-lookup.json is currently schemaVersion 2. | [Studio/network status](../tools/studio-network-batch/PROJECT_STATUS.md), [runtime guide](artwork-runtime-lookup.md) |
| Decades | Category manifest schemaVersion 2 supplies 194 WebPs: 98 preserved original images plus 96 approved poster/square cover/focus files. All images and category metadata are published and live-hash verified; original files and URLs are preserved. Not included in runtime-lookup.json. | [Decades handover](artwork-categories/decades.md) |
| People | Legacy People files and lookup entries remain in this repo. Active V2 Builder People artwork uses the separate nuvio-people-assets repository and its manifests/people.json. | Respect the existing People ownership boundary; do not migrate or delete its assets as part of another category. |
| Awards | Preparation exists in data/awards and tools/awards-artwork in the current working tree. No published Awards category manifest was established by this task. | Inspect the existing Awards work and its instructions before starting; do not overwrite another task's changes. |
| Discover | Category manifest schemaVersion 2 now supplies 120 WebPs: the 60 original roles plus 60 approved poster/square cover/focus assets. The new shapes use 30 distinct English-original/US-origin title images. All 120 images and both metadata URLs are published and live-hash verified; original files and URLs preserved. Refresh cadence is investigated, with no schedule enabled. General Builder support is not implemented. | [Discover handover](artwork-categories/discover.md) |
| Based on | Category manifest schemaVersion 2 supplies eighty WebPs: forty preserved originals plus forty approved poster/square cover/focus files. All images and category metadata are published and live-hash verified; original paths and bytes are preserved. Category manifest: assets/collection_covers/based_on/manifest.json. General Builder integration absent. | [Based on handover](artwork-categories/based-on.md) |
| Holiday and seasonal | Category manifest schemaVersion 2 supplies forty WebPs across five themes: twenty preserved originals plus twenty approved poster/square cover/focus files. All images and category metadata are published and live-hash verified; original paths and bytes are preserved. Category manifest: assets/collection_covers/holiday/manifest.json. General Builder integration absent. | [Holiday handover](artwork-categories/holiday.md) |
| Genres | Category manifest schemaVersion 2 supplies 248 approved WebPs across 31 eight-role sets. Original lettering on colour cards, A focus and photographic heroes replace all 62 legacy JPGs. Existing wide/vertical filename stems are retained where clear, with .webp extensions and exact migration mappings. No general Builder integration or runtime-lookup entry. | [Genres handover](artwork-categories/genre.md) |
| Other folders | Existing folders do not by themselves prove a category manifest or automatic builder support exists. | Inspect that category's files and consumers; document the actual state. |

## Manifest direction and implementation status

The agreed direction is a small master index pointing to separate category manifests. The builder will discover categories from one entry point and load the category it needs. Each category should describe consistent concepts: stable identity, content variants where applicable, available artwork roles, file paths or resolved URLs, SHA-256 hashes, dimensions and byte counts.

The shared master index, common category JSON schema and general builder reader are **not implemented or published yet**. This document is a working agreement, not that runtime. Do not invent a live index URL, claim that publishing a category automatically integrates it into the builder, or create competing master indexes in separate tasks. Reuse an implemented shared contract if one exists when the task starts; otherwise record the proposed category mapping in its handover and stage the candidate schema for review.

Public artwork manifests must not contain quoted conversations, personal approval comments, or other owner remarks. Keep approval status and exact reviewed hashes as metadata; keep the original wording in local review evidence rather than exporting it. Category schemas must not require comment fields.

Existing formats remain authoritative until an explicit migration. Companies/Networks can remain in their shared manifest and be referenced together. Categories do not need to move images or split working publication tools merely to fit the planned index. Only published categories and assets belong in a public runtime index.

## Start a category

1. Inspect git status, relevant diffs, the publication map above, existing category outputs and any ignored review evidence. Preserve other tasks' work. Use the applicable existing tests before generation or implementation.
2. Create or update a persistent category handover under docs/artwork-categories/ using the [category template](artwork-category-template.md). Establish the stable category key, identity source, selected items, content variants, required asset roles, source provenance and intended final paths before rendering.
3. Reuse existing real artwork and cached source evidence first. Use exact verified identities for new source requests. Prefer deterministic compositing, typography and cropping over AI image generation; use AI-generated imagery only when the user explicitly asks for it.
4. Prepare proofs and scripts in the existing ignored staging area, with a unique category/revision directory. For an established category tool with its own ignored .work directory, preserve its documented staging workflow. Do not delete or recreate ignored output directories.
5. Update the publication map with the category's handover and actual status. A planned path must be labelled planned, never presented as an available URL.

## Asset and delivery decisions

Use WebP for new runtime artwork deliveries, choosing the smallest encoding that retains acceptable visual quality. Keep lossless masters and original source files in ignored work storage. Inspect faces, text, gradients and transparency at useful display sizes; record output dimensions, byte counts, encoding settings and quality evidence. Preserve existing category presets and legacy published formats unless a change is authorised. Do not download or commit fonts.

List only the roles the category actually supplies: landscape cover, portrait poster, matching focus variants, title logo and hero as appropriate. Multiple orientations or media variants must be explicit. Do not invent placeholder URLs or force every category to have every role. Decades, Discover, Based on and Holiday now supply eight roles per set: three cover/focus pairs plus one title logo and one hero. The approved format extensions add to their original four-role sets while preserving their paths and bytes; other categories retain their own documented roles.

Keep hero artwork separate from title logos and year/caption overlays unless a category has an explicit different design. The owner reports that Nuvio applies a left fade even in full-screen hero mode. Judge the image as a full frame, retain a clear subject and use actual Nuvio evidence when available; a local mockup is not proof of the application's crop or layout.

For replacements, preserve the existing filename, path and canonical URL. Update hashes and byte counts from the exact delivered files. A new manifest hash does not invalidate an already imported Nuvio collection's cached URL. Versioned URLs or commit-pinned preview URLs can be used for a deliberate fresh-image test; verify the actual responses. Never promise an automatic client refresh time without evidence from that client/version.

## Review, publish and hand over

Prepare all authorised staging and validation work before asking for any still-required final approval. Existing owner approvals remain valid within their exact scope; record the approval, stable key, final target and reviewed output hash. A changed render needs its own matching review evidence. Approval of one category or revision does not approve unrelated releases.

Before publishing, validate the category schema, identities and variants, exact file membership, decoded formats and dimensions, hashes, source records and any public manifest/index updates. Back up replaced files, preserve unrelated assets and working changes, and report the selected replacements and unchanged outputs. Public artwork and canonical manifests require the publishing authorisation described in AGENTS.md. Do not commit or push unless explicitly asked; do not add another permission step when the needed authorisation is already present.

When publishing is authorised, update only the approved assets and their category metadata, plus an existing shared index if that release requires it. Verify live URLs against the committed hashes after an authorised push. Keep repo publication, builder integration and acceptance inside Nuvio as separate recorded states. Builder changes belong in tmdb-id-lookup only when the user explicitly places that repository in scope.

At each durable milestone, update the category handover with decisions, exact review/approval evidence locations, reproducible commands, changed and preserved outputs, validation, publication commit and manifest URL where real, remaining work, and the next concrete action. Keep credentials, private local paths and raw source caches out of tracked handovers. Prefer repository-relative paths; identify ignored evidence as local-only and explain when it may be absent in another checkout.

## Starting another task

Open the nuvio-assets project and ask for the category. A useful opening message is: "Create artwork for [category]. Follow AGENTS.md and docs/artwork-workflow.md; inspect the category handover and existing work before generating anything."

Codex discovers repository AGENTS.md guidance when starting a run; see [official OpenAI documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md). These files must exist in the checkout used by that task. Local edits are available in this checkout; new worktrees or clones need a Git revision containing the documents. Already-running tasks should explicitly reread the updated guide. This mechanism does not give unrelated chats access to the repository or to private conversation history.

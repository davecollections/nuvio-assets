# Shared artwork workflow

Start here for every new artwork category or resumed category task. This guide carries project decisions between tasks; a previous conversation is not required. Read the root [AGENTS.md](../AGENTS.md) and the category's own handover before editing.

## Current publication map

Last checked: 2026-09-05. Recheck the actual manifests and working tree when resuming; older narrative documentation can describe a previous release.

| Category | Current authority and consumer | Handover |
| --- | --- | --- |
| Companies and Networks | Published together in assets/collection_covers/manifest.json; the builder-facing assets/collection_covers/runtime-lookup.json is currently schemaVersion 2. | [Studio/network status](../tools/studio-network-batch/PROJECT_STATUS.md), [runtime guide](artwork-runtime-lookup.md) |
| Decades | Published separately in assets/collection_covers/decades/manifest.json, with its own schema. Not included in runtime-lookup.json. | [Decades handover](artwork-categories/decades.md) |
| People | Legacy People files and lookup entries remain in this repo. Active V2 Builder People artwork uses the separate nuvio-people-assets repository and its manifests/people.json. | Respect the existing People ownership boundary; do not migrate or delete its assets as part of another category. |
| Awards | Preparation exists in data/awards and tools/awards-artwork in the current working tree. No published Awards category manifest was established by this task. | Inspect the existing Awards work and its instructions before starting; do not overwrite another task's changes. |
| Discover | Approved Discover release: 60 WebPs plus a category manifest/schema; 12 legacy JPGs retired after backup. Commit/push authorised; live verification is recorded in the handover. Heroes have unique titles/images within each hero. General Builder support is not implemented. | [Discover handover](artwork-categories/discover.md) |
| Other folders | Existing folders such as genre, holiday and based_on do not by themselves prove a category manifest or automatic builder support exists. | Inspect that category's files and consumers; document the actual state. |

## Manifest direction and implementation status

The agreed direction is a small master index pointing to separate category manifests. The builder will discover categories from one entry point and load the category it needs. Each category should describe consistent concepts: stable identity, content variants where applicable, available artwork roles, file paths or resolved URLs, SHA-256 hashes, dimensions and byte counts.

The shared master index, common category JSON schema and general builder reader are **not implemented or published yet**. This document is a working agreement, not that runtime. Do not invent a live index URL, claim that publishing a category automatically integrates it into the builder, or create competing master indexes in separate tasks. Reuse an implemented shared contract if one exists when the task starts; otherwise record the proposed category mapping in its handover and stage the candidate schema for review.

Existing formats remain authoritative until an explicit migration. Companies/Networks can remain in their shared manifest and be referenced together. Categories do not need to move images or split working publication tools merely to fit the planned index. Only published categories and assets belong in a public runtime index.

## Start a category

1. Inspect git status, relevant diffs, the publication map above, existing category outputs and any ignored review evidence. Preserve other tasks' work. Use the applicable existing tests before generation or implementation.
2. Create or update a persistent category handover under docs/artwork-categories/ using the [category template](artwork-category-template.md). Establish the stable category key, identity source, selected items, content variants, required asset roles, source provenance and intended final paths before rendering.
3. Reuse existing real artwork and cached source evidence first. Use exact verified identities for new source requests. Prefer deterministic compositing, typography and cropping over AI image generation; use AI-generated imagery only when the user explicitly asks for it.
4. Prepare proofs and scripts in the existing ignored staging area, with a unique category/revision directory. For an established category tool with its own ignored .work directory, preserve its documented staging workflow. Do not delete or recreate ignored output directories.
5. Update the publication map with the category's handover and actual status. A planned path must be labelled planned, never presented as an available URL.

## Asset and delivery decisions

Use WebP for new runtime artwork deliveries, choosing the smallest encoding that retains acceptable visual quality. Keep lossless masters and original source files in ignored work storage. Inspect faces, text, gradients and transparency at useful display sizes; record output dimensions, byte counts, encoding settings and quality evidence. Preserve existing category presets and legacy published formats unless a change is authorised. Do not download or commit fonts.

List only the roles the category actually supplies: landscape cover, portrait poster, matching focus variants, title logo and hero as appropriate. Multiple orientations or media variants must be explicit. Do not invent placeholder URLs or force every category to have every role. The exact four-file requirement belongs to Decades; it is not a universal rule for companies, networks or future categories.

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

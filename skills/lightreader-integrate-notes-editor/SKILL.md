---
name: lightreader-integrate-notes-editor
description: Integrate or evolve LightReader's local-first note editor with Tiptap while keeping editor UI, document schema, autosave, Repository persistence, book/annotation links, sanitization, accessibility, and migrations isolated. Use for installing Tiptap, configuring extensions, building toolbars, persisting editor JSON, importing/exporting notes, or testing rich-text editing.
---

# Integrate the notes editor

## Confirm scope and model

1. Read `AGENTS.md`, the notes feature, database boundaries, and [tiptap.md](references/tiptap.md).
2. Confirm the task explicitly authorizes installing Tiptap; it is intentionally absent from the project skeleton.
3. Read [note-model.md](references/note-model.md) before creating a migration or persistence format.
4. Load `$lightreader-extend-feature` for page/UI work and `$lightreader-evolve-data-platform` for schema or Repository changes.

Decide whether the task needs plain notes, book-linked notes, annotation-linked notes, or all three. Do not build collaboration or cloud sync unless explicitly requested.

## Separate editor concerns

Keep four layers:

1. Domain note types and versioned persisted document shape.
2. Notes Repository and autosave application Service.
3. Tiptap configuration/commands that translate editor state to the domain shape.
4. React editor surface and accessible toolbar.

Do not import SQL or Tauri bindings into the editor component. Do not expose Tiptap `Editor` or ProseMirror types from Repository contracts.

## Install minimally

Use pnpm and install only the Tiptap packages required by the requested feature, keeping all `@tiptap/*` packages on the same exact compatible version. Start with the React binding, core, and a deliberate extension set. Avoid community extensions until their maintenance, license, bundle cost, and serialization behavior are reviewed.

## Persist deliberately

Use Tiptap JSON as the canonical rich document only after defining `schemaVersion`. Store plain text as derived/searchable content when needed, not as a second writable source of truth. Debounce autosave, serialize saves per note, flush on blur/navigation/close, expose saving/error/saved states, and preserve unsaved content after a failed write.

Never store editor instances, HTML DOM, selection objects, or transaction objects. Sanitize any HTML import and restrict links/protocols.

## Build accessible editing

- Give toolbar controls pressed/disabled semantics and labels.
- Support keyboard shortcuts without trapping platform navigation.
- Keep focus stable when opening menus and applying commands.
- Reflect unavailable commands through disabled state.
- Provide an empty state, initial loading state, save failure recovery, and corrupt-document fallback.
- Test light/dark styles, long documents, IME composition, and paste when in scope.

## Test and verify

- Unit-test document migrations, serializers, and autosave ordering with fake timers.
- Component-test typing, formatting, toolbar state, keyboard use, failed save, retry, and unmount flush.
- Repository-test document round trips and annotation/book links.
- Add E2E for the smallest create-edit-reload flow.
- Run standard project gates and native/database checks when persistence changes.

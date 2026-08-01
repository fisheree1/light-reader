# Notes editor and quote blocks

LightReader's independent notes use Tiptap 3 behind a feature-local editor
boundary. React editor components do not import SQL or Tauri APIs, and
Repositories never expose Tiptap `Editor`, ProseMirror nodes, DOM selections, or
transactions.

## Persistence model

Migration `0006_notes.sql` creates `notes` with an application-generated ID,
title, canonical `content_json`, derived `plain_text`, and timestamps. The
canonical document is wrapped as:

```ts
interface NoteDocument {
  schemaVersion: 1;
  content: NoteContentNode;
}
```

`content_json` is validated on read. Corrupt JSON opens as a clearly marked
empty recovery document rather than being injected into Tiptap. `plain_text` is
derived from JSON on every Repository write and is not a second writable source
of truth.

## Editor schema

The extension list is centralized in `note-extensions.ts`:

- StarterKit for headings, paragraphs, lists and basic marks;
- the official Markdown extension for Markdown parsing, serialization and input;
- Placeholder for the empty editor hint;
- `BookQuoteNode` for immutable EPUB source snapshots.

StarterKit links are disabled because opening and sanitizing arbitrary URL
protocols is outside this slice. Markdown export/import UI is also not exposed
yet; JSON remains the persisted representation.

## BookQuoteNode

A quote block stores only stable IDs, an immutable text snapshot and a versioned
EPUB locator:

```ts
interface BookQuoteReference {
  bookId: string;
  annotationId: string;
  quote: string;
  chapter: string | null;
  locator: BookLocator;
}
```

It does not embed a Book or Annotation row. Deleting the source Annotation leaves
the snapshot intact. Clicking the block routes to `/reader/:bookId` with the
locator; the reader uses the locator as a fallback when the Annotation no longer
exists.

## Autosave

The UI debounces ordinary edits by 700 ms and flushes on editor blur, note
switch, route change and unmount. `NoteService` serializes writes per note, so an
older request cannot complete after and overwrite a newer save. Failed writes
leave the draft in React-local state, display a retry action and do not mark the
document as saved.

The Web test runtime uses a localStorage Repository. Tauri uses the SQLite
Repository and applies `0006_notes.sql` through the existing SQL plugin; no new
native capability is required.

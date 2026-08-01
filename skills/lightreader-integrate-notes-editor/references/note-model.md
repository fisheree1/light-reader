# Note document model

Define the persisted shape independently from Tiptap runtime objects. A starting point is:

```ts
interface NoteDocument {
  schemaVersion: number;
  content: unknown;
}
```

Validate `content` at the editor boundary with the active extension schema. Keep database row types private to the Repository.

## Stable records

A note record may contain:

- Stable application-generated ID.
- Title or derived display label.
- Versioned rich document JSON.
- Derived plain text for preview/search.
- Created and updated timestamps.
- Optional optimistic concurrency revision.

Represent links to books and annotations in join records or explicit link entities when many-to-many behavior is required. Do not embed entire book metadata, annotation rows, or binary excerpts inside editor JSON.

## Autosave invariants

- At most one write per note is in flight, or writes are revision-checked.
- An older save completion must never overwrite newer content.
- Failed writes leave the editor dirty and offer retry.
- Navigating or closing attempts a final flush without silently discarding content.
- Loading a different note cannot apply the previous note's delayed save.

## Schema evolution

Increment `schemaVersion` when stored editor JSON semantics change. Write pure, ordered document migration functions and test old fixtures. Add a SQLite migration only when table/column/index structure changes; editor-document migrations and database migrations solve different problems.

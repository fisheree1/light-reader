# LightReader export formats

## Annotation export

JSON annotation exports use:

- `format`: `lightreader-annotations`
- `formatVersion`: `1`
- `exportedAt`: ISO 8601 timestamp
- `book`: readable book snapshot (`id`, `title`, `author`, `identifier`)
- `annotations`: stable records containing text, note, color, chapter, versioned locator, and timestamps

Readers must reject unknown future major `formatVersion` values instead of
guessing their meaning. Markdown exports carry the same format name and version
in their header and are intended for people rather than round-trip import.

## Note export

Notes can be exported individually or together as Markdown or standalone HTML.
Book quote nodes are flattened to a readable quote plus a snapshot of the book
title, chapter, progression, and EPUB CFI. The export does not depend on Tiptap
runtime types.

## Backup format

`.lightreader-backup` archives use `formatVersion: 2`.

- Database mode contains `database.sqlite`, `manifest.json`, and the summary.
- Full mode additionally contains hashed files below
  `assets/light-reader/books/` and `assets/light-reader/covers/`.

Full restore checks archive hashes, managed paths, required capacity, and
conflicts before confirmation. Confirmation uses backup-wins semantics for the
database and managed EPUB/cover paths. Native restore keeps the previous asset
directories until the database transaction succeeds and restores them on
failure.

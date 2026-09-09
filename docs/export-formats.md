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

`.lightreader-backup` is a recovery and migration format rather than a content
export format. Its manifest version, database/full modes, validation rules and
restore transaction are defined in [`data-backup.md`](data-backup.md).

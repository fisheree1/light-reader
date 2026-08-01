# Data model rules

## Repository contract

A Repository owns SQL statements, row types, row-to-domain mapping, and transaction boundaries. Its consumer should not know table names or Tauri SQL result shapes.

Prefer explicit methods such as `findById`, `listRecent`, `saveProgress`, or `deleteBook` over a generic CRUD base class. Domain operations make invariants testable and keep SQL changes local.

## Migration checklist

- Add the next immutable `NNNN_description.sql` file.
- Make forward behavior deterministic for both empty and populated databases.
- Preserve user data; document any irreversible transformation.
- Add indexes only for demonstrated query patterns and verify query shape.
- Use foreign keys and uniqueness constraints for actual invariants.
- Decide cascade/restrict behavior explicitly.
- Register the migration in `src-tauri/src/lib.rs` in ascending order.
- Test upgrading from the previous schema, not only creating a fresh database.

## Suggested ownership

- `books`: metadata, content hash, format, disk reference, import timestamps.
- `reading_progress`: book id, serialized versioned locator, update time.
- `annotations`: book id, stable locator/range, style, selected text, timestamps.
- `notes`: independent editor document plus links to zero or more annotations/books.

These names are guidance, not authorization to create tables. Add only schema requested by the active task.

Avoid large BLOBs, derived UI state, ephemeral DOM positions, and upstream-library objects. Plan backup/export and future sync around stable IDs and timestamps without implementing cloud sync prematurely.

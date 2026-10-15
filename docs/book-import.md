# Book import architecture

LightReader imports EPUB, PDF, MOBI, AZW3, FB2 and CBZ files through
application boundaries rather than from a React component:

```text
LibraryPage / useLibrary
  -> BookImportService
     -> FileDialogAdapter
     -> ContentHasher
     -> EpubMetadataParser (EPUB)
     -> FoliateBookMetadataParser (MOBI, AZW3, FB2, CBZ)
     -> BookFileStorage
     -> BookRepository
```

The browser E2E suite supplies an IndexedDB repository and a deterministic
mock importer. The Tauri application composes the real dialog, AppData file
storage and SQLite repository. This keeps unit and browser tests independent of
native dialogs without changing production behavior.

## Import and rollback

The native picker accepts one or many supported books. A batch is processed
sequentially so parsing and file copies do not create an unbounded memory spike.
Every file has an independent result (`created`, `duplicate`, or `failed`); one
invalid or missing file does not roll back books already committed.

For each selected file, the import service follows this order:

1. select and read the source file;
2. accept only `.epub`, `.pdf`, `.mobi`, `.azw3`, `.fb2` or `.cbz`; validate
   the EPUB ZIP/package structure, the PDF signature, the `BOOKMOBI` header
   (MOBI/AZW3), the `<FictionBook` root (FB2), or a ZIP containing at least
   one image (CBZ). A mismatching file fails with `INVALID_EBOOK`;
3. hash the content and stop before copying when that hash already exists;
4. parse EPUB metadata and an optional raster cover; MOBI, AZW3, FB2 and CBZ
   metadata and covers come from Foliate's own parsers (CBZ uses its first
   page as the cover); PDF imports use the file name as the initial title and
   do not synthesize a cover;
5. write the book and optional cover to a generated temporary directory;
6. atomically rename the book to its generated final path;
7. insert the validated `Book` through `BookRepository`;
8. remove temporary files.

Files are finalized before the database insert so a database row never points
to a missing book. If the insert fails, the service removes the final directory,
cover and any staging data only after it confirms that the new row does not
exist, or successfully deletes a row whose commit result was uncertain. If that
verification or compensating delete fails, the finalized managed files are
retained so a possibly committed row never points at a missing book. A process
crash in the narrow interval between file rename and database insert can leave
an unreferenced file, but cannot create a broken shelf record. A future
maintenance task can safely reconcile such orphaned directories.

Cover extraction is best effort. A missing, unsupported or unwritable cover does
not fail the book import; the shelf renders its built-in default cover instead.

## Persistent data

Migration `0002_create_books.sql` creates `books`; `0010` and
`0012_foliate_formats.sql` widen its `format` CHECK constraint. It stores the domain ID,
format, display metadata, SHA-256 hash, file size, timestamps and generated
relative paths. `file_hash` is unique and is the duplicate-import identity.
Book content and cover bytes are never stored as SQLite BLOBs.

All database rows and decoded `metadata_json` values are validated with Zod at
the repository boundary before becoming domain objects.

## Managed files and permissions

Paths are generated from an application UUID and are relative to Tauri's
`AppData` directory:

```text
light-reader/
├── books/<book-id>/book.<epub|pdf|mobi|azw3|fb2|cbz>
├── covers/<book-id>.<jpeg|png|webp|gif>
└── tmp/<book-id>/...
```

The selected source path is used only for the initial read authorized by the
system dialog. It is not persisted. Filesystem write, rename and cleanup scopes
remain limited to `$APPDATA/light-reader/**`; the application does not receive
general filesystem access.

## Foliate-rendered formats

MOBI, AZW3, FB2 and CBZ are rendered by the same Foliate reader as EPUB and use
the same CFI-based `epub` locator, so highlights, bookmarks, reading positions
and notes work unchanged. Full-text search and AI retrieval extract text per
Foliate section and address each section with a section-level CFI
(`epubcfi(/6/<2n>)`) that the reader navigates by section index. CBZ comics are
image-only: they can be read but have no searchable text, and AI questions
report `TEXT_UNAVAILABLE`.

# EPUB and PDF import architecture

LightReader imports EPUB and PDF files through application boundaries rather
than from a React component:

```text
LibraryPage / useLibrary
  -> BookImportService
     -> FileDialogAdapter
     -> ContentHasher
     -> EpubMetadataParser (EPUB only)
     -> BookFileStorage
     -> BookRepository
```

The browser E2E suite supplies a local-storage repository and a deterministic
mock importer. The Tauri application composes the real dialog, AppData file
storage and SQLite repository. This keeps unit and browser tests independent of
native dialogs without changing production behavior.

## Import and rollback

The import service follows this order:

1. select and read the source file;
2. accept only `.epub` or `.pdf`; validate the EPUB ZIP/package structure or
   the PDF file signature;
3. hash the content and stop before copying when that hash already exists;
4. parse EPUB metadata and an optional raster cover; PDF imports use the file
   name as the initial title and do not synthesize a cover;
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

Migration `0002_create_books.sql` creates `books`. It stores the domain ID,
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
├── books/<book-id>/book.epub|book.pdf
├── covers/<book-id>.<jpeg|png|webp|gif>
└── tmp/<book-id>/...
```

The selected source path is used only for the initial read authorized by the
system dialog. It is not persisted. Filesystem write, rename and cleanup scopes
remain limited to `$APPDATA/light-reader/**`; the application does not receive
general filesystem access.

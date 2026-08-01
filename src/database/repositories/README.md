# Repository convention

Repositories are the only application-layer entry point for persistent business data. A repository may use the shared SQL client or another data source, but React components must not issue SQL or call Tauri APIs directly.

Add a repository only with its owning feature. Keep database rows private to the repository, map them to domain types at the boundary, and cover reads, writes, errors, and migrations with tests.

`BookRepository`, `LibraryRepository`, `ReaderSettingsRepository`,
`AnnotationRepository`, `NoteRepository`, and `SearchRepository` follow this boundary. SQLite implementations validate write
values and returned rows, translate database failures to the shared `AppError`,
and expose only domain objects. EPUB files and covers remain on disk; annotation
rows contain only user-created text, bounded context, stable CFI locators,
colors, and timestamps. Notes persist versioned editor JSON as their canonical
content and derived plain text for FTS5 search; Tiptap runtime objects never
cross the Repository boundary. `SearchRepository` owns FTS query construction,
runtime row validation, derived-index replacement, and rebuild transactions.
EPUB chapter text is searchable derived data and can be recreated from the
managed book file.

`LibraryRepository` owns book list search/sort, favorites, tags, and the
database half of deletion. A delete that removes quote blocks updates affected
note JSON/plain text and deletes the book in one transaction. File staging and
restoration stay in `BookFileDeletionStorage`; React calls the coordinating
`LibraryManagementService`, never SQL or Tauri filesystem APIs.

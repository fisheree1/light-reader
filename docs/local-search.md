# Local search

LightReader searches only local data. It does not call a cloud service, external
API, Elasticsearch, or another search process.

## SQLite schema

Migration `0007_local_search.sql` creates three FTS5 trigram tables:

- `notes_fts`: note id, title, and derived plain text;
- `annotations_fts`: annotation id and selected source text;
- `book_content_index`: book id, chapter href, chapter title, and extracted
  chapter text.

Triggers keep note and annotation indexes synchronized with their source tables.
Deleting a book removes its chapter index. EPUB binaries and covers remain on
disk and are never copied into SQLite BLOB columns.

Trigram tokenization supports Chinese and English substring matching. Queries
containing a token shorter than three Unicode characters use an escaped local
`LIKE` query because FTS5 trigram cannot match those tokens reliably.

## EPUB indexing

`FflateEpubContentParser` reads the EPUB container and OPF spine, selectively
inflates only referenced HTML/XHTML chapters, removes script/style content, and
stores normalized plain text. It never executes book scripts and does not expose
Foliate or DOM types outside the parser.

`LocalSearchService` lazily indexes books missing from `book_content_index`
before a search. A corrupt book is reported as a partial indexing failure while
search results from healthy local data remain available. “重建索引” repopulates
the note and annotation FTS tables, clears EPUB derived data, and recreates every
readable book index from the managed application data directory.

Search results navigate using stable application data:

- note id for independent notes;
- annotation id plus serialized locator for highlights;
- book id plus chapter href for EPUB text.

No DOM selector, page number, arbitrary external path, or full EPUB archive is
stored in the search index.

## AI single-book retrieval index

Migration `0011_ai_book_chunks.sql` adds the separate, rebuildable
`ai_book_chunks` FTS5 trigram index. It is not canonical user data and is not the
same index used by the global search page. Each row stores a bounded plain-text
chunk, its source file hash, chapter snapshot, stable EPUB/PDF locator, ordinal,
text hash, and an estimated token count.

The AI retrieval service lazily rebuilds one book when its file hash differs.
EPUB content comes from the package spine; PDF content comes from the local
PDF.js text layer, page by page. Scanned PDFs with no text layer return an
explicit `TEXT_UNAVAILABLE` state. Queries are scoped to one book and return at
most eight chunks under a total context budget. Adjacent chunks may be merged,
but their source ids remain attached for validation and traceability.

Deleting a SQLite book triggers removal of its AI chunks. The browser test
adapter performs the same cleanup in localStorage. Neither index copies the
original EPUB/PDF binary, calls a network service, or gives the model access to
SQL and managed file paths.

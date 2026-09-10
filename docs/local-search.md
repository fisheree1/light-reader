# Local search

LightReader searches only local data. It does not call a cloud service, external
API, Elasticsearch, or another search process.

## SQLite schema

Migration `0007_local_search.sql` creates three FTS5 trigram tables:

- `notes_fts`: note id, title, and derived plain text;
- `annotations_fts`: annotation id and selected source text;
- `book_content_index`: book id, format-neutral section key, section label, and
  extracted EPUB chapter or PDF page text.

Triggers keep note and annotation indexes synchronized with their source tables.
Deleting a book removes its content index. Book binaries and covers remain on
disk and are never copied into SQLite BLOB columns.

Trigram tokenization supports Chinese and English substring matching. Queries
containing a token shorter than three Unicode characters use an escaped local
`LIKE` query because FTS5 trigram cannot match those tokens reliably.

## EPUB and PDF indexing

`FflateEpubContentParser` reads the EPUB container and OPF spine, selectively
inflates only referenced HTML/XHTML chapters, removes script/style content, and
stores normalized plain text. It never executes book scripts and does not expose
Foliate or DOM types outside the parser.

PDF text is read page by page through the existing PDF.js text parser. Every
indexed page maps back to a versioned page locator. Image-only PDFs without a
text layer remain readable visually but report a partial indexing failure until
OCR is implemented.

`LocalSearchService` lazily indexes books missing from `book_content_index`
before a search. A corrupt book is reported as a partial indexing failure while
search results from healthy local data remain available. “索引维护” repopulates
the note and annotation FTS tables, clears derived book data, and recreates every
readable book index from the managed application data directory.

Search results navigate using stable application data:

- note id for independent notes;
- annotation id plus serialized locator for highlights;
- book id plus a versioned EPUB chapter or PDF page locator for book text.

No DOM selector, arbitrary external path, or full book archive is stored in the
search index. The page also matches book title, author, and local tags without
copying canonical metadata into FTS.

## AI single-book retrieval index

Migration `0011_ai_book_chunks.sql` adds the separate, rebuildable
`ai_book_chunks` FTS5 trigram index. It is not canonical user data and is not the
same index used by the global search page. Each row stores a bounded plain-text
chunk, its source file hash, chapter snapshot, stable EPUB/PDF locator, ordinal,
text hash, and an estimated token count.

The AI retrieval service lazily rebuilds one book when its file hash differs.
EPUB content comes from the package spine; PDF content comes from the local
PDF.js text layer, page by page. Scanned PDFs with no text layer return an
explicit `TEXT_UNAVAILABLE` state. Queries are scoped to one explicitly approved
set of at most eight books and return at most eight chunks under a total context
budget. Adjacent chunks may be merged,
but their source ids remain attached for validation and traceability.

Deleting a SQLite book triggers removal of its AI chunks. The browser test
adapter performs the same cleanup in localStorage. Neither index copies the
original EPUB/PDF binary, calls a network service, or gives the model access to
SQL and managed file paths. Cross-book research may ask the same local Ollama
model for up to six bounded query expansions before retrieval. Those terms are
fused with deterministic lexical recall; planning failure falls back to lexical
search. This improves semantic recall but is not vector embedding search.

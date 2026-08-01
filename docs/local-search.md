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

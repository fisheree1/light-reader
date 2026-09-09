-- Derived, rebuildable text chunks for local single-book RAG. Original EPUB
-- and PDF files remain in the managed application directory.
CREATE VIRTUAL TABLE IF NOT EXISTS ai_book_chunks USING fts5(
  schema_version UNINDEXED,
  chunk_id UNINDEXED,
  book_id UNINDEXED,
  source_file_hash UNINDEXED,
  chapter_href UNINDEXED,
  chapter_title UNINDEXED,
  start_locator_json UNINDEXED,
  end_locator_json UNINDEXED,
  text,
  text_hash UNINDEXED,
  estimated_tokens UNINDEXED,
  ordinal UNINDEXED,
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS books_ai_chunks_delete
AFTER DELETE ON books BEGIN
  DELETE FROM ai_book_chunks WHERE book_id = old.id;
END;

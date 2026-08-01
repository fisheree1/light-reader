ALTER TABLE books ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0
  CHECK (favorite IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_books_favorite_created
  ON books(favorite DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (
    length(trim(tag)) BETWEEN 1 AND 40 AND tag = trim(tag)
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_book_tags_tag
  ON book_tags(tag COLLATE NOCASE, book_id);

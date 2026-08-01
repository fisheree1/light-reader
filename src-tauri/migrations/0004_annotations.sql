CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  text_before TEXT,
  text_after TEXT,
  chapter_href TEXT,
  locator_json TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow', 'blue', 'green', 'red')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_book_created
  ON annotations (book_id, created_at DESC);

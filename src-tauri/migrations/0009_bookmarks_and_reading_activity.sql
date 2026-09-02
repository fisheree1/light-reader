ALTER TABLE reader_settings ADD COLUMN font_family TEXT NOT NULL DEFAULT 'serif'
  CHECK (font_family IN ('publisher', 'serif', 'sans-serif'));
ALTER TABLE reader_settings ADD COLUMN font_weight INTEGER NOT NULL DEFAULT 400
  CHECK (font_weight BETWEEN 300 AND 700);

ALTER TABLE book_reader_settings ADD COLUMN font_family TEXT
  CHECK (font_family IS NULL OR font_family IN ('publisher', 'serif', 'sans-serif'));
ALTER TABLE book_reader_settings ADD COLUMN font_weight INTEGER
  CHECK (font_weight IS NULL OR font_weight BETWEEN 300 AND 700);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (
    length(trim(name)) BETWEEN 1 AND 120 AND name = trim(name)
  ),
  locator_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_bookmarks_book_updated
  ON bookmarks(book_id, updated_at DESC, id ASC);

CREATE TABLE reading_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_reading_sessions_recent
  ON reading_sessions(started_at DESC, id ASC);

CREATE INDEX idx_reading_sessions_book
  ON reading_sessions(book_id, started_at DESC);

-- Managed EPUB files live under the application data directory. SQLite stores
-- only generated relative paths and metadata, never book or cover BLOBs.
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL CHECK (format = 'epub'),
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  cover_path TEXT,
  metadata_json TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_books_created_at ON books (created_at DESC);

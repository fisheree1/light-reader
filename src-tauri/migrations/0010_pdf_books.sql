-- SQLite cannot remove the original EPUB-only CHECK constraint in place.
-- Rebuild the parent and every table that references it as one forward
-- migration. Foreign keys remain enabled throughout the copy.
ALTER TABLE book_reader_settings RENAME TO book_reader_settings_pdf_old;
ALTER TABLE reading_states RENAME TO reading_states_pdf_old;
ALTER TABLE annotations RENAME TO annotations_pdf_old;
ALTER TABLE book_tags RENAME TO book_tags_pdf_old;
ALTER TABLE bookmarks RENAME TO bookmarks_pdf_old;
ALTER TABLE reading_sessions RENAME TO reading_sessions_pdf_old;
ALTER TABLE books RENAME TO books_pdf_old;

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  cover_path TEXT,
  metadata_json TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1))
);

INSERT INTO books (
  id, title, author, format, file_path, file_hash, cover_path, metadata_json,
  file_size, created_at, updated_at, favorite
)
SELECT
  id, title, author, format, file_path, file_hash, cover_path, metadata_json,
  file_size, created_at, updated_at, favorite
FROM books_pdf_old;

CREATE TABLE book_reader_settings (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  theme TEXT CHECK (theme IS NULL OR theme IN ('light', 'sepia', 'dark')),
  font_size INTEGER CHECK (font_size IS NULL OR font_size BETWEEN 12 AND 36),
  line_height REAL CHECK (line_height IS NULL OR line_height BETWEEN 1.2 AND 2.4),
  content_width INTEGER CHECK (content_width IS NULL OR content_width BETWEEN 420 AND 1200),
  margin INTEGER CHECK (margin IS NULL OR margin BETWEEN 0 AND 96),
  updated_at INTEGER NOT NULL,
  font_family TEXT CHECK (font_family IS NULL OR font_family IN ('publisher', 'serif', 'sans-serif')),
  font_weight INTEGER CHECK (font_weight IS NULL OR font_weight BETWEEN 300 AND 700),
  CHECK (
    theme IS NOT NULL OR font_size IS NOT NULL OR line_height IS NOT NULL OR
    content_width IS NOT NULL OR margin IS NOT NULL
  )
);
INSERT INTO book_reader_settings SELECT * FROM book_reader_settings_pdf_old;

CREATE TABLE reading_states (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator_json TEXT NOT NULL,
  progression REAL CHECK (progression IS NULL OR progression BETWEEN 0 AND 1),
  updated_at INTEGER NOT NULL
);
INSERT INTO reading_states SELECT * FROM reading_states_pdf_old;

CREATE TABLE annotations (
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
  updated_at INTEGER NOT NULL,
  note_text TEXT
);
INSERT INTO annotations SELECT * FROM annotations_pdf_old;

CREATE TABLE book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (
    length(trim(tag)) BETWEEN 1 AND 40 AND tag = trim(tag)
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, tag)
);
INSERT INTO book_tags SELECT * FROM book_tags_pdf_old;

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
INSERT INTO bookmarks SELECT * FROM bookmarks_pdf_old;

CREATE TABLE reading_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
INSERT INTO reading_sessions SELECT * FROM reading_sessions_pdf_old;

DROP TABLE book_reader_settings_pdf_old;
DROP TABLE reading_states_pdf_old;
DROP TABLE annotations_pdf_old;
DROP TABLE book_tags_pdf_old;
DROP TABLE bookmarks_pdf_old;
DROP TABLE reading_sessions_pdf_old;
DROP TABLE books_pdf_old;

CREATE INDEX idx_books_created_at ON books (created_at DESC);
CREATE INDEX idx_books_favorite_created
  ON books(favorite DESC, created_at DESC);
CREATE INDEX idx_annotations_book_created
  ON annotations (book_id, created_at DESC);
CREATE INDEX idx_book_tags_tag
  ON book_tags(tag COLLATE NOCASE, book_id);
CREATE INDEX idx_bookmarks_book_updated
  ON bookmarks(book_id, updated_at DESC, id ASC);
CREATE INDEX idx_reading_sessions_recent
  ON reading_sessions(started_at DESC, id ASC);
CREATE INDEX idx_reading_sessions_book
  ON reading_sessions(book_id, started_at DESC);

CREATE TRIGGER annotations_search_insert
AFTER INSERT ON annotations BEGIN
  INSERT INTO annotations_fts (annotation_id, text)
  VALUES (new.id, new.text);
END;

CREATE TRIGGER annotations_search_update
AFTER UPDATE OF text ON annotations BEGIN
  DELETE FROM annotations_fts WHERE annotation_id = old.id;
  INSERT INTO annotations_fts (annotation_id, text)
  VALUES (new.id, new.text);
END;

CREATE TRIGGER annotations_search_delete
AFTER DELETE ON annotations BEGIN
  DELETE FROM annotations_fts WHERE annotation_id = old.id;
END;

CREATE TRIGGER books_search_delete
AFTER DELETE ON books BEGIN
  DELETE FROM book_content_index WHERE book_id = old.id;
END;

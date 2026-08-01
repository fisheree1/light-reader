CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at
  ON notes(updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_notes_title
  ON notes(title COLLATE NOCASE);

-- Global reading preferences. The singleton row is always present.
CREATE TABLE IF NOT EXISTS reader_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  theme TEXT NOT NULL CHECK (theme IN ('light', 'sepia', 'dark')),
  font_size INTEGER NOT NULL CHECK (font_size BETWEEN 12 AND 36),
  line_height REAL NOT NULL CHECK (line_height BETWEEN 1.2 AND 2.4),
  content_width INTEGER NOT NULL CHECK (content_width BETWEEN 420 AND 1200),
  margin INTEGER NOT NULL CHECK (margin BETWEEN 0 AND 96),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO reader_settings (
  id, theme, font_size, line_height, content_width, margin, updated_at
) VALUES (1, 'light', 18, 1.6, 720, 32, 0);

-- Nullable columns mean "inherit this value from global settings".
CREATE TABLE IF NOT EXISTS book_reader_settings (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  theme TEXT CHECK (theme IS NULL OR theme IN ('light', 'sepia', 'dark')),
  font_size INTEGER CHECK (font_size IS NULL OR font_size BETWEEN 12 AND 36),
  line_height REAL CHECK (line_height IS NULL OR line_height BETWEEN 1.2 AND 2.4),
  content_width INTEGER CHECK (content_width IS NULL OR content_width BETWEEN 420 AND 1200),
  margin INTEGER CHECK (margin IS NULL OR margin BETWEEN 0 AND 96),
  updated_at INTEGER NOT NULL,
  CHECK (
    theme IS NOT NULL OR font_size IS NOT NULL OR line_height IS NOT NULL OR
    content_width IS NOT NULL OR margin IS NOT NULL
  )
);

-- The locator is versioned engine-neutral JSON; no Foliate DOM state is stored.
CREATE TABLE IF NOT EXISTS reading_states (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator_json TEXT NOT NULL,
  progression REAL CHECK (progression IS NULL OR progression BETWEEN 0 AND 1),
  updated_at INTEGER NOT NULL
);

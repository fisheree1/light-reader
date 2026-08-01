-- Search data is derived and can be rebuilt. Trigram tokenization supports
-- local substring matching for both CJK and Latin text without external APIs.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  content,
  tokenize = 'trigram'
);

INSERT INTO notes_fts (note_id, title, content)
SELECT id, title, plain_text FROM notes;

CREATE TRIGGER IF NOT EXISTS notes_search_insert
AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (note_id, title, content)
  VALUES (new.id, new.title, new.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_update
AFTER UPDATE OF title, plain_text ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = old.id;
  INSERT INTO notes_fts (note_id, title, content)
  VALUES (new.id, new.title, new.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_delete
AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(
  annotation_id UNINDEXED,
  text,
  tokenize = 'trigram'
);

INSERT INTO annotations_fts (annotation_id, text)
SELECT id, text FROM annotations;

CREATE TRIGGER IF NOT EXISTS annotations_search_insert
AFTER INSERT ON annotations BEGIN
  INSERT INTO annotations_fts (annotation_id, text)
  VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS annotations_search_update
AFTER UPDATE OF text ON annotations BEGIN
  DELETE FROM annotations_fts WHERE annotation_id = old.id;
  INSERT INTO annotations_fts (annotation_id, text)
  VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS annotations_search_delete
AFTER DELETE ON annotations BEGIN
  DELETE FROM annotations_fts WHERE annotation_id = old.id;
END;

-- The EPUB itself remains on disk. This FTS table contains only extracted
-- chapter text and stable, application-controlled identifiers.
CREATE VIRTUAL TABLE IF NOT EXISTS book_content_index USING fts5(
  book_id UNINDEXED,
  chapter_href UNINDEXED,
  chapter_title UNINDEXED,
  text,
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS books_search_delete
AFTER DELETE ON books BEGIN
  DELETE FROM book_content_index WHERE book_id = old.id;
END;

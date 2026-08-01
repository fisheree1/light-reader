use sqlx::{sqlite::SqliteConnectOptions, Connection, Executor, Row, SqliteConnection};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};

static NEXT_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

fn temporary_database_path() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system clock must follow Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "light-reader-books-{}-{nonce}-{}.db",
        std::process::id(),
        NEXT_DATABASE_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

async fn connect(path: &PathBuf) -> SqliteConnection {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true),
    )
    .await
    .expect("test database should open")
}

async fn apply_migrations(connection: &mut SqliteConnection) {
    connection
        .execute("PRAGMA foreign_keys = ON")
        .await
        .expect("foreign keys should be enabled");
    connection
        .execute(include_str!("../migrations/0001_initial.sql"))
        .await
        .expect("initial migration should apply");
    connection
        .execute(include_str!("../migrations/0002_create_books.sql"))
        .await
        .expect("books migration should apply");
    connection
        .execute(include_str!("../migrations/0003_reader_settings.sql"))
        .await
        .expect("reader settings migration should apply");
    connection
        .execute(include_str!("../migrations/0004_annotations.sql"))
        .await
        .expect("annotations migration should apply");
    connection
        .execute(include_str!("../migrations/0005_annotation_notes.sql"))
        .await
        .expect("annotation notes migration should apply");
    connection
        .execute(include_str!("../migrations/0006_notes.sql"))
        .await
        .expect("notes migration should apply");
    connection
        .execute(include_str!("../migrations/0007_local_search.sql"))
        .await
        .expect("local search migration should apply");
    connection
        .execute(include_str!("../migrations/0008_library_management.sql"))
        .await
        .expect("library management migration should apply");
}

async fn insert_book(
    connection: &mut SqliteConnection,
    id: &str,
    title: &str,
    hash_character: char,
    created_at: i64,
) {
    sqlx::query(
        r#"INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES (?, ?, NULL, 'epub', ?, ?, NULL, ?, 10, ?, ?)"#,
    )
    .bind(id)
    .bind(title)
    .bind(format!("light-reader/books/{id}/book.epub"))
    .bind(hash_character.to_string().repeat(64))
    .bind(format!(
        r#"{{"title":"{title}","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}}"#
    ))
    .bind(created_at)
    .bind(created_at)
    .execute(&mut *connection)
    .await
    .expect("library test book should be created");
}

#[tokio::test]
async fn library_metadata_persists_sorts_and_follows_book_lifecycle() {
    let path = temporary_database_path();
    let mut connection = connect(&path).await;
    apply_migrations(&mut connection).await;

    insert_book(&mut connection, "book-a", "Alpha", 'a', 10).await;
    insert_book(&mut connection, "book-z", "Zulu", 'z', 20).await;
    insert_book(&mut connection, "book-m", "Middle", 'm', 30).await;
    sqlx::query("UPDATE books SET favorite = 1 WHERE id = 'book-z'")
        .execute(&mut connection)
        .await
        .expect("favorite should update");
    sqlx::query("INSERT INTO book_tags (book_id, tag, created_at) VALUES ('book-z', '技术', 40)")
        .execute(&mut connection)
        .await
        .expect("book tag should be created");
    sqlx::query(
        r#"INSERT INTO reading_states (
          book_id, locator_json, progression, updated_at
        ) VALUES ('book-a', ?, 0.5, 100)"#,
    )
    .bind(r#"{"version":1,"format":"epub","progression":0.5}"#)
    .execute(&mut connection)
    .await
    .expect("recent reading state should be created");

    connection.close().await.expect("database should close");
    let mut reopened = connect(&path).await;
    reopened
        .execute("PRAGMA foreign_keys = ON")
        .await
        .expect("foreign keys should be enabled after reopen");

    let favorite = sqlx::query("SELECT favorite FROM books WHERE id = 'book-z'")
        .fetch_one(&mut reopened)
        .await
        .expect("favorite should survive reopen")
        .get::<i64, _>("favorite");
    assert_eq!(favorite, 1);
    let tag = sqlx::query("SELECT tag FROM book_tags WHERE book_id = 'book-z'")
        .fetch_one(&mut reopened)
        .await
        .expect("tag should survive reopen")
        .get::<String, _>("tag");
    assert_eq!(tag, "技术");

    let recent = sqlx::query(
        r#"SELECT b.id FROM books b
        LEFT JOIN reading_states rs ON rs.book_id = b.id
        ORDER BY CASE WHEN rs.updated_at IS NULL THEN 1 ELSE 0 END,
          rs.updated_at DESC, b.created_at DESC"#,
    )
    .fetch_all(&mut reopened)
    .await
    .expect("recent order should query");
    assert_eq!(
        recent
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect::<Vec<_>>(),
        ["book-a", "book-m", "book-z"]
    );

    let added = sqlx::query("SELECT id FROM books ORDER BY created_at DESC")
        .fetch_all(&mut reopened)
        .await
        .expect("added order should query");
    assert_eq!(
        added
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect::<Vec<_>>(),
        ["book-m", "book-z", "book-a"]
    );

    let title = sqlx::query("SELECT id FROM books ORDER BY title COLLATE NOCASE ASC")
        .fetch_all(&mut reopened)
        .await
        .expect("title order should query");
    assert_eq!(
        title
            .iter()
            .map(|row| row.get::<String, _>("id"))
            .collect::<Vec<_>>(),
        ["book-a", "book-m", "book-z"]
    );

    sqlx::query("DELETE FROM books WHERE id = 'book-z'")
        .execute(&mut reopened)
        .await
        .expect("book should delete");
    let tag_count = sqlx::query("SELECT COUNT(*) AS count FROM book_tags")
        .fetch_one(&mut reopened)
        .await
        .expect("book tags should remain queryable")
        .get::<i64, _>("count");
    assert_eq!(tag_count, 0, "book tags must cascade with their book");

    reopened.close().await.expect("database should close again");
    std::fs::remove_file(path).expect("test database should be removable");
}

#[tokio::test]
async fn local_search_indexes_chinese_english_large_text_and_rebuilds() {
    let path = temporary_database_path();
    let mut connection = connect(&path).await;
    apply_migrations(&mut connection).await;

    sqlx::query(
        r#"INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES ('search-book', 'Search book', NULL, 'epub',
          'light-reader/books/search-book/book.epub', ?, NULL, ?, 10, 1, 1)"#,
    )
    .bind("d".repeat(64))
    .bind(r#"{"title":"Search book","creators":[],"language":"zh-CN","publisher":null,"description":null,"identifier":null}"#)
    .execute(&mut connection)
    .await
    .expect("search book should be created");

    sqlx::query(
        r#"INSERT INTO notes (
          id, title, content_json, plain_text, created_at, updated_at
        ) VALUES ('search-note', '中文搜索笔记', '{}',
          'This local search note stays offline.', 1, 1)"#,
    )
    .execute(&mut connection)
    .await
    .expect("search note should be created");
    sqlx::query(
        r#"INSERT INTO annotations (
          id, book_id, text, text_before, text_after, chapter_href,
          locator_json, color, note_text, created_at, updated_at
        ) VALUES ('search-annotation', 'search-book', '重要高亮文字', NULL,
          NULL, 'one.xhtml', ?, 'yellow', NULL, 1, 1)"#,
    )
    .bind(r#"{"version":1,"format":"epub","chapterHref":"one.xhtml","cfi":"epubcfi(/6/2!/4/2)"}"#)
    .execute(&mut connection)
    .await
    .expect("search annotation should be created");

    let large_text = format!("{}最终检索标记", "large local content ".repeat(20_000));
    sqlx::query(
        r#"INSERT INTO book_content_index (
          book_id, chapter_href, chapter_title, text
        ) VALUES ('search-book', 'one.xhtml', '第一章', ?)"#,
    )
    .bind(large_text)
    .execute(&mut connection)
    .await
    .expect("large EPUB chapter should be indexed");

    let note_count = sqlx::query("SELECT COUNT(*) AS count FROM notes_fts WHERE notes_fts MATCH ?")
        .bind("\"中文搜索\"")
        .fetch_one(&mut connection)
        .await
        .expect("Chinese note query should run")
        .get::<i64, _>("count");
    assert_eq!(note_count, 1);

    let english_count =
        sqlx::query("SELECT COUNT(*) AS count FROM notes_fts WHERE notes_fts MATCH ?")
            .bind("\"local search\"")
            .fetch_one(&mut connection)
            .await
            .expect("English note query should run")
            .get::<i64, _>("count");
    assert_eq!(english_count, 1);

    let highlight_count =
        sqlx::query("SELECT COUNT(*) AS count FROM annotations_fts WHERE annotations_fts MATCH ?")
            .bind("\"高亮文字\"")
            .fetch_one(&mut connection)
            .await
            .expect("highlight query should run")
            .get::<i64, _>("count");
    assert_eq!(highlight_count, 1);

    let content_count = sqlx::query(
        "SELECT COUNT(*) AS count FROM book_content_index WHERE book_content_index MATCH ?",
    )
    .bind("\"最终检索\"")
    .fetch_one(&mut connection)
    .await
    .expect("large content query should run")
    .get::<i64, _>("count");
    assert_eq!(content_count, 1);

    sqlx::query("DELETE FROM notes_fts")
        .execute(&mut connection)
        .await
        .expect("derived note index should clear");
    sqlx::query(
        "INSERT INTO notes_fts (note_id, title, content) SELECT id, title, plain_text FROM notes",
    )
    .execute(&mut connection)
    .await
    .expect("derived note index should rebuild");

    connection.close().await.expect("database should close");
    let mut reopened = connect(&path).await;
    let rebuilt_count =
        sqlx::query("SELECT COUNT(*) AS count FROM notes_fts WHERE notes_fts MATCH ?")
            .bind("\"中文搜索\"")
            .fetch_one(&mut reopened)
            .await
            .expect("rebuilt search index should survive reopen")
            .get::<i64, _>("count");
    assert_eq!(rebuilt_count, 1);

    sqlx::query("DELETE FROM books WHERE id = 'search-book'")
        .execute(&mut reopened)
        .await
        .expect("book should delete");
    let content_after_delete = sqlx::query(
        "SELECT COUNT(*) AS count FROM book_content_index WHERE book_id = 'search-book'",
    )
    .fetch_one(&mut reopened)
    .await
    .expect("book content index should be queryable")
    .get::<i64, _>("count");
    assert_eq!(content_after_delete, 0);

    reopened.close().await.expect("database should close again");
    std::fs::remove_file(path).expect("test database should be removable");
}

#[tokio::test]
async fn reader_settings_and_position_persist_and_follow_book_lifecycle() {
    let path = temporary_database_path();
    let mut connection = connect(&path).await;
    apply_migrations(&mut connection).await;

    sqlx::query(
        r#"INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES ('reader-book', 'Reader book', NULL, 'epub',
          'light-reader/books/reader-book/book.epub', ?, NULL, ?, 10, 1, 1)"#,
    )
    .bind("c".repeat(64))
    .bind(r#"{"title":"Reader book","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}"#)
    .execute(&mut connection)
    .await
    .expect("book should be created");

    sqlx::query("UPDATE reader_settings SET theme = 'sepia', font_size = 20 WHERE id = 1")
        .execute(&mut connection)
        .await
        .expect("global settings should update");
    sqlx::query(
        "INSERT INTO book_reader_settings (book_id, theme, updated_at) VALUES (?, 'dark', 2)",
    )
    .bind("reader-book")
    .execute(&mut connection)
    .await
    .expect("book override should be created");
    sqlx::query(
        "INSERT INTO reading_states (book_id, locator_json, progression, updated_at) VALUES (?, ?, 0.42, 3)",
    )
    .bind("reader-book")
    .bind(r#"{"version":1,"format":"epub","progression":0.42}"#)
    .execute(&mut connection)
    .await
    .expect("reading state should be created");
    sqlx::query(
        r#"INSERT INTO annotations (
          id, book_id, text, text_before, text_after, chapter_href,
          locator_json, color, note_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'yellow', ?, 4, 5)"#,
    )
    .bind("annotation-1")
    .bind("reader-book")
    .bind("selected text")
    .bind("before")
    .bind("after")
    .bind("EPUB/one.xhtml")
    .bind(r#"{"version":1,"format":"epub","chapterHref":"EPUB/one.xhtml","cfi":"epubcfi(/6/2!/4/2,/1:0,/1:4)"}"#)
    .bind("first note")
    .execute(&mut connection)
    .await
    .expect("annotation and note should be created");
    sqlx::query(
        r#"INSERT INTO notes (
          id, title, content_json, plain_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 6, 6)"#,
    )
    .bind("note-1")
    .bind("Reader note")
    .bind(
        r#"{"schemaVersion":1,"content":{"type":"doc","content":[{"type":"bookQuote","attrs":{"bookId":"reader-book","annotationId":"annotation-1","quote":"selected text","chapter":"EPUB/one.xhtml","locator":{"version":1,"format":"epub","chapterHref":"EPUB/one.xhtml","cfi":"epubcfi(/6/2!/4/2,/1:0,/1:4)"}}}]}}"#,
    )
    .bind("selected text")
    .execute(&mut connection)
    .await
    .expect("independent note should be created");

    connection.close().await.expect("database should close");
    let mut reopened = connect(&path).await;
    reopened
        .execute("PRAGMA foreign_keys = ON")
        .await
        .expect("foreign keys should be enabled after reopen");
    let theme = sqlx::query("SELECT theme FROM reader_settings WHERE id = 1")
        .fetch_one(&mut reopened)
        .await
        .expect("global settings should survive reopen")
        .get::<String, _>("theme");
    assert_eq!(theme, "sepia");
    let progression = sqlx::query("SELECT progression FROM reading_states WHERE book_id = ?")
        .bind("reader-book")
        .fetch_one(&mut reopened)
        .await
        .expect("reading state should survive reopen")
        .get::<f64, _>("progression");
    assert!((progression - 0.42).abs() < f64::EPSILON);
    let note = sqlx::query("SELECT note_text FROM annotations WHERE id = ?")
        .bind("annotation-1")
        .fetch_one(&mut reopened)
        .await
        .expect("annotation should survive reopen")
        .get::<String, _>("note_text");
    assert_eq!(note, "first note");
    let note_document = sqlx::query("SELECT content_json FROM notes WHERE id = ?")
        .bind("note-1")
        .fetch_one(&mut reopened)
        .await
        .expect("note document should survive reopen")
        .get::<String, _>("content_json");
    assert!(note_document.contains("selected text"));

    sqlx::query("DELETE FROM books WHERE id = ?")
        .bind("reader-book")
        .execute(&mut reopened)
        .await
        .expect("book should delete");
    let state_count = sqlx::query("SELECT COUNT(*) AS count FROM reading_states")
        .fetch_one(&mut reopened)
        .await
        .expect("reading states should be queryable")
        .get::<i64, _>("count");
    assert_eq!(state_count, 0);
    let annotation_count = sqlx::query("SELECT COUNT(*) AS count FROM annotations")
        .fetch_one(&mut reopened)
        .await
        .expect("annotations should be queryable")
        .get::<i64, _>("count");
    assert_eq!(annotation_count, 0);
    let note_count = sqlx::query("SELECT COUNT(*) AS count FROM notes")
        .fetch_one(&mut reopened)
        .await
        .expect("independent notes should be queryable")
        .get::<i64, _>("count");
    assert_eq!(
        note_count, 1,
        "book deletion must not delete note snapshots"
    );
    reopened.close().await.expect("database should close again");
    std::fs::remove_file(path).expect("test database should be removable");
}

#[tokio::test]
async fn books_schema_enforces_hash_and_persists_across_reopen() {
    let path = temporary_database_path();
    let mut connection = connect(&path).await;
    apply_migrations(&mut connection).await;

    let insert_sql = r#"
        INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES (?, ?, ?, 'epub', ?, ?, NULL, ?, ?, ?, ?)
    "#;

    sqlx::query(insert_sql)
        .bind("book-1")
        .bind("First book")
        .bind("Author")
        .bind("light-reader/books/book-1/book.epub")
        .bind("a".repeat(64))
        .bind(r#"{"title":"First book","creators":["Author"],"language":null,"publisher":null,"description":null,"identifier":null}"#)
        .bind(100_i64)
        .bind(10_i64)
        .bind(10_i64)
        .execute(&mut connection)
        .await
        .expect("book should be created");

    sqlx::query(insert_sql)
        .bind("book-2")
        .bind("Second book")
        .bind(Option::<String>::None)
        .bind("light-reader/books/book-2/book.epub")
        .bind("b".repeat(64))
        .bind(r#"{"title":"Second book","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}"#)
        .bind(200_i64)
        .bind(20_i64)
        .bind(20_i64)
        .execute(&mut connection)
        .await
        .expect("second book should be created");

    let found = sqlx::query("SELECT id FROM books WHERE file_hash = ?")
        .bind("a".repeat(64))
        .fetch_one(&mut connection)
        .await
        .expect("book should be found by hash");
    assert_eq!(found.get::<String, _>("id"), "book-1");

    let listed = sqlx::query("SELECT id FROM books ORDER BY created_at DESC")
        .fetch_all(&mut connection)
        .await
        .expect("books should list");
    assert_eq!(listed[0].get::<String, _>("id"), "book-2");
    assert_eq!(listed[1].get::<String, _>("id"), "book-1");

    let duplicate = sqlx::query(insert_sql)
        .bind("book-duplicate")
        .bind("Duplicate")
        .bind(Option::<String>::None)
        .bind("light-reader/books/book-duplicate/book.epub")
        .bind("a".repeat(64))
        .bind(r#"{"title":"Duplicate","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}"#)
        .bind(100_i64)
        .bind(30_i64)
        .bind(30_i64)
        .execute(&mut connection)
        .await;
    assert!(duplicate.is_err(), "duplicate hashes must be rejected");

    connection.close().await.expect("database should close");

    let mut reopened = connect(&path).await;
    let count = sqlx::query("SELECT COUNT(*) AS count FROM books")
        .fetch_one(&mut reopened)
        .await
        .expect("books should survive reopen")
        .get::<i64, _>("count");
    assert_eq!(count, 2);
    reopened.close().await.expect("database should close again");

    std::fs::remove_file(path).expect("test database should be removable");
}

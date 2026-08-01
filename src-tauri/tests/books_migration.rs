use sqlx::{sqlite::SqliteConnectOptions, Connection, Executor, Row, SqliteConnection};
use std::{path::PathBuf, time::SystemTime};

fn temporary_database_path() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system clock must follow Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "light-reader-books-{}-{nonce}.db",
        std::process::id()
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

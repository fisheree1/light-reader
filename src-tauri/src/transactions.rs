//! Multi-statement writes that must commit or roll back as one unit.
//!
//! `@tauri-apps/plugin-sql` runs every `execute` call on whichever connection
//! its sqlx pool hands out, so a `BEGIN` sent from JavaScript is not pinned to
//! the statements that follow it. These commands take one connection from the
//! same pool and keep the whole transaction on it.

use serde::Deserialize;
use sqlx::{Pool, Sqlite, Transaction};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:light-reader.db";
const MAX_TAGS: usize = 20;
const MAX_TAG_LENGTH: usize = 40;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookContentChapter {
    chapter_href: String,
    chapter_title: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookChunkRow {
    schema_version: i64,
    chunk_id: String,
    book_id: String,
    source_file_hash: String,
    chapter_href: Option<String>,
    chapter_title: Option<String>,
    start_locator_json: String,
    end_locator_json: Option<String>,
    text: String,
    text_hash: String,
    estimated_tokens: i64,
    ordinal: i64,
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 {
        return Err(format!("invalid {label} id"));
    }
    Ok(())
}

fn database_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Returns the pool `Database.load` opened, so these writes share its
/// connection settings and are serialized with its other writers.
async fn app_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let instances = app.state::<DbInstances>();
    let instances = instances.0.read().await;
    match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("database is not loaded".to_string()),
    }
}

/// Starts `BEGIN IMMEDIATE` on one pooled connection. Every statement runs on
/// that connection; returning early drops the transaction, which rolls it
/// back before the connection goes back to the pool.
async fn begin(pool: &Pool<Sqlite>) -> Result<Transaction<'static, Sqlite>, String> {
    pool.begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database_error)
}

async fn replace_book_tags(
    pool: &Pool<Sqlite>,
    book_id: &str,
    tags: &[String],
    timestamp: i64,
) -> Result<(), String> {
    validate_id(book_id, "book")?;
    if tags.len() > MAX_TAGS {
        return Err("too many tags".to_string());
    }
    if tags
        .iter()
        .any(|tag| tag.trim() != tag || tag.is_empty() || tag.chars().count() > MAX_TAG_LENGTH)
    {
        return Err("invalid tag".to_string());
    }
    let mut transaction = begin(pool).await?;
    sqlx::query("DELETE FROM book_tags WHERE book_id = ?")
        .bind(book_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    for tag in tags {
        sqlx::query("INSERT INTO book_tags (book_id, tag, created_at) VALUES (?, ?, ?)")
            .bind(book_id)
            .bind(tag)
            .bind(timestamp)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
    }
    let updated = sqlx::query("UPDATE books SET updated_at = ? WHERE id = ?")
        .bind(timestamp)
        .bind(book_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    if updated.rows_affected() != 1 {
        return Err("book update target does not exist".to_string());
    }
    transaction.commit().await.map_err(database_error)
}

async fn replace_book_content(
    pool: &Pool<Sqlite>,
    book_id: &str,
    chapters: &[BookContentChapter],
) -> Result<(), String> {
    validate_id(book_id, "book")?;
    let mut transaction = begin(pool).await?;
    sqlx::query("DELETE FROM book_content_index WHERE book_id = ?")
        .bind(book_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    for chapter in chapters {
        sqlx::query(
            "INSERT INTO book_content_index (book_id, chapter_href, chapter_title, text)
                 VALUES (?, ?, ?, ?)",
        )
        .bind(book_id)
        .bind(&chapter.chapter_href)
        .bind(&chapter.chapter_title)
        .bind(&chapter.text)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    }
    transaction.commit().await.map_err(database_error)
}

async fn rebuild_text_indexes(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut transaction = begin(pool).await?;
    for statement in [
        "DELETE FROM notes_fts",
        "INSERT INTO notes_fts (note_id, title, content)
             SELECT id, title, plain_text FROM notes",
        "DELETE FROM annotations_fts",
        "INSERT INTO annotations_fts (annotation_id, text)
             SELECT id, text FROM annotations",
    ] {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
    }
    transaction.commit().await.map_err(database_error)
}

async fn replace_book_chunks(
    pool: &Pool<Sqlite>,
    book_id: &str,
    chunks: &[BookChunkRow],
) -> Result<(), String> {
    validate_id(book_id, "book")?;
    for chunk in chunks {
        validate_id(&chunk.chunk_id, "chunk")?;
        if chunk.book_id != book_id {
            return Err("chunk belongs to another book".to_string());
        }
    }
    let mut transaction = begin(pool).await?;
    sqlx::query("DELETE FROM ai_book_chunks WHERE book_id = ?")
        .bind(book_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    for chunk in chunks {
        sqlx::query(
            "INSERT INTO ai_book_chunks (
                   schema_version, chunk_id, book_id, source_file_hash,
                   chapter_href, chapter_title, start_locator_json,
                   end_locator_json, text, text_hash, estimated_tokens, ordinal
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(chunk.schema_version)
        .bind(&chunk.chunk_id)
        .bind(&chunk.book_id)
        .bind(&chunk.source_file_hash)
        .bind(&chunk.chapter_href)
        .bind(&chunk.chapter_title)
        .bind(&chunk.start_locator_json)
        .bind(&chunk.end_locator_json)
        .bind(&chunk.text)
        .bind(&chunk.text_hash)
        .bind(chunk.estimated_tokens)
        .bind(chunk.ordinal)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    }
    transaction.commit().await.map_err(database_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn library_replace_book_tags(
    app: AppHandle,
    book_id: String,
    tags: Vec<String>,
    timestamp: i64,
) -> Result<(), String> {
    replace_book_tags(&app_pool(&app).await?, &book_id, &tags, timestamp).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_replace_book_content(
    app: AppHandle,
    book_id: String,
    chapters: Vec<BookContentChapter>,
) -> Result<(), String> {
    replace_book_content(&app_pool(&app).await?, &book_id, &chapters).await
}

#[tauri::command]
pub async fn search_rebuild_text_indexes(app: AppHandle) -> Result<(), String> {
    rebuild_text_indexes(&app_pool(&app).await?).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_replace_book_chunks(
    app: AppHandle,
    book_id: String,
    chunks: Vec<BookChunkRow>,
) -> Result<(), String> {
    replace_book_chunks(&app_pool(&app).await?, &book_id, &chunks).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        Executor,
    };
    use std::{
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    const MIGRATIONS: [&str; 12] = [
        include_str!("../migrations/0001_initial.sql"),
        include_str!("../migrations/0002_create_books.sql"),
        include_str!("../migrations/0003_reader_settings.sql"),
        include_str!("../migrations/0004_annotations.sql"),
        include_str!("../migrations/0005_annotation_notes.sql"),
        include_str!("../migrations/0006_notes.sql"),
        include_str!("../migrations/0007_local_search.sql"),
        include_str!("../migrations/0008_library_management.sql"),
        include_str!("../migrations/0009_bookmarks_and_reading_activity.sql"),
        include_str!("../migrations/0010_pdf_books.sql"),
        include_str!("../migrations/0011_ai_book_chunks.sql"),
        include_str!("../migrations/0012_foliate_formats.sql"),
    ];

    struct TestDatabase {
        path: PathBuf,
        pool: Pool<Sqlite>,
    }

    impl TestDatabase {
        /// A file database with the app's real schema behind a pool that,
        /// like the plugin's default, can hand out several connections.
        async fn open(label: &str, busy_timeout: Duration) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must follow the Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("light-reader-{label}-{nonce}.sqlite"));
            let pool = SqlitePoolOptions::new()
                .max_connections(10)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true)
                        .busy_timeout(busy_timeout),
                )
                .await
                .expect("test database should open");
            for migration in MIGRATIONS {
                pool.execute(sqlx::raw_sql(migration))
                    .await
                    .expect("migration should apply");
            }
            sqlx::raw_sql(
                "INSERT INTO books (id, title, format, file_path, file_hash, metadata_json, file_size, created_at, updated_at)
                 VALUES ('book-1', 'Book', 'epub', 'books/book-1.epub', 'hash', '{}', 1, 1, 1);
                 INSERT INTO book_tags (book_id, tag, created_at) VALUES ('book-1', 'old', 1);",
            )
            .execute(&pool)
            .await
            .expect("book should seed");
            Self { path, pool }
        }

        async fn default_pool(label: &str) -> Self {
            Self::open(label, Duration::from_secs(5)).await
        }

        /// Opens extra idle connections so consecutive acquisitions rotate
        /// through them, as they do in the app once queries run concurrently.
        async fn warm(&self, connections: usize) {
            let mut held = Vec::new();
            for _ in 0..connections {
                held.push(self.pool.acquire().await.expect("connection"));
            }
        }

        async fn tags(&self) -> Vec<String> {
            sqlx::query_scalar("SELECT tag FROM book_tags WHERE book_id = 'book-1' ORDER BY tag")
                .fetch_all(&self.pool)
                .await
                .expect("tags should load")
        }

        async fn close(self) {
            self.pool.close().await;
            std::fs::remove_file(&self.path).expect("test database should be removable");
        }
    }

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    /// Documents the failure the commands exist for: the plugin issues each
    /// JavaScript `execute` through the pool, so `BEGIN` and the statements
    /// after it can run on different connections.
    #[tokio::test]
    async fn statement_by_statement_transactions_split_across_pool_connections() {
        let database = TestDatabase::open("pool-split", Duration::from_millis(100)).await;
        database.warm(3).await;

        database
            .pool
            .execute("BEGIN IMMEDIATE")
            .await
            .expect("BEGIN should run");
        let delete = database
            .pool
            .execute("DELETE FROM book_tags WHERE book_id = 'book-1'")
            .await;
        let commit = database.pool.execute("COMMIT").await;

        let delete_error = delete.expect_err("another connection holds the write lock");
        assert!(delete_error.to_string().contains("database is locked"));
        let commit_error = commit.expect_err("COMMIT ran on a connection without BEGIN");
        assert!(commit_error
            .to_string()
            .contains("cannot commit - no transaction is active"));
        database.close().await;
    }

    #[tokio::test]
    async fn replaces_tags_atomically_on_a_busy_pool() {
        let database = TestDatabase::default_pool("tags").await;
        database.warm(3).await;

        replace_book_tags(&database.pool, "book-1", &tags(&["fantasy", "novel"]), 5)
            .await
            .expect("tags should commit");
        replace_book_tags(&database.pool, "book-1", &tags(&["novel", "web"]), 6)
            .await
            .expect("tags should commit again");

        assert_eq!(database.tags().await, tags(&["novel", "web"]));
        let updated_at: i64 =
            sqlx::query_scalar("SELECT updated_at FROM books WHERE id = 'book-1'")
                .fetch_one(&database.pool)
                .await
                .expect("book should load");
        assert_eq!(updated_at, 6);
        database.close().await;
    }

    #[tokio::test]
    async fn concurrent_tag_replacements_each_commit_whole() {
        let database = TestDatabase::default_pool("tags-concurrent").await;
        database.warm(3).await;

        let first = tags(&["a", "b", "c"]);
        let second = tags(&["x", "y"]);
        let (left, right) = tokio::join!(
            replace_book_tags(&database.pool, "book-1", &first, 2),
            replace_book_tags(&database.pool, "book-1", &second, 3),
        );
        left.expect("first replacement should commit");
        right.expect("second replacement should commit");

        let stored = database.tags().await;
        assert!(
            stored == first || stored == second,
            "mixed tags: {stored:?}"
        );
        database.close().await;
    }

    #[tokio::test]
    async fn rolls_back_tags_when_an_insert_fails() {
        let database = TestDatabase::default_pool("tags-rollback").await;

        let result = replace_book_tags(&database.pool, "book-1", &tags(&["new", "new"]), 5).await;

        assert!(
            result.is_err(),
            "duplicate tag must violate the primary key"
        );
        assert_eq!(database.tags().await, tags(&["old"]));
        database.close().await;
    }

    #[tokio::test]
    async fn rolls_back_tags_when_the_book_is_missing() {
        let database = TestDatabase::default_pool("tags-missing").await;
        sqlx::query(
            "INSERT INTO book_tags (book_id, tag, created_at) VALUES ('book-1', 'keep', 1)",
        )
        .execute(&database.pool)
        .await
        .expect("tag should seed");

        let result = replace_book_tags(&database.pool, "missing", &tags(&["new"]), 5).await;

        assert!(result.is_err());
        let orphaned: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM book_tags WHERE book_id = 'missing'")
                .fetch_one(&database.pool)
                .await
                .expect("tags should count");
        assert_eq!(orphaned, 0);
        assert_eq!(database.tags().await, tags(&["keep", "old"]));
        database.close().await;
    }

    #[tokio::test]
    async fn rejects_invalid_tags_before_writing() {
        let database = TestDatabase::default_pool("tags-invalid").await;
        let too_many: Vec<String> = (0..=MAX_TAGS).map(|index| format!("t{index}")).collect();

        for invalid in [
            tags(&[" padded"]),
            tags(&[""]),
            tags(&[&"x".repeat(41)]),
            too_many,
        ] {
            assert!(replace_book_tags(&database.pool, "book-1", &invalid, 5)
                .await
                .is_err());
        }
        assert!(replace_book_tags(&database.pool, "", &tags(&["ok"]), 5)
            .await
            .is_err());
        assert_eq!(database.tags().await, tags(&["old"]));
        database.close().await;
    }

    fn chapter(href: &str, text: &str) -> BookContentChapter {
        BookContentChapter {
            chapter_href: href.to_string(),
            chapter_title: format!("Title {href}"),
            text: text.to_string(),
        }
    }

    async fn indexed_chapters(database: &TestDatabase) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT chapter_href FROM book_content_index WHERE book_id = 'book-1' ORDER BY chapter_href",
        )
        .fetch_all(&database.pool)
        .await
        .expect("content should load")
    }

    #[tokio::test]
    async fn replaces_book_content_and_keeps_it_when_a_transaction_is_dropped() {
        let database = TestDatabase::default_pool("content").await;
        database.warm(3).await;

        replace_book_content(
            &database.pool,
            "book-1",
            &[chapter("c1.xhtml", "first"), chapter("c2.xhtml", "second")],
        )
        .await
        .expect("content should commit");
        assert_eq!(
            indexed_chapters(&database).await,
            tags(&["c1.xhtml", "c2.xhtml"])
        );

        // FTS5 accepts any text, so no chapter makes the INSERTs fail. Abandon
        // a transaction after its DELETE instead, as `?` does on an error.
        let mut transaction = begin(&database.pool).await.expect("transaction");
        sqlx::query("DELETE FROM book_content_index WHERE book_id = 'book-1'")
            .execute(&mut *transaction)
            .await
            .expect("delete should run");
        drop(transaction);
        assert_eq!(
            indexed_chapters(&database).await,
            tags(&["c1.xhtml", "c2.xhtml"])
        );
        database.close().await;
    }

    #[tokio::test]
    async fn rebuilds_text_indexes_from_source_tables() {
        let database = TestDatabase::default_pool("rebuild").await;
        database.warm(3).await;
        sqlx::raw_sql(
            "INSERT INTO notes (id, title, content_json, plain_text, created_at, updated_at)
             VALUES ('note-1', 'Note', '{}', 'body', 1, 1);
             DELETE FROM notes_fts;
             INSERT INTO notes_fts (note_id, title, content) VALUES ('stale', 'Stale', 'gone');",
        )
        .execute(&database.pool)
        .await
        .expect("notes should seed");

        rebuild_text_indexes(&database.pool)
            .await
            .expect("rebuild should commit");

        let indexed: Vec<String> = sqlx::query_scalar("SELECT note_id FROM notes_fts")
            .fetch_all(&database.pool)
            .await
            .expect("index should load");
        assert_eq!(indexed, tags(&["note-1"]));
        database.close().await;
    }

    fn chunk(book_id: &str, chunk_id: &str, ordinal: i64) -> BookChunkRow {
        BookChunkRow {
            schema_version: 1,
            chunk_id: chunk_id.to_string(),
            book_id: book_id.to_string(),
            source_file_hash: "a".repeat(64),
            chapter_href: Some("c1.xhtml".to_string()),
            chapter_title: None,
            start_locator_json: r#"{"type":"epub-cfi","value":"epubcfi(/6/2)"}"#.to_string(),
            end_locator_json: None,
            text: format!("chunk text {chunk_id}"),
            text_hash: "hash".to_string(),
            estimated_tokens: 4,
            ordinal,
        }
    }

    async fn chunk_ids(database: &TestDatabase) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT chunk_id FROM ai_book_chunks WHERE book_id = 'book-1' ORDER BY ordinal",
        )
        .fetch_all(&database.pool)
        .await
        .expect("chunks should load")
    }

    #[tokio::test]
    async fn replaces_book_chunks_atomically() {
        let database = TestDatabase::default_pool("chunks").await;
        database.warm(3).await;

        replace_book_chunks(
            &database.pool,
            "book-1",
            &[chunk("book-1", "k1", 0), chunk("book-1", "k2", 1)],
        )
        .await
        .expect("chunks should commit");
        replace_book_chunks(&database.pool, "book-1", &[chunk("book-1", "k3", 0)])
            .await
            .expect("chunks should commit again");

        assert_eq!(chunk_ids(&database).await, tags(&["k3"]));
        database.close().await;
    }

    #[tokio::test]
    async fn rejects_chunks_for_another_book_without_touching_the_index() {
        let database = TestDatabase::default_pool("chunks-invalid").await;
        replace_book_chunks(&database.pool, "book-1", &[chunk("book-1", "k1", 0)])
            .await
            .expect("chunks should commit");

        let result = replace_book_chunks(
            &database.pool,
            "book-1",
            &[chunk("book-1", "k2", 0), chunk("book-2", "k3", 1)],
        )
        .await;

        assert!(result.is_err());
        assert_eq!(chunk_ids(&database).await, tags(&["k1"]));
        database.close().await;
    }
}

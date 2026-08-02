use serde::Serialize;
use sqlx::{sqlite::SqliteConnectOptions, Connection, Executor, SqliteConnection};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

pub const CURRENT_SCHEMA_VERSION: i64 = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    annotations: i64,
    books: i64,
    notes: i64,
    reading_states: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupSummary {
    counts: BackupCounts,
    schema_version: i64,
}

fn validate_snapshot_id(snapshot_id: &str) -> Result<(), String> {
    if snapshot_id.is_empty()
        || snapshot_id.len() > 128
        || !snapshot_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("invalid backup snapshot id".to_string());
    }
    Ok(())
}

fn database_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("light-reader.db"))
        .map_err(|error| error.to_string())
}

fn snapshot_directory(app: &AppHandle, snapshot_id: &str) -> Result<std::path::PathBuf, String> {
    validate_snapshot_id(snapshot_id)?;
    app.path()
        .app_data_dir()
        .map(|directory| {
            directory
                .join("light-reader")
                .join("backup")
                .join(snapshot_id)
        })
        .map_err(|error| error.to_string())
}

fn snapshot_path(app: &AppHandle, snapshot_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(snapshot_directory(app, snapshot_id)?.join("database.sqlite"))
}

async fn connect(path: &Path, create: bool) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(create),
    )
    .await
    .map_err(|error| error.to_string())
}

async fn count(connection: &mut SqliteConnection, table: &str) -> Result<i64, String> {
    let query = match table {
        "annotations" => "SELECT COUNT(*) FROM annotations",
        "books" => "SELECT COUNT(*) FROM books",
        "notes" => "SELECT COUNT(*) FROM notes",
        "reading_states" => "SELECT COUNT(*) FROM reading_states",
        _ => return Err("unsupported backup table".to_string()),
    };
    sqlx::query_scalar(query)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())
}

async fn inspect_database(path: &Path) -> Result<DatabaseBackupSummary, String> {
    if !path.is_file() {
        return Err("backup database does not exist".to_string());
    }
    let mut connection = connect(path, false).await?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err("backup database failed integrity check".to_string());
    }

    let schema_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    if schema_version != CURRENT_SCHEMA_VERSION {
        return Err("backup database schema is incompatible".to_string());
    }

    let required_table_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM sqlite_schema
        WHERE type = 'table' AND name IN (
          'app_meta', 'books', 'reader_settings', 'book_reader_settings',
          'reading_states', 'annotations', 'notes', 'book_tags',
          'book_content_index'
        )"#,
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    if required_table_count != 9 {
        return Err("backup database is missing required tables".to_string());
    }

    let validation_queries = [
        "SELECT key, value FROM app_meta LIMIT 1",
        "SELECT id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite FROM books LIMIT 1",
        "SELECT id, theme, font_size, line_height, content_width, margin, updated_at FROM reader_settings LIMIT 1",
        "SELECT book_id, theme, font_size, line_height, content_width, margin, updated_at FROM book_reader_settings LIMIT 1",
        "SELECT book_id, locator_json, progression, updated_at FROM reading_states LIMIT 1",
        "SELECT id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at FROM annotations LIMIT 1",
        "SELECT id, title, content_json, plain_text, created_at, updated_at FROM notes LIMIT 1",
        "SELECT book_id, tag, created_at FROM book_tags LIMIT 1",
        "SELECT book_id, chapter_href, chapter_title, text FROM book_content_index LIMIT 1",
    ];
    for query in validation_queries {
        sqlx::query(query)
            .fetch_optional(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(DatabaseBackupSummary {
        counts: BackupCounts {
            annotations: count(&mut connection, "annotations").await?,
            books: count(&mut connection, "books").await?,
            notes: count(&mut connection, "notes").await?,
            reading_states: count(&mut connection, "reading_states").await?,
        },
        schema_version,
    })
}

async fn create_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    let mut connection = connect(source, false).await?;
    let destination = destination
        .to_str()
        .ok_or_else(|| "backup path is not valid UTF-8".to_string())?;
    sqlx::query("VACUUM INTO ?")
        .bind(destination)
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn attached_count(
    connection: &mut SqliteConnection,
    database: &str,
    table: &str,
) -> Result<i64, String> {
    let query = match (database, table) {
        ("main", "annotations") => "SELECT COUNT(*) FROM main.annotations",
        ("main", "books") => "SELECT COUNT(*) FROM main.books",
        ("main", "notes") => "SELECT COUNT(*) FROM main.notes",
        ("main", "reading_states") => "SELECT COUNT(*) FROM main.reading_states",
        ("backup", "annotations") => "SELECT COUNT(*) FROM backup.annotations",
        ("backup", "books") => "SELECT COUNT(*) FROM backup.books",
        ("backup", "notes") => "SELECT COUNT(*) FROM backup.notes",
        ("backup", "reading_states") => "SELECT COUNT(*) FROM backup.reading_states",
        _ => return Err("unsupported attached backup table".to_string()),
    };
    sqlx::query_scalar(query)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())
}

async fn verify_restored_counts(connection: &mut SqliteConnection) -> Result<(), String> {
    for table in ["annotations", "books", "notes", "reading_states"] {
        let live = attached_count(connection, "main", table).await?;
        let backup = attached_count(connection, "backup", table).await?;
        if live != backup {
            return Err("restored database row counts do not match".to_string());
        }
    }
    Ok(())
}

async fn restore_database(source: &Path, destination: &Path) -> Result<(), String> {
    inspect_database(source).await?;
    let mut connection = connect(destination, false).await?;
    connection
        .execute("PRAGMA foreign_keys = ON")
        .await
        .map_err(|error| error.to_string())?;
    let source = source
        .to_str()
        .ok_or_else(|| "backup path is not valid UTF-8".to_string())?;
    sqlx::query("ATTACH DATABASE ? AS backup")
        .bind(source)
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;

    connection
        .execute("BEGIN IMMEDIATE")
        .await
        .map_err(|error| error.to_string())?;
    let restore_result = async {
        let statements = [
            "DELETE FROM main.book_content_index",
            "DELETE FROM main.annotations",
            "DELETE FROM main.reading_states",
            "DELETE FROM main.book_reader_settings",
            "DELETE FROM main.book_tags",
            "DELETE FROM main.books",
            "DELETE FROM main.notes",
            "DELETE FROM main.reader_settings",
            "DELETE FROM main.app_meta",
            "INSERT INTO main.app_meta (key, value) SELECT key, value FROM backup.app_meta",
            "INSERT INTO main.books (id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite) SELECT id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite FROM backup.books",
            "INSERT INTO main.reader_settings (id, theme, font_size, line_height, content_width, margin, updated_at) SELECT id, theme, font_size, line_height, content_width, margin, updated_at FROM backup.reader_settings",
            "INSERT INTO main.book_reader_settings (book_id, theme, font_size, line_height, content_width, margin, updated_at) SELECT book_id, theme, font_size, line_height, content_width, margin, updated_at FROM backup.book_reader_settings",
            "INSERT INTO main.reading_states (book_id, locator_json, progression, updated_at) SELECT book_id, locator_json, progression, updated_at FROM backup.reading_states",
            "INSERT INTO main.annotations (id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at) SELECT id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at FROM backup.annotations",
            "INSERT INTO main.notes (id, title, content_json, plain_text, created_at, updated_at) SELECT id, title, content_json, plain_text, created_at, updated_at FROM backup.notes",
            "INSERT INTO main.book_tags (book_id, tag, created_at) SELECT book_id, tag, created_at FROM backup.book_tags",
            "INSERT INTO main.book_content_index (book_id, chapter_href, chapter_title, text) SELECT book_id, chapter_href, chapter_title, text FROM backup.book_content_index",
        ];
        for statement in statements {
            connection
                .execute(statement)
                .await
                .map_err(|error| error.to_string())?;
        }
        let foreign_key_failures: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&mut connection)
                .await
                .map_err(|error| error.to_string())?;
        if foreign_key_failures != 0 {
            return Err("restored database failed foreign key validation".to_string());
        }
        verify_restored_counts(&mut connection).await
    }
    .await;

    if let Err(error) = restore_result {
        connection.execute("ROLLBACK").await.ok();
        connection.execute("DETACH DATABASE backup").await.ok();
        return Err(error);
    }
    connection
        .execute("COMMIT")
        .await
        .map_err(|error| error.to_string())?;
    connection
        .execute("DETACH DATABASE backup")
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_database_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let directory = snapshot_directory(&app, &snapshot_id)?;
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    let destination = snapshot_path(&app, &snapshot_id)?;
    create_snapshot(&database_path(&app)?, &destination).await?;
    inspect_database(&destination).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn inspect_database_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    inspect_database(&snapshot_path(&app, &snapshot_id)?).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_database_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let source = snapshot_path(&app, &snapshot_id)?;
    let destination = database_path(&app)?;
    restore_database(&source, &destination).await?;
    inspect_database(&destination).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::SystemTime,
    };

    static NEXT_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn temporary_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock must follow Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "light-reader-{label}-{}-{nonce}-{}.sqlite",
            std::process::id(),
            NEXT_DATABASE_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    async fn apply_schema(path: &Path) -> SqliteConnection {
        let mut connection = connect(path, true)
            .await
            .expect("test database should connect");
        connection
            .execute("PRAGMA foreign_keys = ON")
            .await
            .expect("foreign keys should enable");
        for migration in [
            include_str!("../migrations/0001_initial.sql"),
            include_str!("../migrations/0002_create_books.sql"),
            include_str!("../migrations/0003_reader_settings.sql"),
            include_str!("../migrations/0004_annotations.sql"),
            include_str!("../migrations/0005_annotation_notes.sql"),
            include_str!("../migrations/0006_notes.sql"),
            include_str!("../migrations/0007_local_search.sql"),
            include_str!("../migrations/0008_library_management.sql"),
        ] {
            connection
                .execute(migration)
                .await
                .expect("migration should apply");
        }
        connection
            .execute(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL)",
            )
            .await
            .expect("migration metadata should be created");
        sqlx::query("INSERT INTO _sqlx_migrations (version, success) VALUES (?, 1)")
            .bind(CURRENT_SCHEMA_VERSION)
            .execute(&mut connection)
            .await
            .expect("migration version should be recorded");
        connection
    }

    async fn seed_database(connection: &mut SqliteConnection) {
        sqlx::query(
            r#"INSERT INTO books (
              id, title, author, format, file_path, file_hash, cover_path,
              metadata_json, file_size, created_at, updated_at, favorite
            ) VALUES ('backup-book', 'Backup book', 'Author', 'epub',
              'light-reader/books/backup-book/book.epub', ?, NULL, ?, 10, 1, 1, 1)"#,
        )
        .bind("a".repeat(64))
        .bind(r#"{"title":"Backup book","creators":["Author"],"language":null,"publisher":null,"description":null,"identifier":null}"#)
        .execute(&mut *connection)
        .await
        .expect("book should seed");
        sqlx::query(
            "INSERT INTO reading_states (book_id, locator_json, progression, updated_at) VALUES ('backup-book', ?, 0.75, 2)",
        )
        .bind(r#"{"version":1,"format":"epub","progression":0.75}"#)
        .execute(&mut *connection)
        .await
        .expect("reading state should seed");
        sqlx::query(
            r#"INSERT INTO annotations (
              id, book_id, text, locator_json, color, note_text, created_at, updated_at
            ) VALUES ('backup-annotation', 'backup-book', 'highlight', ?, 'yellow', 'comment', 3, 3)"#,
        )
        .bind(r#"{"version":1,"format":"epub","cfi":"epubcfi(/6/2)"}"#)
        .execute(&mut *connection)
        .await
        .expect("annotation should seed");
        sqlx::query(
            "INSERT INTO notes (id, title, content_json, plain_text, created_at, updated_at) VALUES ('backup-note', 'Note', ?, 'body', 4, 4)",
        )
        .bind(r#"{"schemaVersion":1,"content":{"type":"doc","content":[{"type":"paragraph"}]}}"#)
        .execute(&mut *connection)
        .await
        .expect("note should seed");
    }

    #[tokio::test]
    async fn snapshot_and_restore_preserve_database_data() {
        let live_path = temporary_path("backup-live");
        let snapshot_path = temporary_path("backup-snapshot");
        let mut live = apply_schema(&live_path).await;
        seed_database(&mut live).await;
        live.close().await.expect("live database should close");

        create_snapshot(&live_path, &snapshot_path)
            .await
            .expect("consistent snapshot should be created");
        let summary = inspect_database(&snapshot_path)
            .await
            .expect("snapshot should validate");
        assert_eq!(
            summary.counts,
            BackupCounts {
                annotations: 1,
                books: 1,
                notes: 1,
                reading_states: 1,
            }
        );

        let mut changed = connect(&live_path, false)
            .await
            .expect("live database should reopen");
        changed
            .execute("DELETE FROM notes")
            .await
            .expect("note should mutate");
        changed
            .execute("UPDATE reading_states SET progression = 0.1")
            .await
            .expect("progress should mutate");
        changed
            .close()
            .await
            .expect("changed database should close");

        restore_database(&snapshot_path, &live_path)
            .await
            .expect("snapshot should restore");
        let mut restored = connect(&live_path, false)
            .await
            .expect("restored database should open");
        let progression: f64 =
            sqlx::query("SELECT progression FROM reading_states WHERE book_id = 'backup-book'")
                .fetch_one(&mut restored)
                .await
                .expect("reading state should restore")
                .get("progression");
        assert!((progression - 0.75).abs() < f64::EPSILON);
        let note_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
            .fetch_one(&mut restored)
            .await
            .expect("note should restore");
        assert_eq!(note_count, 1);
        restored.close().await.expect("database should close");

        fs::remove_file(live_path).expect("live database should be removed");
        fs::remove_file(snapshot_path).expect("snapshot should be removed");
    }

    #[tokio::test]
    async fn incompatible_restore_leaves_existing_data_unchanged() {
        let live_path = temporary_path("rollback-live");
        let invalid_path = temporary_path("rollback-invalid");
        let mut live = apply_schema(&live_path).await;
        seed_database(&mut live).await;
        live.close().await.expect("live database should close");
        let mut invalid = connect(&invalid_path, true)
            .await
            .expect("invalid database should open");
        invalid
            .execute("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL)")
            .await
            .expect("invalid migration table should create");
        invalid
            .execute("INSERT INTO _sqlx_migrations VALUES (8, 1)")
            .await
            .expect("invalid version should insert");
        invalid
            .close()
            .await
            .expect("invalid database should close");

        assert!(restore_database(&invalid_path, &live_path).await.is_err());
        let summary = inspect_database(&live_path)
            .await
            .expect("live data should remain valid");
        assert_eq!(summary.counts.books, 1);
        assert_eq!(summary.counts.notes, 1);

        fs::remove_file(live_path).expect("live database should be removed");
        fs::remove_file(invalid_path).expect("invalid database should be removed");
    }

    #[tokio::test]
    async fn failed_restore_transaction_rolls_back_existing_data() {
        let live_path = temporary_path("transaction-live");
        let snapshot_path = temporary_path("transaction-snapshot");
        let mut live = apply_schema(&live_path).await;
        seed_database(&mut live).await;
        live.close().await.expect("live database should close");
        create_snapshot(&live_path, &snapshot_path)
            .await
            .expect("snapshot should be created");

        let mut guarded = connect(&live_path, false)
            .await
            .expect("guarded database should open");
        guarded
            .execute(
                r#"CREATE TRIGGER reject_note_restore
                BEFORE INSERT ON notes BEGIN
                  SELECT RAISE(ABORT, 'forced restore failure');
                END"#,
            )
            .await
            .expect("failure trigger should be created");
        guarded
            .close()
            .await
            .expect("guarded database should close");

        assert!(restore_database(&snapshot_path, &live_path).await.is_err());
        let mut unchanged = connect(&live_path, false)
            .await
            .expect("unchanged database should open");
        let note_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
            .fetch_one(&mut unchanged)
            .await
            .expect("original notes should remain");
        let book_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM books")
            .fetch_one(&mut unchanged)
            .await
            .expect("original books should remain");
        assert_eq!(note_count, 1);
        assert_eq!(book_count, 1);
        unchanged.close().await.expect("database should close");

        fs::remove_file(live_path).expect("live database should be removed");
        fs::remove_file(snapshot_path).expect("snapshot should be removed");
    }
}

use super::{BackupCounts, DatabaseBackupSummary, CURRENT_SCHEMA_VERSION};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Executor, SqliteConnection};
use std::{fs, path::Path};

pub(super) async fn connect(path: &Path, create: bool) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(create),
    )
    .await
    .map_err(|error| error.to_string())
}

pub(super) async fn close_connection<T>(
    connection: SqliteConnection,
    result: Result<T, String>,
) -> Result<T, String> {
    let close_result = connection.close().await.map_err(|error| error.to_string());
    match result {
        Err(error) => Err(error),
        Ok(value) => {
            close_result?;
            Ok(value)
        }
    }
}

async fn count(connection: &mut SqliteConnection, table: &str) -> Result<i64, String> {
    let query = match table {
        "annotations" => "SELECT COUNT(*) FROM annotations",
        "books" => "SELECT COUNT(*) FROM books",
        "notes" => "SELECT COUNT(*) FROM notes",
        "reading_states" => "SELECT COUNT(*) FROM reading_states",
        "bookmarks" => "SELECT COUNT(*) FROM bookmarks",
        "reading_sessions" => "SELECT COUNT(*) FROM reading_sessions",
        _ => return Err("unsupported backup table".to_string()),
    };
    sqlx::query_scalar(query)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())
}

pub(super) async fn inspect_database(path: &Path) -> Result<DatabaseBackupSummary, String> {
    if !path.is_file() {
        return Err("backup database does not exist".to_string());
    }
    let mut connection = connect(path, false).await?;
    let result = async {
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err("backup database failed integrity check".to_string());
    }
    let foreign_key_failures: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    if foreign_key_failures != 0 {
        return Err("backup database failed foreign key validation".to_string());
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
          'book_content_index', 'bookmarks', 'reading_sessions',
          'ai_book_chunks'
        )"#,
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    if required_table_count != 12 {
        return Err("backup database is missing required tables".to_string());
    }

    let validation_queries = [
        "SELECT key, value FROM app_meta LIMIT 1",
        "SELECT id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite FROM books LIMIT 1",
        "SELECT id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at FROM reader_settings LIMIT 1",
        "SELECT book_id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at FROM book_reader_settings LIMIT 1",
        "SELECT book_id, locator_json, progression, updated_at FROM reading_states LIMIT 1",
        "SELECT id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at FROM annotations LIMIT 1",
        "SELECT id, title, content_json, plain_text, created_at, updated_at FROM notes LIMIT 1",
        "SELECT book_id, tag, created_at FROM book_tags LIMIT 1",
        "SELECT book_id, chapter_href, chapter_title, text FROM book_content_index LIMIT 1",
        "SELECT id, book_id, name, locator_json, created_at, updated_at FROM bookmarks LIMIT 1",
        "SELECT id, book_id, started_at, ended_at, duration_seconds FROM reading_sessions LIMIT 1",
        "SELECT schema_version, chunk_id, book_id, source_file_hash, chapter_href, chapter_title, start_locator_json, end_locator_json, text, text_hash, estimated_tokens, ordinal FROM ai_book_chunks LIMIT 1",
    ];
    for query in validation_queries {
        sqlx::query(query)
            .fetch_optional(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    }

    let summary = DatabaseBackupSummary {
        counts: BackupCounts {
            annotations: count(&mut connection, "annotations").await?,
            books: count(&mut connection, "books").await?,
            notes: count(&mut connection, "notes").await?,
            reading_states: count(&mut connection, "reading_states").await?,
            bookmarks: count(&mut connection, "bookmarks").await?,
            reading_sessions: count(&mut connection, "reading_sessions").await?,
        },
        schema_version,
    };
    Ok(summary)
    }
    .await;
    close_connection(connection, result).await
}

pub(super) async fn current_schema_version(path: &Path) -> Result<i64, String> {
    if !path.is_file() {
        return Ok(0);
    }
    let mut connection = connect(path, false).await?;
    let result = async {
        let migration_table_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations'",
        )
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
        if migration_table_exists == 0 {
            return Ok(0);
        }
        let version = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
        )
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
        Ok(version)
    }
    .await;
    close_connection(connection, result).await
}

pub(super) async fn verify_sqlite_integrity(path: &Path) -> Result<(), String> {
    let mut connection = connect(path, false).await?;
    let result = async {
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        if integrity != "ok" {
            return Err("database safety snapshot failed integrity check".to_string());
        }
        Ok(())
    }
    .await;
    close_connection(connection, result).await
}

pub(super) async fn create_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    let destination = destination
        .to_str()
        .ok_or_else(|| "backup path is not valid UTF-8".to_string())?;
    let mut connection = connect(source, false).await?;
    let result = sqlx::query("VACUUM INTO ?")
        .bind(destination)
        .execute(&mut connection)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string());
    close_connection(connection, result).await
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
        ("main", "bookmarks") => "SELECT COUNT(*) FROM main.bookmarks",
        ("main", "reading_sessions") => "SELECT COUNT(*) FROM main.reading_sessions",
        ("backup", "annotations") => "SELECT COUNT(*) FROM backup.annotations",
        ("backup", "books") => "SELECT COUNT(*) FROM backup.books",
        ("backup", "notes") => "SELECT COUNT(*) FROM backup.notes",
        ("backup", "reading_states") => "SELECT COUNT(*) FROM backup.reading_states",
        ("backup", "bookmarks") => "SELECT COUNT(*) FROM backup.bookmarks",
        ("backup", "reading_sessions") => "SELECT COUNT(*) FROM backup.reading_sessions",
        _ => return Err("unsupported attached backup table".to_string()),
    };
    sqlx::query_scalar(query)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())
}

async fn verify_restored_counts(connection: &mut SqliteConnection) -> Result<(), String> {
    for table in [
        "annotations",
        "books",
        "notes",
        "reading_states",
        "bookmarks",
        "reading_sessions",
    ] {
        let live = attached_count(connection, "main", table).await?;
        let backup = attached_count(connection, "backup", table).await?;
        if live != backup {
            return Err("restored database row counts do not match".to_string());
        }
    }
    Ok(())
}

pub(super) async fn restore_database(
    source: &Path,
    destination: &Path,
) -> Result<DatabaseBackupSummary, String> {
    let source_summary = inspect_database(source).await?;
    let mut connection = connect(destination, false).await?;
    let result = async {
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
            "DELETE FROM main.ai_book_chunks",
            "DELETE FROM main.book_content_index",
            "DELETE FROM main.annotations",
            "DELETE FROM main.bookmarks",
            "DELETE FROM main.reading_sessions",
            "DELETE FROM main.reading_states",
            "DELETE FROM main.book_reader_settings",
            "DELETE FROM main.book_tags",
            "DELETE FROM main.books",
            "DELETE FROM main.notes",
            "DELETE FROM main.reader_settings",
            "DELETE FROM main.app_meta",
            "INSERT INTO main.app_meta (key, value) SELECT key, value FROM backup.app_meta",
            "INSERT INTO main.books (id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite) SELECT id, title, author, format, file_path, file_hash, cover_path, metadata_json, file_size, created_at, updated_at, favorite FROM backup.books",
            "INSERT INTO main.reader_settings (id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at) SELECT id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at FROM backup.reader_settings",
            "INSERT INTO main.book_reader_settings (book_id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at) SELECT book_id, theme, font_family, font_weight, font_size, line_height, content_width, margin, updated_at FROM backup.book_reader_settings",
            "INSERT INTO main.reading_states (book_id, locator_json, progression, updated_at) SELECT book_id, locator_json, progression, updated_at FROM backup.reading_states",
            "INSERT INTO main.annotations (id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at) SELECT id, book_id, text, text_before, text_after, chapter_href, locator_json, color, note_text, created_at, updated_at FROM backup.annotations",
            "INSERT INTO main.notes (id, title, content_json, plain_text, created_at, updated_at) SELECT id, title, content_json, plain_text, created_at, updated_at FROM backup.notes",
            "INSERT INTO main.book_tags (book_id, tag, created_at) SELECT book_id, tag, created_at FROM backup.book_tags",
            "INSERT INTO main.book_content_index (book_id, chapter_href, chapter_title, text) SELECT book_id, chapter_href, chapter_title, text FROM backup.book_content_index",
            "INSERT INTO main.bookmarks (id, book_id, name, locator_json, created_at, updated_at) SELECT id, book_id, name, locator_json, created_at, updated_at FROM backup.bookmarks",
            "INSERT INTO main.reading_sessions (id, book_id, started_at, ended_at, duration_seconds) SELECT id, book_id, started_at, ended_at, duration_seconds FROM backup.reading_sessions",
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
    connection.execute("DETACH DATABASE backup").await.ok();
    Ok(source_summary)
    }
    .await;
    close_connection(connection, result).await
}

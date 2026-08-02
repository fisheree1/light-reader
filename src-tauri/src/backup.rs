use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Executor, SqliteConnection};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
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

async fn current_schema_version(path: &Path) -> Result<i64, String> {
    if !path.is_file() {
        return Ok(0);
    }
    let mut connection = connect(path, false).await?;
    let migration_table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    if migration_table_exists == 0 {
        return Ok(0);
    }
    sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())
}

async fn verify_sqlite_integrity(path: &Path) -> Result<(), String> {
    let mut connection = connect(path, false).await?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err("database safety snapshot failed integrity check".to_string());
    }
    Ok(())
}

fn migration_snapshot_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("light-reader").join("migration-snapshots"))
        .map_err(|error| error.to_string())
}

async fn create_migration_snapshot(
    source: &Path,
    destination_directory: &Path,
) -> Result<Option<PathBuf>, String> {
    let version = current_schema_version(source).await?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err("database schema is newer than this LightReader build".to_string());
    }
    if !source.is_file() || version == CURRENT_SCHEMA_VERSION {
        return Ok(None);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let destination =
        destination_directory.join(format!("before-schema-{version}-{timestamp}.sqlite"));
    create_snapshot(source, &destination).await?;
    verify_sqlite_integrity(&destination).await?;
    prune_migration_snapshots(destination_directory, 3)?;
    Ok(Some(destination))
}

fn prune_migration_snapshots(directory: &Path, keep: usize) -> Result<(), String> {
    let mut snapshots = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("before-schema-") && name.ends_with(".sqlite"))
        })
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    let remove_count = snapshots.len().saturating_sub(keep);
    for entry in snapshots.into_iter().take(remove_count) {
        fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn cleanup_stale_backup_snapshots(app_data: &Path) {
    let directory = app_data.join("light-reader").join("backup");
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let maximum_age = std::time::Duration::from_secs(7 * 24 * 60 * 60);
    for entry in entries.filter_map(Result::ok) {
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > maximum_age);
        if stale && entry.path().is_dir() {
            fs::remove_dir_all(entry.path()).ok();
        }
    }
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

fn safe_generated_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeletionJournal {
    book_id: String,
    cover_path: Option<String>,
    version: u8,
}

fn validate_journal_cover(book_id: &str, cover_path: &str) -> Result<String, String> {
    for extension in ["gif", "jpeg", "png", "webp"] {
        if cover_path == format!("light-reader/covers/{book_id}.{extension}") {
            return Ok(extension.to_string());
        }
    }
    Err("deletion journal contains an unsafe cover path".to_string())
}

async fn reconcile_deletion_journals_at(app_data: &Path, database: &Path) -> Result<(), String> {
    let trash = app_data.join("light-reader").join("trash");
    if !trash.is_dir() || !database.is_file() {
        return Ok(());
    }
    let mut connection = connect(database, false).await?;
    let books_table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'books'",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    if books_table_exists == 0 {
        return Ok(());
    }

    for entry in fs::read_dir(&trash).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let quarantine = entry.path();
        if !quarantine.is_dir() {
            continue;
        }
        let journal_data = match fs::read(quarantine.join("deletion.json")) {
            Ok(data) => data,
            Err(_) => continue,
        };
        let journal: DeletionJournal =
            serde_json::from_slice(&journal_data).map_err(|error| error.to_string())?;
        if journal.version != 1 || !safe_generated_id(&journal.book_id) {
            return Err("deletion journal is invalid".to_string());
        }
        let book_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM books WHERE id = ?")
            .bind(&journal.book_id)
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        if book_exists == 0 {
            fs::remove_dir_all(&quarantine).map_err(|error| error.to_string())?;
            continue;
        }

        let quarantined_book = quarantine.join("book");
        if quarantined_book.exists() {
            let restored_book = app_data
                .join("light-reader")
                .join("books")
                .join(&journal.book_id);
            if restored_book.exists() {
                return Err("both live and quarantined book files exist".to_string());
            }
            if let Some(parent) = restored_book.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::rename(quarantined_book, restored_book).map_err(|error| error.to_string())?;
        }

        if let Some(cover_path) = journal.cover_path {
            let extension = validate_journal_cover(&journal.book_id, &cover_path)?;
            let quarantined_cover = quarantine.join(format!("cover.{extension}"));
            if quarantined_cover.exists() {
                let restored_cover = app_data
                    .join("light-reader")
                    .join("covers")
                    .join(format!("{}.{extension}", journal.book_id));
                if restored_cover.exists() {
                    return Err("both live and quarantined cover files exist".to_string());
                }
                if let Some(parent) = restored_cover.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::rename(quarantined_cover, restored_cover).map_err(|error| error.to_string())?;
            }
        }
        fs::remove_dir_all(&quarantine).map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn reconcile_deletion_journals(app: &AppHandle) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    reconcile_deletion_journals_at(&app_data, &database_path(app)?).await
}

async fn validate_managed_book_files_at(app_data: &Path, database: &Path) -> Result<(), String> {
    let mut connection = connect(database, false).await?;
    let rows: Vec<(String, String, Option<String>, i64)> =
        sqlx::query_as("SELECT id, file_path, cover_path, file_size FROM books")
            .fetch_all(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    for (id, book_path, cover_path, expected_size) in rows {
        if !safe_generated_id(&id) {
            return Err("backup contains an unsafe book id".to_string());
        }
        let expected_book_path = format!("light-reader/books/{id}/book.epub");
        if book_path != expected_book_path {
            return Err("backup contains a book path outside managed storage".to_string());
        }
        let managed_book_path = app_data
            .join("light-reader")
            .join("books")
            .join(&id)
            .join("book.epub");
        let book_metadata = fs::metadata(managed_book_path)
            .map_err(|_| "a book file required by this backup is missing".to_string())?;
        if expected_size < 0 || book_metadata.len() != expected_size as u64 {
            return Err("a book file required by this backup has changed".to_string());
        }
        if let Some(cover_path) = cover_path {
            let valid_cover_path = ["gif", "jpeg", "png", "webp"]
                .iter()
                .any(|extension| cover_path == format!("light-reader/covers/{id}.{extension}"));
            if !valid_cover_path {
                return Err("backup contains a cover path outside managed storage".to_string());
            }
            let extension = cover_path
                .rsplit_once('.')
                .map(|(_, extension)| extension)
                .ok_or_else(|| "backup contains an invalid cover path".to_string())?;
            if !app_data
                .join("light-reader")
                .join("covers")
                .join(format!("{id}.{extension}"))
                .is_file()
            {
                return Err("a cover file required by this backup is missing".to_string());
            }
        }
    }
    Ok(())
}

async fn validate_managed_book_files(app: &AppHandle, database: &Path) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    validate_managed_book_files_at(&app_data, database).await
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

async fn restore_database(
    source: &Path,
    destination: &Path,
) -> Result<DatabaseBackupSummary, String> {
    let source_summary = inspect_database(source).await?;
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
    // COMMIT is the success boundary. A detached database is also released when
    // this connection is dropped, so a post-commit DETACH failure must not turn
    // an already-applied restore into a false rollback report.
    connection.execute("DETACH DATABASE backup").await.ok();
    Ok(source_summary)
}

#[tauri::command]
pub async fn prepare_database_migration(app: AppHandle) -> Result<(), String> {
    reconcile_deletion_journals(&app).await?;
    // Prepared backup snapshots abandoned by a crash are pruned conservatively;
    // never remove a recent directory that another desktop process may own.
    if let Ok(directory) = app.path().app_data_dir() {
        cleanup_stale_backup_snapshots(&directory);
    }
    create_migration_snapshot(&database_path(&app)?, &migration_snapshot_directory(&app)?).await?;
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
    validate_managed_book_files(&app, &destination).await?;
    inspect_database(&destination).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn inspect_database_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let snapshot = snapshot_path(&app, &snapshot_id)?;
    validate_managed_book_files(&app, &snapshot).await?;
    inspect_database(&snapshot).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_database_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let source = snapshot_path(&app, &snapshot_id)?;
    let destination = database_path(&app)?;
    validate_managed_book_files(&app, &source).await?;
    restore_database(&source, &destination).await
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

    #[tokio::test]
    async fn pre_migration_snapshot_preserves_an_old_database() {
        let live_path = temporary_path("migration-live");
        let snapshot_directory = temporary_path("migration-snapshots");
        let mut live = connect(&live_path, true)
            .await
            .expect("old database should open");
        live.execute(include_str!("../migrations/0001_initial.sql"))
            .await
            .expect("initial migration should apply");
        live.execute(include_str!("../migrations/0002_create_books.sql"))
            .await
            .expect("books migration should apply");
        live.execute(
            "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL)",
        )
        .await
        .expect("migration history should create");
        live.execute("INSERT INTO _sqlx_migrations VALUES (2, 1)")
            .await
            .expect("old schema version should record");
        sqlx::query(
            r#"INSERT INTO books (
              id, title, format, file_path, file_hash, metadata_json,
              file_size, created_at, updated_at
            ) VALUES ('old-book', 'Before migration', 'epub',
              'light-reader/books/old-book/book.epub', ?, ?, 10, 1, 1)"#,
        )
        .bind("a".repeat(64))
        .bind(r#"{"title":"Before migration","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}"#)
        .execute(&mut live)
        .await
        .expect("old book should seed");
        live.close().await.expect("old database should close");

        let snapshot = create_migration_snapshot(&live_path, &snapshot_directory)
            .await
            .expect("migration safety snapshot should succeed")
            .expect("old database should need a snapshot");
        let mut copied = connect(&snapshot, false)
            .await
            .expect("snapshot should reopen");
        let title: String = sqlx::query_scalar("SELECT title FROM books WHERE id = 'old-book'")
            .fetch_one(&mut copied)
            .await
            .expect("snapshot should retain old data");
        assert_eq!(title, "Before migration");
        copied.close().await.expect("snapshot should close");

        fs::remove_file(live_path).expect("live database should be removed");
        fs::remove_dir_all(snapshot_directory).expect("snapshot directory should be removed");
    }

    #[tokio::test]
    async fn restore_preflight_rejects_missing_managed_book_files() {
        let database_path = temporary_path("managed-files-database");
        let app_data = temporary_path("managed-files-appdata");
        let mut database = apply_schema(&database_path).await;
        seed_database(&mut database).await;
        database.close().await.expect("database should close");

        let book_directory = app_data
            .join("light-reader")
            .join("books")
            .join("backup-book");
        fs::create_dir_all(&book_directory).expect("book directory should create");
        fs::write(book_directory.join("book.epub"), [0_u8; 10])
            .expect("managed book should create");
        validate_managed_book_files_at(&app_data, &database_path)
            .await
            .expect("matching managed file should pass");

        fs::remove_file(book_directory.join("book.epub"))
            .expect("managed book should be removable");
        assert!(validate_managed_book_files_at(&app_data, &database_path)
            .await
            .is_err());

        fs::remove_file(database_path).expect("database should be removed");
        fs::remove_dir_all(app_data).expect("app data should be removed");
    }

    #[tokio::test]
    async fn startup_reconciles_interrupted_book_deletions() {
        let database_path = temporary_path("deletion-journal-database");
        let app_data = temporary_path("deletion-journal-appdata");
        let mut database = apply_schema(&database_path).await;
        seed_database(&mut database).await;
        database.close().await.expect("database should close");

        let first_quarantine = app_data
            .join("light-reader")
            .join("trash")
            .join("delete-before-commit");
        fs::create_dir_all(first_quarantine.join("book")).expect("quarantine should create");
        fs::write(first_quarantine.join("book").join("book.epub"), [0_u8; 10])
            .expect("quarantined book should create");
        fs::write(
            first_quarantine.join("deletion.json"),
            r#"{"version":1,"bookId":"backup-book","coverPath":null}"#,
        )
        .expect("journal should create");

        reconcile_deletion_journals_at(&app_data, &database_path)
            .await
            .expect("uncommitted deletion should restore files");
        let live_book = app_data
            .join("light-reader")
            .join("books")
            .join("backup-book");
        assert!(live_book.join("book.epub").is_file());
        assert!(!first_quarantine.exists());

        let mut database = connect(&database_path, false)
            .await
            .expect("database should reopen");
        database
            .execute("PRAGMA foreign_keys = ON")
            .await
            .expect("foreign keys should enable");
        database
            .execute("DELETE FROM books WHERE id = 'backup-book'")
            .await
            .expect("book deletion should commit");
        database.close().await.expect("database should close");
        let second_quarantine = app_data
            .join("light-reader")
            .join("trash")
            .join("delete-after-commit");
        fs::create_dir_all(&second_quarantine).expect("second quarantine should exist");
        fs::rename(&live_book, second_quarantine.join("book"))
            .expect("live book should move back to quarantine");
        fs::write(
            second_quarantine.join("deletion.json"),
            r#"{"version":1,"bookId":"backup-book","coverPath":null}"#,
        )
        .expect("second journal should create");

        reconcile_deletion_journals_at(&app_data, &database_path)
            .await
            .expect("committed deletion should clean quarantine");
        assert!(!second_quarantine.exists());
        assert!(!live_book.exists());

        fs::remove_file(database_path).expect("database should be removed");
        fs::remove_dir_all(app_data).expect("app data should be removed");
    }
}

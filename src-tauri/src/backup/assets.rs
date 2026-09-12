use super::database::{close_connection, connect};
use serde::Deserialize;
use std::{fs, path::Path};

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

pub(super) async fn reconcile_deletion_journals_at(
    app_data: &Path,
    database: &Path,
) -> Result<(), String> {
    let trash = app_data.join("light-reader").join("trash");
    if !trash.is_dir() || !database.is_file() {
        return Ok(());
    }
    let mut connection = connect(database, false).await?;
    let result = async {
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
                    fs::rename(quarantined_cover, restored_cover)
                        .map_err(|error| error.to_string())?;
                }
            }
            fs::remove_dir_all(&quarantine).map_err(|error| error.to_string())?;
        }
        Ok(())
    }
    .await;
    close_connection(connection, result).await
}

pub(super) async fn validate_managed_book_files_at(
    app_data: &Path,
    database: &Path,
) -> Result<(), String> {
    let mut connection = connect(database, false).await?;
    let result = async {
        let rows: Vec<(String, String, String, Option<String>, i64)> =
            sqlx::query_as("SELECT id, format, file_path, cover_path, file_size FROM books")
                .fetch_all(&mut connection)
                .await
                .map_err(|error| error.to_string())?;
        for (id, format, book_path, cover_path, expected_size) in rows {
            if !safe_generated_id(&id) {
                return Err("backup contains an unsafe book id".to_string());
            }
            if format != "epub" && format != "pdf" {
                return Err("backup contains an unsupported book format".to_string());
            }
            let expected_book_path = format!("light-reader/books/{id}/book.{format}");
            if book_path != expected_book_path {
                return Err("backup contains a book path outside managed storage".to_string());
            }
            let managed_book_path = app_data
                .join("light-reader")
                .join("books")
                .join(&id)
                .join(format!("book.{format}"));
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
    .await;
    close_connection(connection, result).await
}

pub(super) fn replace_asset_directory(
    live_root: &Path,
    staged_root: &Path,
    safety_root: &Path,
    name: &str,
) -> Result<(), String> {
    let live = live_root.join(name);
    let staged = staged_root.join(name);
    let safety = safety_root.join(name);
    if live.exists() {
        fs::create_dir_all(safety_root).map_err(|error| error.to_string())?;
        fs::rename(&live, &safety).map_err(|error| error.to_string())?;
    }
    if staged.exists() {
        fs::create_dir_all(live_root).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&staged, &live) {
            if safety.exists() {
                fs::rename(&safety, &live).ok();
            }
            return Err(error.to_string());
        }
    }
    Ok(())
}

pub(super) fn rollback_asset_directories(
    live_root: &Path,
    staged_root: &Path,
    safety_root: &Path,
    names: &[&str],
) -> Result<(), String> {
    for name in names {
        let live = live_root.join(name);
        let staged = staged_root.join(name);
        let safety = safety_root.join(name);
        if live.exists() {
            if staged.exists() {
                fs::remove_dir_all(&live).map_err(|error| error.to_string())?;
            } else {
                fs::create_dir_all(staged_root).map_err(|error| error.to_string())?;
                fs::rename(&live, &staged).map_err(|error| error.to_string())?;
            }
        }
        if safety.exists() {
            fs::rename(&safety, &live).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

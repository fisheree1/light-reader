use serde::Deserialize;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{path::Path, time::Duration};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReferenceUpdate {
    id: String,
    content_json: String,
    plain_text: String,
    updated_at: i64,
}

fn database_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("light-reader.db"))
        .map_err(|error| error.to_string())
}

async fn connect(path: &Path) -> Result<SqliteConnection, String> {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(false)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5)),
    )
    .await
    .map_err(|error| error.to_string())
}

async fn delete_book_transaction(
    path: &Path,
    book_id: &str,
    note_updates: Vec<NoteReferenceUpdate>,
) -> Result<(), String> {
    if book_id.is_empty() || book_id.len() > 128 {
        return Err("invalid book id".to_string());
    }
    let mut connection = connect(path).await?;
    let result = async {
        let mut transaction = connection
            .begin()
            .await
            .map_err(|error| error.to_string())?;

        for update in note_updates {
            if update.id.is_empty() || update.id.len() > 128 {
                return Err("invalid note id".to_string());
            }
            serde_json::from_str::<serde_json::Value>(&update.content_json)
                .map_err(|_| "invalid note document".to_string())?;
            let result = sqlx::query(
                "UPDATE notes SET content_json = ?, plain_text = ?, updated_at = ? WHERE id = ?",
            )
            .bind(update.content_json)
            .bind(update.plain_text)
            .bind(update.updated_at)
            .bind(update.id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            if result.rows_affected() != 1 {
                return Err("note update target does not exist".to_string());
            }
        }

        let deleted = sqlx::query("DELETE FROM books WHERE id = ?")
            .bind(book_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        if deleted.rows_affected() != 1 {
            return Err("book delete target does not exist".to_string());
        }
        transaction
            .commit()
            .await
            .map_err(|error| error.to_string())
    }
    .await;
    let close_result = connection.close().await.map_err(|error| error.to_string());
    match result {
        Err(error) => Err(error),
        Ok(()) => close_result,
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_library_book(
    app: AppHandle,
    book_id: String,
    note_updates: Vec<NoteReferenceUpdate>,
) -> Result<(), String> {
    delete_book_transaction(&database_path(&app)?, &book_id, note_updates).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_path(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must follow the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("light-reader-{label}-{nonce}.sqlite"))
    }

    async fn seeded_database(path: &Path) -> SqliteConnection {
        let mut connection = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .expect("test database should connect");
        for statement in [
            "CREATE TABLE books (id TEXT PRIMARY KEY, format TEXT NOT NULL)",
            r#"CREATE TABLE notes (
                 id TEXT PRIMARY KEY,
                 content_json TEXT NOT NULL,
                 plain_text TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
               )"#,
            r#"CREATE TABLE annotations (
                 id TEXT PRIMARY KEY,
                 book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE
               )"#,
        ] {
            sqlx::query(statement)
                .execute(&mut connection)
                .await
                .expect("test schema should apply");
        }
        sqlx::query("INSERT INTO books (id, format) VALUES ('pdf-1', 'pdf')")
            .execute(&mut connection)
            .await
            .expect("PDF should seed");
        sqlx::query(
            "INSERT INTO notes (id, content_json, plain_text, updated_at) VALUES ('note-1', '{}', 'old', 1)",
        )
        .execute(&mut connection)
        .await
        .expect("note should seed");
        sqlx::query("INSERT INTO annotations (id, book_id) VALUES ('mark-1', 'pdf-1')")
            .execute(&mut connection)
            .await
            .expect("annotation should seed");
        connection
    }

    #[tokio::test]
    async fn deletes_pdf_and_updates_note_in_one_connection_transaction() {
        let path = temporary_path("delete-pdf");
        let mut inspection = seeded_database(&path).await;
        inspection
            .close()
            .await
            .expect("seed database should close");

        delete_book_transaction(
            &path,
            "pdf-1",
            vec![NoteReferenceUpdate {
                id: "note-1".to_string(),
                content_json: r#"{"type":"doc"}"#.to_string(),
                plain_text: "updated".to_string(),
                updated_at: 2,
            }],
        )
        .await
        .expect("PDF deletion should commit");

        inspection = connect(&path).await.expect("database should reopen");
        let books: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM books")
            .fetch_one(&mut inspection)
            .await
            .expect("books should count");
        let annotations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM annotations")
            .fetch_one(&mut inspection)
            .await
            .expect("annotations should count");
        let note: String = sqlx::query_scalar("SELECT plain_text FROM notes WHERE id = 'note-1'")
            .fetch_one(&mut inspection)
            .await
            .expect("note should remain");
        assert_eq!((books, annotations, note.as_str()), (0, 0, "updated"));
        inspection
            .close()
            .await
            .expect("inspection database should close");
        std::fs::remove_file(path).expect("test database should be removable");
    }

    #[tokio::test]
    async fn rolls_back_note_updates_when_the_book_is_missing() {
        let path = temporary_path("delete-rollback");
        let mut inspection = seeded_database(&path).await;
        inspection
            .close()
            .await
            .expect("seed database should close");

        let result = delete_book_transaction(
            &path,
            "missing",
            vec![NoteReferenceUpdate {
                id: "note-1".to_string(),
                content_json: r#"{"type":"doc"}"#.to_string(),
                plain_text: "must roll back".to_string(),
                updated_at: 2,
            }],
        )
        .await;
        assert!(result.is_err());

        inspection = connect(&path).await.expect("database should reopen");
        let note: String = sqlx::query_scalar("SELECT plain_text FROM notes WHERE id = 'note-1'")
            .fetch_one(&mut inspection)
            .await
            .expect("note should remain");
        assert_eq!(note, "old");
        inspection
            .close()
            .await
            .expect("inspection database should close");
        std::fs::remove_file(path).expect("test database should be removable");
    }
}

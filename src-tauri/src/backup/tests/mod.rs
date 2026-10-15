mod support;

use super::database::connect;
use super::*;
use sqlx::{Connection, Executor, Row};
use support::{apply_schema, create_native_smoke_epub, seed_database, temporary_path};

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
            bookmarks: 0,
            reading_sessions: 0,
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
    let ai_chunk_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_book_chunks")
        .fetch_one(&mut restored)
        .await
        .expect("derived AI index should remain queryable");
    assert_eq!(
        ai_chunk_count, 0,
        "derived AI chunks must rebuild on demand"
    );
    restored.close().await.expect("database should close");

    fs::remove_file(live_path).expect("live database should be removed");
    fs::remove_file(snapshot_path).expect("snapshot should be removed");
}

#[test]
fn full_backup_asset_swap_rolls_back_without_losing_either_version() {
    let root = temporary_path("full-backup-assets");
    let live = root.join("live");
    let staged = root.join("staged");
    let safety = root.join("safety");
    fs::create_dir_all(live.join("books")).expect("live books should exist");
    fs::create_dir_all(staged.join("books")).expect("staged books should exist");
    fs::write(live.join("books/book.epub"), b"current").expect("current book should seed");
    fs::write(staged.join("books/book.epub"), b"backup").expect("backup book should seed");

    replace_asset_directory(&live, &staged, &safety, "books")
        .expect("full backup assets should swap");
    assert_eq!(
        fs::read(live.join("books/book.epub")).expect("backup book should be live"),
        b"backup"
    );
    assert_eq!(
        fs::read(safety.join("books/book.epub")).expect("current book should be retained"),
        b"current"
    );

    rollback_asset_directories(&live, &staged, &safety, &["books"])
        .expect("asset rollback should succeed");
    assert_eq!(
        fs::read(live.join("books/book.epub")).expect("current book should be restored"),
        b"current"
    );
    assert_eq!(
        fs::read(staged.join("books/book.epub")).expect("backup book should be restaged"),
        b"backup"
    );
    fs::remove_dir_all(root).expect("temporary assets should be removed");
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
        .execute(
            "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL)",
        )
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
    live.execute(include_str!("../../../migrations/0001_initial.sql"))
        .await
        .expect("initial migration should apply");
    live.execute(include_str!("../../../migrations/0002_create_books.sql"))
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
    fs::write(book_directory.join("book.epub"), [0_u8; 10]).expect("managed book should create");
    validate_managed_book_files_at(&app_data, &database_path)
        .await
        .expect("matching managed file should pass");

    fs::remove_file(book_directory.join("book.epub")).expect("managed book should be removable");
    assert!(validate_managed_book_files_at(&app_data, &database_path)
        .await
        .is_err());

    fs::remove_file(database_path).expect("database should be removed");
    fs::remove_dir_all(app_data).expect("app data should be removed");
}

#[tokio::test]
async fn restore_preflight_accepts_a_managed_pdf() {
    let database_path = temporary_path("managed-pdf-database");
    let app_data = temporary_path("managed-pdf-appdata");
    let mut database = apply_schema(&database_path).await;
    sqlx::query(
        r#"INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES ('pdf-book', 'PDF book', NULL, 'pdf',
          'light-reader/books/pdf-book/book.pdf', ?, NULL, ?, 8, 1, 1)"#,
    )
    .bind("d".repeat(64))
    .bind(r#"{"title":"PDF book","creators":[],"language":null,"publisher":null,"description":null,"identifier":null}"#)
    .execute(&mut database)
    .await
    .expect("PDF row should seed");
    database.close().await.expect("database should close");

    let book_directory = app_data.join("light-reader").join("books").join("pdf-book");
    fs::create_dir_all(&book_directory).expect("PDF directory should create");
    fs::write(book_directory.join("book.pdf"), b"%PDF-1\nx").expect("managed PDF should create");

    validate_managed_book_files_at(&app_data, &database_path)
        .await
        .expect("matching managed PDF should pass");

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

#[tokio::test]
async fn native_smoke_imports_epub_and_round_trips_application_data() {
    let database_path = temporary_path("native-smoke-database");
    let app_data = temporary_path("native-smoke-appdata");
    let book_path = app_data
        .join("light-reader")
        .join("books")
        .join("native-smoke-book")
        .join("book.epub");
    let snapshot_path = app_data
        .join("light-reader")
        .join("exports")
        .join("native-smoke-backup.sqlite");
    let epub = create_native_smoke_epub();

    fs::create_dir_all(book_path.parent().expect("book path has a parent"))
        .expect("managed book directory should create");
    fs::write(&book_path, &epub).expect("EPUB should write to application data");
    assert_eq!(
        fs::read(&book_path).expect("EPUB should read from application data"),
        epub
    );

    let mut database = apply_schema(&database_path).await;
    sqlx::query(
        r#"INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES ('native-smoke-book', 'Native smoke EPUB', NULL, 'epub',
          'light-reader/books/native-smoke-book/book.epub', ?, NULL, ?, ?, 1, 1)"#,
    )
    .bind("f".repeat(64))
    .bind(r#"{"title":"Native smoke EPUB","creators":[],"language":"en","publisher":null,"description":null,"identifier":"urn:lightreader:native-smoke"}"#)
    .bind(i64::try_from(epub.len()).expect("fixture size should fit SQLite"))
    .execute(&mut database)
    .await
    .expect("real EPUB import should persist");
    database
        .close()
        .await
        .expect("initialized database should close");

    validate_managed_book_files_at(&app_data, &database_path)
        .await
        .expect("database and managed EPUB should agree");
    create_snapshot(&database_path, &snapshot_path)
        .await
        .expect("backup export should create a SQLite snapshot");

    let mut changed = connect(&database_path, false)
        .await
        .expect("live database should reopen");
    changed
        .execute("UPDATE books SET title = 'Changed after backup'")
        .await
        .expect("live data should change after export");
    changed
        .close()
        .await
        .expect("changed database should close");

    restore_database(&snapshot_path, &database_path)
        .await
        .expect("backup should restore transactionally");
    let mut restored = connect(&database_path, false)
        .await
        .expect("restored database should open");
    let title: String =
        sqlx::query_scalar("SELECT title FROM books WHERE id = 'native-smoke-book'")
            .fetch_one(&mut restored)
            .await
            .expect("restored book should exist");
    assert_eq!(title, "Native smoke EPUB");
    restored
        .close()
        .await
        .expect("restored database should close");

    fs::remove_file(database_path).expect("database should be removed");
    fs::remove_dir_all(app_data).expect("application data should be removed");
}

#[cfg(unix)]
#[test]
fn native_smoke_observes_missing_and_permission_denied_files() {
    use std::os::unix::fs::PermissionsExt;

    let directory = temporary_path("native-smoke-permissions");
    let missing = directory.join("missing.epub");
    let denied = directory.join("denied.epub");
    fs::create_dir_all(&directory).expect("permission fixture directory should create");

    let missing_error = fs::read(&missing).expect_err("missing file should fail");
    assert_eq!(missing_error.kind(), std::io::ErrorKind::NotFound);

    fs::write(&denied, create_native_smoke_epub()).expect("denied fixture should write");
    fs::set_permissions(&denied, fs::Permissions::from_mode(0o000))
        .expect("fixture permissions should change");
    let denied_error = fs::read(&denied).expect_err("unreadable file should fail");
    assert_eq!(denied_error.kind(), std::io::ErrorKind::PermissionDenied);

    fs::set_permissions(&denied, fs::Permissions::from_mode(0o600))
        .expect("fixture permissions should restore");
    fs::remove_dir_all(directory).expect("permission fixtures should be removed");
}

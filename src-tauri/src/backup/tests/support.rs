//! Fixtures shared by the backup tests: isolated SQLite files with the
//! shipped schema, seeded application data, and a minimal stored EPUB.

use super::super::database::connect;
use super::super::CURRENT_SCHEMA_VERSION;
use sqlx::{Executor, SqliteConnection};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};

static NEXT_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

pub(super) fn temporary_path(label: &str) -> PathBuf {
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

pub(super) async fn apply_schema(path: &Path) -> SqliteConnection {
    let mut connection = connect(path, true)
        .await
        .expect("test database should connect");
    connection
        .execute("PRAGMA foreign_keys = ON")
        .await
        .expect("foreign keys should enable");
    for migration in [
        include_str!("../../../migrations/0001_initial.sql"),
        include_str!("../../../migrations/0002_create_books.sql"),
        include_str!("../../../migrations/0003_reader_settings.sql"),
        include_str!("../../../migrations/0004_annotations.sql"),
        include_str!("../../../migrations/0005_annotation_notes.sql"),
        include_str!("../../../migrations/0006_notes.sql"),
        include_str!("../../../migrations/0007_local_search.sql"),
        include_str!("../../../migrations/0008_library_management.sql"),
        include_str!("../../../migrations/0009_bookmarks_and_reading_activity.sql"),
        include_str!("../../../migrations/0010_pdf_books.sql"),
        include_str!("../../../migrations/0011_ai_book_chunks.sql"),
        include_str!("../../../migrations/0012_foliate_formats.sql"),
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

pub(super) async fn seed_database(connection: &mut SqliteConnection) {
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
    sqlx::query(
        r#"INSERT INTO ai_book_chunks (
          schema_version, chunk_id, book_id, source_file_hash,
          chapter_href, chapter_title, start_locator_json,
          end_locator_json, text, text_hash, estimated_tokens, ordinal
        ) VALUES (1, 'backup-chunk', 'backup-book', ?, 'chapter.xhtml',
          'Chapter', ?, NULL, 'derived text', 'derived-hash', 3, 0)"#,
    )
    .bind("a".repeat(64))
    .bind(r#"{"version":1,"format":"epub","chapterHref":"chapter.xhtml"}"#)
    .execute(&mut *connection)
    .await
    .expect("derived AI chunk should seed");
}

pub(super) fn create_native_smoke_epub() -> Vec<u8> {
    let entries = [
        ("mimetype", b"application/epub+zip".as_slice()),
        (
            "META-INF/container.xml",
            br#"<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#.as_slice(),
        ),
        (
            "EPUB/content.opf",
            br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier>urn:lightreader:native-smoke</dc:identifier><dc:title>Native smoke EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#.as_slice(),
        ),
        (
            "EPUB/chapter.xhtml",
            br#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Smoke</title></head><body><h1>Native smoke</h1></body></html>"#.as_slice(),
        ),
    ];
    create_stored_zip(&entries)
}

fn create_stored_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut archive = Vec::new();
    let mut central_records = Vec::new();
    for (name, data) in entries {
        let offset = u32::try_from(archive.len()).expect("fixture offset should fit ZIP");
        let crc = crc32(data);
        push_u32(&mut archive, 0x0403_4b50);
        push_u16(&mut archive, 20);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u32(&mut archive, crc);
        push_u32(
            &mut archive,
            u32::try_from(data.len()).expect("fixture entry should fit ZIP"),
        );
        push_u32(
            &mut archive,
            u32::try_from(data.len()).expect("fixture entry should fit ZIP"),
        );
        push_u16(
            &mut archive,
            u16::try_from(name.len()).expect("fixture name should fit ZIP"),
        );
        push_u16(&mut archive, 0);
        archive.extend_from_slice(name.as_bytes());
        archive.extend_from_slice(data);
        central_records.push((*name, *data, crc, offset));
    }

    let central_offset = u32::try_from(archive.len()).expect("central offset should fit ZIP");
    for (name, data, crc, offset) in central_records {
        push_u32(&mut archive, 0x0201_4b50);
        push_u16(&mut archive, 20);
        push_u16(&mut archive, 20);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u32(&mut archive, crc);
        push_u32(
            &mut archive,
            u32::try_from(data.len()).expect("fixture entry should fit ZIP"),
        );
        push_u32(
            &mut archive,
            u32::try_from(data.len()).expect("fixture entry should fit ZIP"),
        );
        push_u16(
            &mut archive,
            u16::try_from(name.len()).expect("fixture name should fit ZIP"),
        );
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u16(&mut archive, 0);
        push_u32(&mut archive, 0);
        push_u32(&mut archive, offset);
        archive.extend_from_slice(name.as_bytes());
    }
    let central_size = u32::try_from(archive.len())
        .expect("archive size should fit ZIP")
        .saturating_sub(central_offset);
    push_u32(&mut archive, 0x0605_4b50);
    push_u16(&mut archive, 0);
    push_u16(&mut archive, 0);
    let entry_count = u16::try_from(entries.len()).expect("entry count should fit ZIP");
    push_u16(&mut archive, entry_count);
    push_u16(&mut archive, entry_count);
    push_u32(&mut archive, central_size);
    push_u32(&mut archive, central_offset);
    push_u16(&mut archive, 0);
    archive
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

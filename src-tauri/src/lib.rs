use log::LevelFilter;
#[cfg(desktop)]
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod backup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create app metadata table",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create books table",
            sql: include_str!("../migrations/0002_create_books.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create reader settings and reading states",
            sql: include_str!("../migrations/0003_reader_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create annotations table",
            sql: include_str!("../migrations/0004_annotations.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add annotation notes",
            sql: include_str!("../migrations/0005_annotation_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create notes table",
            sql: include_str!("../migrations/0006_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create local full-text search indexes",
            sql: include_str!("../migrations/0007_local_search.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add library favorites and book tags",
            sql: include_str!("../migrations/0008_library_management.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add bookmarks and reading activity",
            sql: include_str!("../migrations/0009_bookmarks_and_reading_activity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "allow managed PDF books",
            sql: include_str!("../migrations/0010_pdf_books.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // This must be the first plugin. File quarantine recovery and SQLite
        // maintenance assume only one desktop process owns AppData at a time.
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_focus().ok();
                }
            },
        ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            backup::prepare_database_migration,
            backup::create_database_snapshot,
            backup::inspect_database_snapshot,
            backup::restore_database_snapshot,
            backup::inspect_full_backup_snapshot,
            backup::restore_full_backup_snapshot,
            backup::available_backup_space
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:light-reader.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running LightReader");
}

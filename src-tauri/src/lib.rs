use log::LevelFilter;
use tauri_plugin_sql::{Migration, MigrationKind};

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
    ];

    tauri::Builder::default()
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

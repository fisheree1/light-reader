use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

mod assets;
mod database;
mod migration;

use assets::{
    reconcile_deletion_journals_at, replace_asset_directory, rollback_asset_directories,
    validate_managed_book_files_at,
};
use database::{create_snapshot, inspect_database, restore_database};
use migration::{
    cleanup_stale_backup_snapshots, create_migration_snapshot, migration_snapshot_directory,
};

pub const CURRENT_SCHEMA_VERSION: i64 = 11;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    annotations: i64,
    books: i64,
    notes: i64,
    reading_states: i64,
    bookmarks: i64,
    reading_sessions: i64,
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

async fn reconcile_deletion_journals(app: &AppHandle) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    reconcile_deletion_journals_at(&app_data, &database_path(app)?).await
}

async fn validate_managed_book_files(app: &AppHandle, database: &Path) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    validate_managed_book_files_at(&app_data, database).await
}

fn staged_assets_root(app: &AppHandle, snapshot_id: &str) -> Result<PathBuf, String> {
    Ok(snapshot_directory(app, snapshot_id)?.join("assets"))
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

#[tauri::command]
pub fn available_backup_space(app: AppHandle) -> Result<u64, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    fs2::available_space(directory).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn inspect_full_backup_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let snapshot = snapshot_path(&app, &snapshot_id)?;
    validate_managed_book_files_at(&staged_assets_root(&app, &snapshot_id)?, &snapshot).await?;
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

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_full_backup_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<DatabaseBackupSummary, String> {
    let source = snapshot_path(&app, &snapshot_id)?;
    let staged_root = staged_assets_root(&app, &snapshot_id)?.join("light-reader");
    validate_managed_book_files_at(&staged_assets_root(&app, &snapshot_id)?, &source).await?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let live_root = app_data.join("light-reader");
    let safety_root = snapshot_directory(&app, &snapshot_id)?.join("current-assets");
    if safety_root.exists() {
        fs::remove_dir_all(&safety_root).map_err(|error| error.to_string())?;
    }
    let names = ["books", "covers"];
    for name in names {
        if let Err(error) = replace_asset_directory(&live_root, &staged_root, &safety_root, name) {
            rollback_asset_directories(&live_root, &staged_root, &safety_root, &names)?;
            return Err(error);
        }
    }

    match restore_database(&source, &database_path(&app)?).await {
        Ok(summary) => Ok(summary),
        Err(error) => {
            rollback_asset_directories(&live_root, &staged_root, &safety_root, &names)?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests;

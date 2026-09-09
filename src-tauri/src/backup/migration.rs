use super::{
    database::{create_snapshot, current_schema_version, verify_sqlite_integrity},
    CURRENT_SCHEMA_VERSION,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub(super) fn migration_snapshot_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("light-reader").join("migration-snapshots"))
        .map_err(|error| error.to_string())
}

pub(super) async fn create_migration_snapshot(
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

pub(super) fn cleanup_stale_backup_snapshots(app_data: &Path) {
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

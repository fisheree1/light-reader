# Data export and backup

LightReader backup is a local, versioned database-maintenance boundary. React
calls `BackupManager`; archive dialogs and filesystem operations stay in
`BackupPlatform`; SQLite snapshot and restore operations run in focused Tauri
commands. No backup data is sent to a network service.

## Archive format

`.lightreader-backup` is a ZIP archive with exactly three allowed files:

```text
manifest.json
database.sqlite
metadata/
└── summary.json
```

`manifest.json` records:

- format identifier `lightreader-backup` and format version `1`;
- the current SQLite migration version;
- application version and UTC creation time;
- database byte size and SHA-256;
- counts for books, reading states, annotations, and notes;
- an explicit `bookFiles: false` flag.

`metadata/summary.json` repeats the schema version and non-sensitive row counts
so the archive metadata and native database inspection can be compared before
restore. Unknown ZIP entries, path traversal names, oversized entries, missing
files, invalid JSON, checksum mismatch, and incompatible versions are rejected.
The compressed archive is limited to 256 MiB and `database.sqlite` to 512 MiB.

## Included data

The SQLite snapshot contains book metadata, favorites and tags, global and
per-book reading settings, reading positions, highlights, annotation comments,
Tiptap note JSON/plain text, and local FTS indexes. It does not contain managed
EPUB or cover files because LightReader does not store those binaries in
SQLite. Export and import preflight verify that every book row uses the exact
application-generated path and that its managed EPUB (plus any recorded cover)
still exists on the current device; the EPUB byte size must match the database
record. A database-only backup is rejected rather than restoring broken shelf
references when those binaries are missing or changed.

## Consistent export

Export never copies the bytes of the running database file. The native command
opens a separate SQLite connection and runs `VACUUM INTO` into
`AppData/light-reader/backup/<snapshot-id>/database.sqlite`. SQLite therefore
produces a consistent standalone snapshot even when the normal SQL plugin has
an open connection. The service reads and archives that snapshot, writes only
to the path returned by the save dialog, and removes its temporary directory in
a `finally` path.

## Preflight and restore

Import uses the open dialog's runtime file scope, validates the ZIP and
manifest in TypeScript, and stages only `database.sqlite` inside the app-owned
backup directory. The native preflight then runs SQLite `integrity_check`,
checks `_sqlx_migrations`, resolves every required table/column, and recounts
the data. It also validates the managed file references before confirmation.
The UI shows the creation date and counts only after both validation layers
agree.

On explicit confirmation, the SQL plugin pool is closed and the native command
attaches the staged database read-only in practice: restore SQL contains only
fixed `SELECT` statements against it. Canonical live tables are replaced in a
single `BEGIN IMMEDIATE` transaction. Main-database triggers rebuild note and
annotation FTS rows; EPUB content index rows are copied as derived local data.
Foreign-key checks and source/destination row counts run before commit. Any
error executes `ROLLBACK`, and SQLite's journal also protects against process
interruption. The normal SQL pool is reopened whether restore succeeds or
fails.

`COMMIT` is the native success boundary. No fallible post-commit inspection is
used to report failure after data has already changed. Prepared snapshot
directories abandoned by a process crash are pruned after seven days during a
later database initialization; recent directories are left alone so another
desktop process cannot lose an active operation.

## Migration safety snapshots

The SQL plugin is intentionally not preloaded. Before the first
`Database.load`, a native command checks the current `_sqlx_migrations` version.
When an older database is present it creates and integrity-checks a `VACUUM
INTO` copy under `AppData/light-reader/migration-snapshots/`; a snapshot failure
prevents migrations from starting. The newest three upgrade snapshots are
retained so upgrades do not create unbounded runtime files.

Only exact schema version `8` and backup format version `1` are currently
accepted. Future schema support must introduce an explicit compatibility path;
it must not silently load an unknown newer backup.

## Platform permissions

No capability was broadened. Temporary files remain under the existing
`$APPDATA/light-reader/**` scope. External reads and writes are limited to paths
the user explicitly selects through the open/save dialogs. Native commands
accept only an application-generated alphanumeric/hyphen snapshot ID and never
an arbitrary filesystem path.

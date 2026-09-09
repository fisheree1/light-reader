# Data export and backup

LightReader backup is a local, versioned data-maintenance boundary. React calls
`BackupManager`; archive dialogs and filesystem operations stay in
`BackupPlatform`; SQLite snapshot and restore operations run in focused Tauri
commands. No backup data is sent to a network service.

The native implementation is split by responsibility: `backup.rs` owns command
orchestration and public data contracts, `backup/database.rs` owns SQLite
inspection/snapshot/restore transactions, `backup/assets.rs` owns managed-file
validation and rollback, and `backup/migration.rs` owns migration safety
snapshots and pruning. New backup behavior belongs in the narrowest matching
module; command handlers must not absorb database or filesystem algorithms.

## Backup modes

The settings page exposes two explicit modes:

- **Database only** stores the SQLite snapshot and metadata. It is small, but
  restoring it requires every referenced EPUB/PDF and cover to still exist at
  its managed path on the current device.
- **Full backup** additionally stores the managed EPUB/PDF and cover files. It
  is the portable option for moving a complete library to another device.

Both modes use the `.lightreader-backup` extension and backup format version
`2`.

## Archive format

Every archive contains the three required entries below. Full backups may also
contain only the asset paths declared in `manifest.json`:

```text
manifest.json
database.sqlite
metadata/
└── summary.json
assets/                         # full backup only
└── light-reader/
    ├── books/<book-id>/book.epub|book.pdf
    └── covers/<book-id>.<ext>
```

`manifest.json` records:

- format identifier `lightreader-backup` and format version `2`;
- SQLite schema version `11`;
- application version and UTC creation time;
- database byte size and SHA-256;
- counts for books, reading states, annotations, notes, bookmarks, and reading
  sessions;
- whether managed book files are included;
- for full backups, the managed path, book ID, kind, size, and SHA-256 of every
  asset.

`metadata/summary.json` repeats the schema version and non-sensitive row counts
so the archive metadata and native database inspection can be compared before
restore. Unknown ZIP entries, path traversal names, undeclared assets, invalid
JSON, checksum mismatch, and incompatible versions are rejected. The archive
is limited to 4 GiB, `database.sqlite` to 512 MiB, each asset to 2 GiB, and each
metadata entry to 128 KiB.

## Included data

The SQLite snapshot contains book metadata, favorites and tags, global and
per-book reading settings, reading positions, highlights, annotation comments,
bookmarks, reading sessions, Tiptap note JSON/plain text, and local FTS indexes.
Book files remain on disk rather than in SQLite.

The local AI chunk table is a rebuildable index. A snapshot may physically
contain those rows, but restore deliberately clears them; opening AI for the
book rebuilds the index from the restored managed file. AI chunks are never
treated as canonical user data.

Database-only export and import verify that every book row uses an exact
application-generated path and that its managed EPUB/PDF and recorded cover
still exist on the current device. The book byte size must match its database
record. A database-only backup is rejected rather than restoring broken shelf
references when those binaries are missing or changed.

Full export reads those managed assets into the archive. Full import stages the
assets under the application backup directory, validates their declared paths,
sizes and hashes, checks available capacity, and reports conflicts before the
user can confirm restore.

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
manifest in TypeScript, and stages the database and any declared assets inside
the app-owned backup directory. The native preflight then runs SQLite
`integrity_check`, checks `_sqlx_migrations`, resolves every required
table/column, and recounts canonical data. It also validates either the current
managed files (database-only mode) or staged files (full mode). The UI shows the
creation date, counts, full-backup size, and conflict count only after both
validation layers agree.

On explicit confirmation, the SQL plugin pool is closed. Canonical live tables
are replaced in one `BEGIN IMMEDIATE` transaction. Main-database triggers
rebuild note and annotation FTS rows; EPUB content-index rows are copied, while
AI chunks are cleared for an on-demand rebuild. Foreign-key checks and
source/destination row counts run before commit. Any error executes `ROLLBACK`,
and the normal SQL pool is reopened whether restore succeeds or fails.

For a full restore, backup assets replace files with the same managed paths.
The previous book and cover directories remain in a safety area until the
database transaction succeeds. If file replacement or database restore fails,
the previous directories are moved back. This is intentional backup-wins
conflict handling, and the UI reports the conflict count before confirmation.

`COMMIT` is the native success boundary. No fallible post-commit inspection is
used to report failure after data has already changed. Prepared snapshot
directories abandoned by a process crash are pruned after seven days during a
later database initialization; recent directories are retained so another
desktop process cannot lose an active operation.

## Migration safety snapshots

The SQL plugin is intentionally not preloaded. Before the first
`Database.load`, a native command checks the current `_sqlx_migrations` version.
When an older database is present it creates and integrity-checks a `VACUUM
INTO` copy under `AppData/light-reader/migration-snapshots/`; a snapshot failure
prevents migrations from starting. The newest three upgrade snapshots are
retained so upgrades do not create unbounded runtime files.

Only exact schema version `11` and backup format version `2` are currently
accepted. Future schema support must introduce an explicit compatibility path;
it must not silently load an unknown newer backup.

## Platform permissions

No broad filesystem permission is needed. Temporary files stay under the
existing `$APPDATA/light-reader/**` scope. External reads and writes are limited
to paths the user explicitly selects through the open/save dialogs. Native
commands accept only an application-generated alphanumeric/hyphen snapshot ID
and never an arbitrary filesystem path.

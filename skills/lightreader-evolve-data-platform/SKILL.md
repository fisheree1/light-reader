---
name: lightreader-evolve-data-platform
description: Evolve LightReader persistent data and Tauri platform boundaries safely. Use for SQLite schema changes, numbered migrations, Repository implementations, transactions, data validation, storage adapters, file/dialog/OS/process services, Tauri plugin registration, Rust setup, capability scopes, database health checks, or native-platform tests.
---

# Evolve data and platform capabilities

## Route the change

Read `AGENTS.md`, [data-model.md](references/data-model.md), and [tauri-platform.md](references/tauri-platform.md). Inspect `src/database`, `src/storage`, `src-tauri/migrations`, Rust plugin registration, capabilities, package versions, and `git status`.

Choose one primary boundary:

- SQL persistence: Repository plus migration.
- Binary/file operations: `StorageAdapter` implementation.
- Dialog, OS, process, or another native API: focused Service.
- Plugin availability: Rust registration plus narrowly scoped capability.

React components may call application-level methods, never Tauri or SQL bindings directly.

## Change SQLite safely

1. Identify the next unused migration number. Never edit a migration that may have run.
2. Write one focused forward migration in `src-tauri/migrations/`.
3. Register it in Rust for the exact `sqlite:light-reader.db` connection.
4. Model rows privately inside the Repository; return domain types.
5. Validate untrusted/deserialized data at the boundary with Zod when runtime validation adds value.
6. Put multi-statement invariants in a transaction.
7. Add migration and Repository tests, including empty results, constraint failures, and rollback behavior.

Store book files on disk and only stable paths, hashes, metadata, locators, and user-generated records in SQLite. Define deletion and orphan-cleanup semantics before adding file references.

## Add a platform capability

1. Prefer an already-installed official Tauri plugin.
2. If a dependency is required, align JavaScript and Rust plugin major versions and explain its footprint.
3. Register the plugin in `src-tauri/src/lib.rs`.
4. Add only the commands the Service invokes.
5. Scope filesystem and SQL permissions to exact application paths/URLs; never grant home-directory or global filesystem access.
6. Keep capability changes in the same task as the calling Service and its tests.
7. Verify denial behavior, not only the happy path.

Do not use process or shell plugins to bypass filesystem scopes. Do not broaden a wildcard because a test fixture is stored in the wrong place.

## Verify

Run the standard TypeScript gates and relevant tests. For migration, Rust, plugin, or capability changes also run:

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
```

When feasible, launch `pnpm tauri:dev` and exercise the actual Service. Report whether native UI/database behavior was directly verified or only compiled/tested.

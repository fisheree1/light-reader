# Tauri platform rules

Sources: [Tauri plugins workspace](https://github.com/tauri-apps/plugins-workspace) and its [SQL plugin](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/sql), reviewed 2026-08-01.

## Current baseline

LightReader already registers dialog, fs, log, os, process, and SQL plugins. SQLite is enabled on the Rust plugin, migrations target `sqlite:light-reader.db`, and the main-window capability scopes file access to the application's own LightReader data directory.

## Capability review

For every requested native call, record:

1. JavaScript command invoked by the Service.
2. Plugin and Rust registration that provide it.
3. Capability identifier that authorizes it.
4. Resource scope: exact SQL URL, directory, file pattern, or URL.
5. Denied paths/operations that must remain denied.

Use recursive globs only inside a dedicated application directory when recursive access is necessary. Dialog-selected files may need runtime scope handling; do not replace that design with a home-directory wildcard.

## SQL migrations

The official SQL plugin accepts ordered Rust `Migration` values and associates them with a connection string through `add_migrations`. Client `Database.load` or configured preload applies registered migrations. Keep the Rust registration and SQL file in one change.

## Version and validation

- Check current official plugin documentation before installation.
- Keep `@tauri-apps/*` and Rust `tauri-plugin-*` on compatible Tauri 2 releases.
- Do not suppress version mismatch checks.
- Compile generated capability schemas with a Tauri build; JSON formatting alone does not validate permission identifiers.

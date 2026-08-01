# LightReader contribution rules

These rules apply to the entire repository.

## Tooling and language

- Use pnpm only. Do not add npm or Yarn lockfiles.
- Keep TypeScript strict mode enabled. Do not use `any` or disable checks to hide errors.
- Use React function components and hooks.
- Do not add a large dependency without explicit task approval and a documented reason.
- Do not implement features that the active task did not request.

## Architecture

- React components must never call Tauri APIs directly.
- Persistent business data must be accessed through a Repository.
- File system, operating system, dialog, and other platform capabilities must be accessed through an Adapter or Service.
- Keep UI state in Zustand; do not mirror database business data into a global store.
- Do not store books or other large files in SQLite BLOB columns. Store files on disk and persist only metadata and stable references.
- Every database change requires a new ordered migration. Never rewrite a migration that may have shipped.
- Preserve local-first behavior and request only the minimum Tauri permissions required by the feature.

## Product quality

- Every new feature must define loading, error, and empty states where applicable.
- Every new feature or bug fix must include relevant tests.
- Keep accessible names, keyboard behavior, and focus states intact.
- Reuse the existing theme variables and `cn` utility before adding one-off styling abstractions.

## Verification

- After changes, run `pnpm typecheck` and `pnpm lint`.
- Run the tests related to the change; use `pnpm test:run` for cross-cutting changes.
- Run `pnpm build` when changing production code or build configuration.
- Run Rust/Tauri checks when changing `src-tauri`, plugin registration, migrations, or capabilities.
- Report commands actually run and never claim an unchecked result passed.

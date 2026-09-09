# Desktop release and acceptance

LightReader uses two delivery workflows:

- `.github/workflows/ci.yml` validates frontend behavior, accessibility, Rust,
  real SQLite/filesystem smoke tests, and debug Tauri compilation on macOS,
  Linux, and Windows.
- `.github/workflows/release.yml` validates a semantic version tag, repeats the
  release gates, builds each platform with the official Tauri action, and
  attaches installers to a draft GitHub release.

The release remains a draft until a maintainer completes the real desktop
checklist. Unsigned local or CI artifacts are suitable for testing, but should
not be presented as a trusted public release. Code-signing credentials are an
external release secret and are not stored in this repository.

## Create a release candidate

1. Update the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`.
2. Run `node scripts/check-release-version.mjs vX.Y.Z`.
3. Make sure CI is green and the working tree is clean.
4. Push the `vX.Y.Z` tag, or manually run “Release desktop” with that tag.
5. Download the draft installers and execute the checklist below on every
   supported operating system before publishing the GitHub release.

## Real desktop checklist

Use a disposable LightReader profile and small redistributable EPUB/PDF files.
Do not use personal reading data for release testing.

- Install and launch the packaged application; a second launch focuses the
  existing window instead of opening another database process.
- Import one EPUB and one text PDF through the native file dialog, close the
  app, reopen it, and read both files.
- Verify EPUB keyboard, wheel/trackpad and touch navigation where the target
  hardware supports it. Verify PDF scroll, page jump, selection and search.
- Create a highlight, annotation, bookmark and independent note; reopen the app
  and confirm their locators and contents persist.
- Enable local AI only when Ollama is installed. Verify connection, cancellation,
  selected-text processing and one cited book question; confirm disabling AI
  leaves reading features available.
- Export one note and one book's annotations.
- Create a database-only backup and a full backup. Restore each after changing
  local data, and confirm cancelled or invalid restores leave current data
  unchanged.
- Deny file permission once and select a missing/corrupt book once. Confirm the
  UI explains the state and still permits safe deletion.
- Switch light/dark mode, navigate the main flows using only the keyboard, and
  verify dialog focus returns to the invoking control.
- Close the application during ordinary reading and confirm the next launch has
  no stuck migration, deletion, or backup operation.

Record the operating system, architecture, installer name, application version,
and checklist result in the draft release notes. A failed item blocks publishing
unless the limitation is explicitly removed from the supported platform scope.

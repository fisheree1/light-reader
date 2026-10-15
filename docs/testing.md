# Testing and delivery

## Continuous integration

The GitHub Actions workflow runs three independent jobs:

- frontend formatting, ESLint, production build, Vitest, and coverage;
- Chromium Playwright tests, including automated accessibility checks and a
  `production` project that runs against `vite build` output;
- Cargo fmt, Clippy, Rust tests, and native smoke tests; and
- macOS, Linux, and Windows native tests plus a debug Tauri application build.

Use focused checks while developing. The full matrix is the release and pull-request gate.

## Coverage baseline

The first V8 baseline was recorded on 2026-09-02 with 46 Vitest files and 172 tests:

| Scope                      | Statements | Branches | Functions |  Lines |
| -------------------------- | ---------: | -------: | --------: | -----: |
| Selected production code   |     63.04% |   50.25% |    55.13% | 66.59% |
| Repository implementations |     47.00% |   34.86% |    41.66% | 50.37% |
| Reader engine              |     80.71% |   63.84% |    79.66% | 85.97% |
| Executable domain modules  |     98.23% |   83.33% |    95.83% | 98.09% |

Run `pnpm test:coverage` to create the text, JSON summary, and HTML reports under the ignored `coverage/` directory.

The configured thresholds deliberately sit just below this baseline:

- domain logic: 90% statements/lines, 55% branches, 60% functions;
- Repository implementations: 45% statements, 30% branches, 40% functions, 50% lines;
- reader engine: 80% statements, 60% branches, 75% functions, 85% lines.

Raise thresholds when coverage improves; do not lower them to merge a change.

## Bundle budgets

`pnpm bundle:check` creates a production build and checks the raw and gzip sizes
of the complete asset set, the initial load (the entry script plus every chunk
`dist/index.html` preloads, i.e. what loads before the first screen), the notes
chunks, PDF runtime/worker, reader page, and application CSS. The initial load
replaces earlier per-chunk limits for the "application shell" and "shared data
services": the bundler regroups shared code between those files whenever a lazy
route changes, which made the limits fail without any real startup growth. The versioned limits live in
`config/bundle-budgets.json` and run in CI immediately after the production
build. Raise a limit only with a recorded reason and a reviewed build diff.

Recorded raises:

- 2026-10-15, total gzip 970000 → 985000: the Simplified/Traditional character
  table for online discovery (about 9 KiB gzip after storing mutual pairs once)
  plus the EPUB validator. Both load only with `/discover`; the initial load
  grows by about 0.8 KiB (new Chinese interface strings).

`pnpm build:verify` (also part of `bundle:check` and CI) checks what size
budgets cannot see: no emitted chunk may import a path on the build machine
(such as `node_modules/`), and the lazy Foliate loaders for MOBI/AZW3
(`mobi`, `fflate`), FB2 (`fb2`) and CBZ (`comic-book`) must be present. The
Playwright `production` project then imports and opens FB2 and CBZ books in
the built app, because the dev server does not apply Rollup's bundling rules.

## Native acceptance

The cross-platform CI job runs the real Rust smoke suite on macOS, Linux, and
Windows. These tests use SQLite and actual filesystem operations for import,
missing/denied files, migration snapshots, deletion recovery, and database/full
backup restore. Each runner also compiles the Tauri desktop application with
`--debug --no-bundle` so platform configuration and native registration are
validated.

Automated native tests do not prove WebView interaction or installer behavior.
Before publishing a draft release, complete the target-platform workflow in
[`release.md`](release.md).

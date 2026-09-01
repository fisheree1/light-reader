---
name: lightreader-verify-efficiently
description: Apply LightReader's lightweight verification policy. Use when implementing, reviewing, or finalizing changes so routine work receives only basic checks while builds, E2E, Rust, Tauri, and full-suite checks are reserved for changes that touch those important boundaries.
---

# Verify LightReader with essential checks

## Start from the actual change

Read `AGENTS.md`, `package.json`, `git status`, and the relevant diff. Run explicitly requested checks, then select only checks that could reveal a problem caused by the changed files.

Never weaken code, types, lint rules, tests, migrations, capabilities, or production configuration to make verification pass. Never report a skipped check as successful.

## Run the basic checks

For every change:

- Run `git diff --check`.
- Check Prettier only for changed supported files.
- Run ESLint only for changed lintable files.
- Run the smallest relevant Vitest file when behavior changed.
- Run `pnpm typecheck` when production TypeScript, exported types, shared contracts, routes, or providers changed.

For documentation, comments, or Skill-only changes, stop after the applicable diff and formatting checks. Validate a changed Skill with its Skill validator. Do not run application tests or builds.

Do not run repository-wide format, lint, test, build, or E2E commands as a default handoff ritual.

## Add important checks only when needed

- Run `pnpm build` when dependencies, Vite or TypeScript configuration, workers, dynamic imports, assets, route composition, or provider composition changed.
- Run a scoped Playwright test when a critical user flow, navigation, persistence, reload behavior, or reader/editor lifecycle changed. Run all E2E tests only when the impact is broad or the user requests them.
- For SQLite, Repository, or migration changes, run the focused tests that prove migration, mapping, transaction, and persistence invariants.
- For Rust changes, run `cargo fmt --check --manifest-path src-tauri/Cargo.toml` plus focused Cargo tests. Add Clippy when Rust logic, plugin registration, or release readiness changed.
- Run `pnpm tauri build --debug --no-bundle` only when Tauri plugins, capabilities, CSP, native integration, `tauri.conf.json`, or packaging changed.
- Launch `pnpm tauri:dev` only when real desktop behavior must be observed and the environment supports it.

Load `$lightreader-evolve-data-platform`, `$lightreader-integrate-reader-engine`, or `$lightreader-integrate-notes-editor` when the change crosses that boundary.

## Reserve full verification for broad work

Run the complete applicable frontend or native verification matrix only for a release, an explicitly requested full audit, a broad refactor, or a change whose impact cannot be bounded. Untouched platforms do not need verification unless acceptance criteria require it.

## Avoid duplicate work

- `pnpm build` runs `tsc -b`; do not also run `pnpm typecheck` on the same unchanged tree.
- A Tauri build invokes the frontend build; do not run both separately on the same unchanged tree.
- Do not rerun a successful check unless relevant files changed afterward.
- After fixing a failure, rerun that check and only the checks invalidated by the fix.
- Prefer a targeted test path or Playwright grep before widening scope.

## Report briefly

List the checks actually run and their outcomes. Mention skipped high-cost checks only when the remaining risk matters or manual/native verification is still required.

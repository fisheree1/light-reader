---
name: lightreader-verify-efficiently
description: Select and run the smallest evidence-based verification set for LightReader changes. Use when implementing, reviewing, or finalizing LightReader work to avoid duplicate formatting, type, lint, test, build, E2E, Rust, and Tauri checks while preserving coverage for data, reader, platform, and release risks.
---

# Verify LightReader efficiently

## Choose evidence from the diff

Read `AGENTS.md`, `package.json`, `git status`, and the relevant diff before choosing commands. Classify the highest-risk changed boundary and run the corresponding lane below. Explicit verification commands in the active user request remain mandatory.

Do not weaken TypeScript, lint, tests, migrations, capabilities, or production configuration to make a check pass. Never report an unexecuted check as successful.

## Use the smallest sufficient lane

### Lane 0: documentation and agent instructions

Use for Markdown, comments, docs, or Skill metadata with no executable behavior change.

- Run Prettier only on changed supported files.
- Run `git diff --check`.
- For a changed Skill, run the skill validator on that Skill directory.
- Skip typecheck, lint, unit tests, builds, E2E, Cargo, and Tauri checks.

Promote out of this lane when a config file affects compilation, packaging, tests, permissions, or runtime behavior.

### Lane 1: isolated TypeScript or React change

Use for a leaf component, hook, mapper, utility, local style, or focused bug fix with an existing test seam.

- Check formatting and ESLint only for changed lintable files.
- Run `pnpm typecheck` when exported types or production TypeScript changed.
- Run the smallest relevant Vitest files with `pnpm exec vitest run <test-paths>`.
- Skip the full test suite and production build unless the change touches a shared contract, route composition, application provider, dependency, or build boundary.

### Lane 2: cross-cutting frontend feature

Use when multiple feature layers, shared contracts, routing, providers, global state, or dependencies changed.

- Run `pnpm typecheck` and `pnpm lint`.
- Run focused tests first; run `pnpm test:run` when shared behavior or several suites are affected.
- Run `pnpm build` for production bundling, router/provider composition, dependency, Vite, or TypeScript configuration changes.
- Run only the relevant Playwright spec or grep for a changed critical user flow. Run the complete E2E suite only for global navigation, shared fixtures, release validation, or broad regressions.

### Lane 3: SQLite, Repository, or native platform change

Load `$lightreader-evolve-data-platform` and verify the changed invariant directly.

- Run migration, mapper, Repository, transaction, or Adapter tests that exercise the change.
- Run TypeScript checks only when the TypeScript boundary changed.
- Run `cargo fmt --check --manifest-path src-tauri/Cargo.toml` for Rust edits.
- Run Cargo Clippy and tests for changed Rust logic or registration code.
- Do not require a Tauri build for a SQL-only migration that is covered by migration/Repository tests and whose unchanged registration still compiles.
- Run `pnpm tauri build --debug --no-bundle` when plugin dependencies, capabilities, `tauri.conf.json`, Rust/native integration, CSP, or packaging changed.
- Launch `pnpm tauri:dev` only when real native UI, filesystem, database, or permission behavior must be observed and the environment supports it.

### Lane 4: reader or editor engine boundary

Load the matching reader-engine or notes-editor Skill.

- Run focused contract, adapter, serialization, lifecycle, and UI tests.
- Run `pnpm build` when workers, dynamic imports, assets, extensions, serialization schemas, or bundling changed.
- Run a scoped E2E flow for user-visible persistence or engine lifecycle behavior.
- Add Tauri compilation only when native loading, CSP, capabilities, or desktop packaging changed.

### Lane 5: full audit or release

Run the complete applicable matrix only when the user requests it, before a release or handoff that requires it, after a broad refactor, or when the impact cannot be bounded:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
```

Omit commands for untouched platforms only when the requested acceptance criteria do not explicitly require them.

## Remove duplicate work

- Do not run `pnpm format` and then a repository-wide `pnpm format:check` on the same unchanged tree.
- `pnpm build` already runs `tsc -b`; do not run a separate `pnpm typecheck` immediately before it unless the user explicitly requires both or a distinct typecheck result must be reported.
- A Tauri build invokes the configured frontend build; do not run a separate frontend build immediately before it on the same unchanged tree.
- After a failure, rerun the failed check and checks invalidated by the fix. Preserve still-valid successful results.
- After documentation-only follow-up edits, rerun only Lane 0 checks.
- Do not rerun a green command when relevant files have not changed since it ran.
- Prefer a targeted test path or Playwright grep before widening to a whole suite.

Promote to a broader lane when dependencies, shared schemas, error models, global configuration, migrations, capabilities, or multiple consumers changed, or when no focused test demonstrates the affected behavior.

## Report clearly

Report:

- commands actually run and their outcomes;
- important warnings that did not fail a command;
- intentionally skipped high-cost checks and the risk-based reason;
- anything that still requires native or manual verification.

Do not turn a skipped check into an implied pass.

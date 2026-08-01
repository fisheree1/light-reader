---
name: lightreader-extend-feature
description: Implement, refactor, or review a scoped LightReader product feature while preserving its React, TypeScript, Tauri, local-first, accessibility, testing, and architecture rules. Use for new pages, UI flows, feature modules, hooks, Zustand UI state, services, cross-cutting refactors, or bug fixes in the light-reader repository. Also load the matching LightReader reader-engine, data-platform, or notes-editor skill when the task crosses those boundaries.
---

# Extend a LightReader feature

## Establish context

1. Locate the repository whose `package.json` name is `light-reader`.
2. Read `AGENTS.md`, `package.json`, the affected feature, its tests, and `git status` before editing.
3. Read [project-conventions.md](references/project-conventions.md).
4. Read [upstream-lessons.md](references/upstream-lessons.md) only for architectural, local-first, or accessibility decisions.
5. Load `$lightreader-integrate-reader-engine`, `$lightreader-evolve-data-platform`, or `$lightreader-integrate-notes-editor` when the task involves that domain.

## Define the slice

Write down the requested outcome, explicit non-goals, affected routes, data ownership, platform needs, and required loading/error/empty states. Do not install a deferred dependency or implement an adjacent roadmap item without explicit authorization.

Choose the narrowest boundary:

- Render and interaction state: feature component or hook.
- Cross-page UI preference: Zustand store.
- File, dialog, OS, process, or Tauri call: Adapter or Service.
- Persistent business data: Repository.
- EPUB/PDF lifecycle and navigation: `EbookReader` implementation.

Keep domain types independent from Tauri, SQL rows, Foliate JS, PDF.js, and Tiptap types.

## Implement vertically

1. Add or update domain types and boundary contracts first.
2. Implement the Adapter, Service, Repository, or reader integration behind the boundary.
3. Add the feature UI with accessible names, keyboard behavior, focus handling, and theme variables.
4. Represent loading, error, empty, and success states explicitly.
5. Add focused tests beside the changed code. Add Playwright coverage for a critical user flow.
6. Update documentation only when commands, structure, permissions, or user-visible behavior changed.

Do not call Tauri or SQL from React components. Do not put database entities into the global store. Avoid `any`, disabled checks, broad capabilities, unbounded event listeners, and hidden background errors.

## Verify proportionally

Always run:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
```

Also run `pnpm test:e2e` for user flows. For `src-tauri`, plugins, migrations, or capabilities, run `cargo fmt --check` and `pnpm tauri build --debug --no-bundle`. Report only commands actually run and preserve unrelated worktree changes.

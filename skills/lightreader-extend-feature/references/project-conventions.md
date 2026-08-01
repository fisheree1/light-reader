# LightReader project conventions

## Boundaries

| Concern                  | Owner                               | Forbidden shortcut                         |
| ------------------------ | ----------------------------------- | ------------------------------------------ |
| Page composition         | `src/features/<feature>/`           | Platform or SQL calls in JSX               |
| Reusable UI              | `src/components/`                   | Feature business logic in primitives       |
| Cross-page UI preference | `src/stores/`                       | Database collections in Zustand            |
| Persistent data          | `src/database/repositories/`        | SQL outside Repository/client layers       |
| Files and platform APIs  | `src/storage/` or a focused Service | Direct Tauri imports in components         |
| Book rendering           | `src/reader-engines/`               | Foliate/PDF.js types leaking into features |
| Native registration      | `src-tauri/src/`                    | Plugin use without capability review       |

Keep large book files on disk. SQLite stores metadata, stable file references, locators, annotations, notes, and indexes—not book BLOBs.

## UI rules

- Reuse `Button`, `IconButton`, `EmptyState`, `cn`, Radix primitives, and CSS variables.
- Preserve light and dark modes; avoid hard-coded colors when a semantic variable exists.
- Give icon-only controls accessible names.
- Restore focus after dialogs and keep all reading/navigation actions keyboard reachable.
- Treat empty, first-run, loading, offline, corrupt-file, permission-denied, and migration errors as product states.

## Testing matrix

- Domain function: unit test without React or Tauri.
- Component/hook: React Testing Library through user-visible roles and labels.
- Repository: migration-backed database test when practical; otherwise a typed database seam.
- Adapter/Service: contract test plus mocked platform binding.
- Route or critical workflow: Playwright Web test; add native verification when behavior depends on Tauri.
- Regression: fail before the fix, pass after it.

Use small, legally redistributable fixtures. Never commit user books, runtime databases, reports, secrets, or generated bundles.

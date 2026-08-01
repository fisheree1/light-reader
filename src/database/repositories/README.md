# Repository convention

Repositories are the only application-layer entry point for persistent business data. A repository may use the shared SQL client or another data source, but React components must not issue SQL or call Tauri APIs directly.

Add a repository only with its owning feature. Keep database rows private to the repository, map them to domain types at the boundary, and cover reads, writes, errors, and migrations with tests.

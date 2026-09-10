# ADR 0004: Local semantic expansion and scoped cross-book research

Status: accepted

Date: 2026-09-09

## Context

The single-book RAG baseline already has stable EPUB/PDF locators, a rebuildable
local chunk index, bounded retrieval, citations, and an Ollama provider. Users
also need to compare several imported books. The installed `deepseek-r1:8b`
model does not expose embeddings. Adding a second model and vector store would
add download size, memory pressure, a persisted format, and migration risk
before representative evaluations prove the gain.

## Decision

Add a dedicated cross-book research flow with these boundaries:

- the user explicitly selects 2–8 books for each run;
- one short local Ollama call proposes at most six bounded alternate search
  expressions; invalid output or provider failure falls back to lexical recall;
- the existing candidate retriever fuses original terms, reviewed synonym
  groups, and the bounded local-model terms;
- retrieval caps candidates per book and total prompt context;
- the capability grant and tool registry authorize exactly the selected book
  IDs; repository, SQL, and managed paths never enter the prompt;
- the final draft must cite retrieved passages, and every citation is checked
  against the current book ID and source file hash before display;
- results remain an `AiDraft` and never overwrite notes.

This is local semantic query expansion, not vector similarity search. The UI and
documentation must keep that distinction explicit.

## Consequences

- Cross-book comparison works with the model already installed by the user and
  remains offline after local model installation.
- Failure of the optional planning call degrades recall instead of blocking the
  research task.
- Sequential per-book indexing bounds peak memory use for large EPUB/PDF sets.
- Lexical retrieval still cannot recover every conceptual paraphrase. A true
  embedding route remains a replaceable future candidate retriever and requires
  a representative evaluation, package/memory budget, model license review,
  versioned vector format, rebuild strategy, and migration decision.

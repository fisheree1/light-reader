# ADR 0003: Local multi-route lexical retrieval before embeddings

Status: accepted

Date: 2026-09-09

## Context

The previous retrieval baseline used one bounded SQLite FTS/LIKE query. It was small,
predictable, and fully local, but the fixed RAG evaluation recorded a concrete
semantic recall failure: a question using “断网” could not find a passage using
“离线”. The installed `deepseek-r1:8b` model does not provide an embedding
capability, and adding another local model or vector runtime would increase the
download size, indexing time, storage format, migration surface, and desktop
build risk.

## Decision

Insert a replaceable `BookCandidateRetriever` between `BookRetrievalService`
and `BookChunkRepository`. Its first implementation performs two bounded,
independent local recall paths:

1. the normalized terms from the original question;
2. a small reviewed set of multilingual semantic expression groups for common
   reading-domain wording.

Both paths remain scoped to one book and request at most eight candidates. They
run concurrently, are deduplicated with Reciprocal Rank Fusion, and receive a
deterministic rerank score from original-term coverage, expanded-term coverage,
repository relevance, and stable ordinal tie-breaking. The existing passage
merge, context budget, locator, citation, cancellation, and source-hash checks
remain downstream and unchanged.

The expression groups are application code, not user data or model output. They
are bounded to twelve terms and cannot add file paths, SQL, tools, or arbitrary
instructions. This is a multi-route lexical/semantic-expansion baseline, not a
claim that keyword expansion is equivalent to embeddings.

The versioned RAG evaluation keeps the P1 V1 baseline and runs V2 through the
real candidate retriever against Chinese,
English, cross-chapter, no-answer, prompt-injection, synonym, EPUB, and PDF
locator cases. CI requires Recall@6 of at least 90% and 100% correctness on the
recorded no-answer cases.

## Consequences

- The known synonym case is recovered without a model download, network call,
  database migration, or vector extension.
- Direct lexical matches remain stronger than expansion-only matches, while RRF
  prevents a duplicate chunk from consuming multiple context slots.
- Search work is capped at two repository queries and sixteen pre-fusion
  candidates; final top-k and context budgets are unchanged.
- The candidate retriever can later be replaced or extended with local
  embeddings without moving vector concerns into React, the Repository contract,
  or the reader engine.
- The reviewed expression set has limited semantic coverage. A real embedding
  path remains deferred until a representative eval corpus proves a material
  gain and its package, memory, disk, licensing, and migration costs are accepted.

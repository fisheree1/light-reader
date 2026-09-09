# ADR 0002: Local keyword RAG and a constrained read-only Agent

Status: accepted

Date: 2026-09-08

## Context

LightReader needs free-form questions about the current EPUB or PDF while
remaining useful without an account or cloud service. The installed
`deepseek-r1:8b` Ollama model can stream text, but the current provider gateway
does not guarantee structured function-tool calls. The existing global search
index stores EPUB chapters for display-oriented search and cannot provide PDF
pages, bounded chunks, source hashes, or precise citations.

## Decision

Add a separate, derived `ai_book_chunks` FTS5 trigram index. A local extractor
reads EPUB spine text or PDF.js text-layer pages, a deterministic chunker assigns
stable ids and versioned locators, and retrieval is always scoped to the current
book. Index freshness is tied to the canonical book file hash. Only top passages
within fixed limits are sent to Ollama.

Use an application-owned, read-only Tool Registry as the Agent boundary. A
short-lived capability grant fixes the book id, tools, call count, result size,
total context size, and expiry. `read_passage` may only read chunk ids already
returned by `search_books`. The audit trace stores hashes and sizes rather than
book text. The only output is an isolated `AiDraft`; existing notes are never
updated by the Agent.

Until the provider advertises and validates function-tool support, the book-QA
runner uses a deterministic one-search plan before text generation. It does not
parse invented tool calls from model prose. This is intentionally a constrained
single-Agent baseline, not an autonomous multi-step research system.

## Consequences

- EPUB and text-based PDF questions work entirely on-device and can include
  citations that navigate through the existing reader locator boundary.
- Scanned PDFs require a future opt-in OCR design and currently return a clear
  unsupported state.
- Keyword retrieval is predictable and small enough to ship without an
  embedding runtime, model download, or vector database.
- Chinese and English semantic paraphrases may have lower recall than hybrid
  retrieval. Local embeddings and a reranker remain an evaluation-backed follow-up.
- Cross-book, note, annotation, network, arbitrary file, write, and delete tools
  remain out of scope.

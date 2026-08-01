---
name: lightreader-integrate-reader-engine
description: Integrate or evolve LightReader ebook rendering for EPUB, PDF, navigation, progress, selection, highlights, search, or reader lifecycle behind the EbookReader boundary. Use when adding Foliate JS, PDF.js, a reader adapter, serialized locators, renderer events, book-content security, worker configuration, or reader performance and cleanup behavior.
---

# Integrate a reader engine

## Inspect before installing

1. Read repository `AGENTS.md`, `src/reader-engines/types.ts`, storage boundaries, CSP, affected UI, and tests.
2. Confirm the active task explicitly authorizes Foliate JS or PDF.js; the project intentionally defers both dependencies.
3. Read [foliate-js.md](references/foliate-js.md) for EPUB or [pdf-js.md](references/pdf-js.md) for PDF. Re-check upstream current documentation before choosing a version or commit.
4. Load `$lightreader-extend-feature` for product UI and `$lightreader-evolve-data-platform` if locators or annotations require persistence.

## Preserve the engine boundary

Keep `EbookReader` as the feature-facing contract. Put upstream imports, custom-element types, workers, DOM ranges, canvases, and event payloads inside an engine adapter. Extend the contract only for a demonstrated cross-engine capability.

Define serialized locators as stable domain data:

- EPUB: chapter href, CFI, and progression.
- PDF: page index plus optional within-page position.
- Include a format or locator version when one shape can no longer be interpreted unambiguously.

Do not persist DOM nodes, `Range`, Blob URLs, canvas state, or upstream internal objects.

## Implement lifecycle first

1. Create and mount the engine-owned rendering host.
2. Open from `ArrayBuffer`, `Uint8Array`, Blob, or an Adapter-provided source without re-reading the file unnecessarily.
3. Translate upstream relocation events into `BookLocator` values.
4. Implement `goTo`, current-location retrieval, and idempotent `close`.
5. On close or source change, remove listeners, revoke object URLs, cancel renders, destroy workers/documents, unload sections, and detach custom elements.
6. Add selection, annotations, or search only after lifecycle and navigation tests pass.

## Enforce content security

Treat every book as untrusted input. Keep a restrictive Tauri CSP, block scripted EPUB content, avoid `allow-scripts` on book iframes, and route external links through a reviewed platform Service. Never weaken CSP merely to make a fixture render.

## Control performance

Load sections/pages lazily. Render only visible or near-visible PDF pages. Cancel obsolete work on rapid navigation. Keep progress writes debounced and monotonic. Measure large-book behavior before adding caches, and bound every cache with an eviction policy.

## Test and verify

- Contract-test open, relocate, go-to, reopen, close, corrupt input, and cleanup.
- Test locator serialization round trips and progression bounds.
- Use tiny licensed fixtures covering reflowable, fixed-layout/RTL when relevant, and malformed input.
- Verify keyboard navigation, focus, resize, light/dark presentation, and no leaked listeners/workers.
- Run the standard project gates, relevant E2E, and Tauri debug build when CSP or native loading changes.

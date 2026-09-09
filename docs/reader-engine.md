# EPUB and PDF reader engines

LightReader integrates [Foliate JS](https://github.com/johnfactotum/foliate-js)
at commit `78914aef4466eb960965702401634c2cb348e9b1`. The upstream project does not
publish a stable API, so upgrades must change the pinned commit deliberately and
rerun adapter, E2E and Tauri checks.

## Boundaries

```text
ReaderPage / useReader
  -> EbookReader
     -> FoliateEbookReader (EPUB)
     -> PdfEbookReader (PDF.js)
  -> ReaderBookSource
     -> TauriBookFileStorage (AppData)
  -> BookRepository
  -> ReaderSettingsRepository
     -> SQLite (desktop) / localStorage test adapter (Web)
  -> AnnotationService
     -> AnnotationRepository
     -> EbookReader highlight operations
  -> NoteService
     -> NoteRepository
```

React does not import Foliate, PDF.js or Tauri modules. Custom elements,
workers, upstream event payloads, Blob/File objects, canvases, text layers and
renderer cleanup stay inside their engine adapter. Tauri reads only the managed
relative path already validated on the `Book` domain object.

The browser test runtime uses the same Foliate adapter with a minimal EPUB
generated from LightReader-owned text. Only its source adapter is mocked.

## Locator model

Reader positions are JSON-safe domain values:

```ts
type BookLocator =
  | {
      version: 1;
      format: 'epub';
      chapterHref?: string;
      cfi?: string;
      progression?: number;
    }
  | {
      version: 1;
      format: 'pdf';
      pageIndex: number; // zero based
      withinPageProgression?: number;
      textRange?: { start: number; end: number };
      progression?: number;
    };
```

Foliate `relocate` details are validated and converted before leaving the
adapter. DOM `Range`, section objects and upstream progress objects are not
exposed or persisted. The current locator stays in local React state for
rendering and is written to `reading_states` through `ReaderSettingsRepository`.
Writes are debounced by 600 ms, the final pending value is flushed on teardown,
and a saved locator is restored before relocation persistence is subscribed.
This prevents the renderer's initial relocation from overwriting a saved value.

## PDF.js adapter

`pdfjs-dist` is pinned in the package lock. Its main API is loaded only when a
PDF reader opens, and the matching worker is emitted as a Vite-managed local
asset. The adapter resolves that asset to an absolute URL before PDF.js creates
and owns the worker. It does not construct a second `PDFWorker`, so the worker
and document loading task cannot drift into separate lifecycles. Close and rapid
book switching cancel page/text-layer work, release page resources and destroy
the loading task. Recoverable PDF structure warnings use PDF.js's tolerant
parsing path instead of rejecting an otherwise readable file. Text extraction
consumes `streamTextContent()` through `ReadableStream.getReader()` rather than
PDF.js's async-iterator convenience method, because the macOS Tauri WebView does
not consistently expose `ReadableStream[Symbol.asyncIterator]`.

The adapter creates lightweight placeholders for every page but renders only
the current page and its immediate neighbors. It retains at most five rendered
pages, caps canvas dimensions and total pixels, and keeps extracted text in a
32-page LRU. The 2000-page performance contract verifies that initial parsing
and canvas creation remain bounded instead of scaling with total page count.

PDF.js text-layer DOM remains private. Selection is converted to normalized
page character offsets; saved highlights and search results use those offsets
with the page locator. PDF search scans extracted text and paints result ranges
through the same overlay without persisting viewport coordinates.

## Reading appearance

`EbookReader.applyDisplaySettings()` accepts engine-neutral light, sepia and dark
themes plus font size, line height, content width and margin. The Foliate adapter
is the only layer that translates these values into paginator attributes and
book-document CSS.

Migration `0003_reader_settings.sql` adds:

- `reader_settings`: one validated global preference row;
- `book_reader_settings`: nullable per-property overrides keyed by book;
- `reading_states`: versioned locator JSON keyed by book.

The effective value is `global + per-book override`. SQLite remains the source
of truth; Zustand holds only the currently open book's resolved UI state. Book
overrides and positions cascade when their book is removed.

## Highlights and annotation comments

The engine contract exposes only `ReaderTextSelection`, `ReaderHighlight`, and
versioned `BookLocator` values. Selection DOM ranges, Foliate section indexes,
Overlayer instances, and SVG nodes remain private to `FoliateEbookReader`.

The adapter listens to selection changes in loaded EPUB documents, converts the
range to CFI, captures bounded text context, and delegates drawing to Foliate's
public `Overlayer.highlight`. It also maps overlay clicks back to application
annotation IDs. Highlight drawing supports the four validated colors plus hover
and pressed feedback.

`AnnotationService` coordinates the engine and `AnnotationRepository`:

- create: render the selected range, persist it, and remove the transient render
  if persistence fails;
- restore: load annotations, attempt each CFI independently, and retain rows that
  can no longer be resolved;
- delete: remove the render and database row, with a best-effort render rollback
  if persistence fails;
- comments: normalize and persist plain text on the existing annotation row.

Migration `0004_annotations.sql` creates `annotations`; immutable migration
`0005_annotation_notes.sql` adds `note_text`. No DOM selector, page number,
Foliate object, or book content BLOB is persisted.

An Annotation can create an independent note containing a `BookQuoteNode`
snapshot. Clicking that node routes back with its versioned locator. The reader
opens the locator even when the source Annotation has since been deleted; when
the Annotation still exists, the restored highlight is activated as well.

## Lifecycle and navigation

1. Resolve the `Book` through `BookRepository`.
2. Read its managed EPUB or PDF once through `ReaderBookSource`.
3. Load global settings, the optional book override and saved locator.
4. Mount the format-specific reader, open the book Blob and apply supported
   appearance settings.
5. Restore the saved locator and map the EPUB TOC into nested `ReaderTocItem` values.
6. Load annotations and restore each highlight without failing the reading session.
7. Translate later relocation events into locators and debounce persistence.
8. Navigate using CFI first, then chapter href, then total progression.
9. Inside each loaded EPUB document, accumulate wheel/trackpad deltas into one
   throttled page action and map horizontal touch swipes to previous/next. Links,
   buttons, form fields, editable content, pinch zoom and active text selection
   are not hijacked.
10. On source change or unmount, remove selection/overlay/navigation listeners,
    unload sections, close the renderer and detach the custom element. `close()`
    is idempotent. Each React session owns a nested host, and the adapter uses a
    lifecycle generation token so a delayed open from a rapidly abandoned book
    cannot mount over the current book.

Vite excludes Foliate's dormant PDF, MOBI, FB2, CBZ, search and TTS dynamic
modules. PDF support comes from the independent PDF.js adapter; fixed-layout
EPUB and the EPUB ZIP loader stay available.

## Content security

EPUB content is untrusted. External-link events are cancelled by the adapter,
and Tauri now enables a restrictive CSP:

- scripts: application `'self'` only; no `blob:`, remote or inline book scripts;
- frames, images, fonts, media and styles: the minimum Blob/data sources required
  for EPUB resources;
- objects and base URL changes: disabled;
- IPC connections: Tauri local IPC only.

Do not add `blob:` or `'unsafe-inline'` to `script-src`, enable scripted EPUBs,
or relax CSP for a fixture.

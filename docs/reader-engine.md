# EPUB reader engine

LightReader integrates [Foliate JS](https://github.com/johnfactotum/foliate-js)
at commit `78914aef4466eb960965702401634c2cb348e9b1`. The upstream project does not
publish a stable API, so upgrades must change the pinned commit deliberately and
rerun adapter, E2E and Tauri checks.

## Boundaries

```text
ReaderPage / useReader
  -> EbookReader
     -> FoliateEbookReader
  -> ReaderBookSource
     -> TauriBookFileStorage (AppData)
  -> BookRepository
```

React does not import Foliate or Tauri modules. Custom elements, upstream event
payloads, Blob/File objects and renderer cleanup stay inside
`FoliateEbookReader`. Tauri reads only the managed relative path already
validated on the `Book` domain object.

The browser test runtime uses the same Foliate adapter with a minimal EPUB
generated from LightReader-owned text. Only its source adapter is mocked.

## Locator model

Reader positions are JSON-safe domain values:

```ts
interface BookLocator {
  version: 1;
  format: 'epub';
  chapterHref?: string;
  cfi?: string;
  progression?: number; // inclusive 0..1
}
```

Foliate `relocate` details are validated and converted before leaving the
adapter. DOM `Range`, section objects and upstream progress objects are not
exposed or persisted. This slice keeps the current locator in local React state;
database persistence is intentionally deferred.

## Lifecycle and navigation

1. Resolve the `Book` through `BookRepository`.
2. Read its managed EPUB once through `ReaderBookSource`.
3. Mount one `foliate-view`, open the EPUB Blob and move to body text.
4. Map the EPUB TOC into nested `ReaderTocItem` values.
5. Translate relocation events into locators.
6. Navigate using CFI first, then chapter href, then total progression.
7. On source change or unmount, remove listeners, unload sections, close the
   renderer and detach the custom element. `close()` is idempotent.

Vite excludes Foliate's dormant PDF, MOBI, FB2, CBZ, search and TTS dynamic
modules from this EPUB-only build. Fixed-layout EPUB and the EPUB ZIP loader stay
available.

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

# Foliate JS integration notes

Source: [johnfactotum/foliate-js](https://github.com/johnfactotum/foliate-js), reviewed 2026-08-01.

## Upstream facts that affect LightReader

- Foliate JS is pure JavaScript, native ES modules, modular, and has no stable release/API guarantee. Upstream recommends a Git submodule because updates can break consumers.
- `view.js` provides the high-level `foliate-view` custom element. The demo reader UI is not the library and should not be embedded as LightReader architecture.
- Book loaders and renderers are separate interfaces. EPUB uses `epub.js`/`epubcfi.js`; reflowable layout uses `paginator.js`; fixed layout uses `fixed-layout.js`.
- Navigation emits `relocate`; EPUB destinations may be hrefs, section indices, or CFIs.
- `overlayer.js` supports annotation drawing; `progress.js` and `search.js` are separate modules.
- ZIP loading is adapter-based. Upstream recommends zip.js for random access and HTTP ranges; evaluate size and licensing before adding it.
- Scripted EPUB content is intentionally unsupported. Upstream states CSP is imperative because same-origin Blob URLs and WebKit behavior make iframe sandboxing insufficient.

## LightReader rules

- Pin an audited commit and record its provenance. Do not track an unpinned branch.
- Wrap the custom element and event types inside one engine module.
- Convert `relocate` details into stable `BookLocator` values before leaving the adapter.
- Keep CFI generation filters stable when injecting highlight/selection nodes, or existing locators may drift.
- Unload sections and revoke Blob URLs on close.
- Do not enable scripted EPUBs or relax CSP.

Prototype the smallest path: open one EPUB, relocate, restore CFI, close cleanly. Add highlights/search only in separate scoped tasks.

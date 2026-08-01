# PDF.js integration notes

Sources: [mozilla/pdf.js](https://github.com/mozilla/pdf.js), [setup guidance](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website), and [FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions), reviewed 2026-08-01.

## Architecture

Use the published `pdfjs-dist` package unless the task explicitly requires building upstream. Keep these concerns separate:

1. Document loading and worker configuration.
2. Page viewport, canvas rendering, text layer, and optional annotation layer.
3. LightReader UI, navigation, persistence, and reader settings.

Do not copy the generic viewer unchanged. LightReader should own its reader UI and expose PDF.js through `EbookReader`.

## Worker and version rules

- Configure the worker as a Vite-managed module asset; do not fetch it from a CDN in this local-first app.
- Keep API and worker versions identical.
- Destroy the loading task/document and cancel render tasks during close or source replacement.

## Performance and data

- Pass raw binary data as `Uint8Array`; avoid base64 because it adds memory overhead.
- Render only visible or near-visible pages. Upstream warns that retaining canvases for all pages consumes substantial memory.
- Bound zoom resolution and canvas dimensions.
- Persist page index and a stable within-page position, never viewport DOM or canvas coordinates alone.
- Add a text layer only when selection/search/accessibility requires it; test its alignment at multiple zoom levels.

Test password-protected, malformed, large-page, rotated, and textless PDFs only when those behaviors enter scope.

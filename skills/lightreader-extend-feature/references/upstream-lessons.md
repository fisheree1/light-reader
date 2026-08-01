# Upstream architecture lessons

Use these repositories for design research, not as code to copy. Review licenses before deriving implementation details.

- [Readest](https://github.com/readest/readest) is a close Tauri 2 ebook-reader reference that combines Foliate JS and PDF.js. Learn from its separation of cross-platform app concerns and reader capabilities, but keep LightReader's Vite/React structure and explicit boundaries.
- [Foliate JS](https://github.com/johnfactotum/foliate-js) separates book loaders, renderers, annotations, progress, and search behind interfaces. Preserve the same replaceability through LightReader's `EbookReader` contract.
- [PDF.js](https://github.com/mozilla/pdf.js) separates parsing, display/rendering, and viewer UI. Do not couple LightReader domain state to canvas/viewer internals.
- [Tiptap](https://github.com/ueberdosis/tiptap) is headless and extension-driven. Keep editor state, persistence, and toolbar UI separate.
- [Thorium Web](https://github.com/edrlab/thorium-web) and its accessibility work are reminders that keyboard navigation, screen-reader semantics, focus, reading order, and display preferences are core reader requirements.
- [Koodo Reader](https://github.com/koodo-reader/koodo-reader) demonstrates broad local-first reading workflows and export/sync boundaries. Its AGPL license requires care: do not copy its implementation into LightReader unless the project's licensing decision explicitly permits it.

Research date: 2026-08-01. Re-check upstream documentation and versions before adding dependencies because these projects evolve independently.

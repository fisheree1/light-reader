# Tiptap integration notes

Source: [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap), reviewed 2026-08-01.

Tiptap is a headless, framework-agnostic editor built on ProseMirror and configured through extensions. LightReader therefore owns the complete toolbar, dialogs, styles, accessibility behavior, persistence, and error handling.

## Rules

- Keep all official `@tiptap/*` packages on the same exact compatible version.
- Define the extension list in one module and treat it as the persisted document schema.
- Give every extension a product requirement; do not enable a large starter set without reviewing its nodes/marks.
- Prefer commands and JSON over manipulating editor DOM.
- Destroy the editor and subscriptions during unmount.
- Avoid re-creating the editor for ordinary prop changes.
- Review server-rendering guidance only if the app architecture later adds SSR; current Vite/Tauri rendering is client-side.

## Content safety

Tiptap's schema limits document structure but does not make arbitrary imported HTML or URLs trustworthy. Sanitize imports, reject unsafe URL protocols, avoid executable embeds, and render exported HTML under a suitable CSP.

## Dependency review

Before adding an official, community, or paid extension, verify current documentation, license, version compatibility, serialized node/mark output, keyboard behavior, bundle impact, and degradation when the extension is removed.

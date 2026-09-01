import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const unsupportedFoliateLoaders = new Set([
  './comic-book.js',
  './fb2.js',
  './mobi.js',
  './pdf.js',
  './search.js',
  './tts.js',
  './vendor/fflate.js',
]);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      // Foliate's high-level view can load several formats dynamically. This
      // slice supports EPUB navigation only, so do not ship dormant format,
      // search, or TTS modules that cannot be reached from the product UI.
      external: (id, importer) =>
        Boolean(
          importer?.includes('/foliate-js/view.js') &&
          unsupportedFoliateLoaders.has(id),
        ),
    },
  },
  server: {
    // Playwright captures page errors and targeted console warnings directly.
    // Disable Vite 8's agent-only forwarding, which otherwise promotes
    // Chromium's benign Foliate ResizeObserver diagnostic to a server error.
    forwardConsole: false,
    strictPort: true,
  },
});

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// PDF books use PdfEbookReader and read-aloud uses speechSynthesis, so these
// Foliate loaders are unreachable. The MOBI/AZW3, FB2 and CBZ loaders (and the
// fflate build MOBI needs) are used and must stay in the bundle.
const unsupportedFoliateLoaders = new Set(['./pdf.js', './tts.js']);
const unsupportedFoliateLoader = '\0lightreader-unsupported-foliate-loader';

/**
 * Replaces unreachable Foliate loaders with a module that rejects when loaded.
 * Marking them external instead would emit import paths into the build
 * machine's node_modules, which do not exist in the packaged app.
 */
function omitUnsupportedFoliateLoaders(): Plugin {
  return {
    name: 'lightreader-omit-unsupported-foliate-loaders',
    enforce: 'pre',
    resolveId(id, importer) {
      return importer?.includes('/foliate-js/view.js') &&
        unsupportedFoliateLoaders.has(id)
        ? unsupportedFoliateLoader
        : null;
    },
    load(id) {
      return id === unsupportedFoliateLoader
        ? "throw new Error('This Foliate loader is not bundled in LightReader.');"
        : null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), omitUnsupportedFoliateLoaders()],
  clearScreen: false,
  server: {
    // Playwright captures page errors and targeted console warnings directly.
    // Disable Vite 8's agent-only forwarding, which otherwise promotes
    // Chromium's benign Foliate ResizeObserver diagnostic to a server error.
    forwardConsole: false,
    strictPort: true,
  },
});

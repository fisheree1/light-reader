import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

import { AppError } from '../lib/app-error';
import {
  pdfBookLocatorSchema,
  type BookLocator,
  type EbookReader,
  type HighlightActivationListener,
  type HighlightRestoreResult,
  type ReaderDisplayOptions,
  type ReaderHighlight,
  type ReaderSearchResult,
  type ReaderTextSelection,
  type ReaderTocItem,
  type RelocationListener,
  type SelectionListener,
} from './types';
import {
  clamp,
  createPdfPageShells,
  drawPdfPageOverlays,
  loadPdfJsRuntime,
  normalizedPageText,
  pdfRenderLimits,
  readPdfSelection,
  readPageTextContent,
  type PdfJsRuntime,
  type PdfJsRuntimeLoader,
  type RenderedPage,
} from './pdf-reader-support';

/**
 * PDF.js adapter. PDF.js workers, pages, canvases and text-layer DOM never
 * escape this class; the feature layer only sees versioned locators.
 */
export class PdfEbookReader implements EbookReader {
  private readonly highlightActivationListeners =
    new Set<HighlightActivationListener>();
  private readonly highlights = new Map<string, ReaderHighlight>();
  private readonly listeners = new Set<RelocationListener>();
  private readonly loadRuntime: PdfJsRuntimeLoader;
  private readonly renderedPages = new Map<number, RenderedPage>();
  private readonly renderingPages = new Map<number, Promise<void>>();
  private readonly searchRanges = new Map<
    number,
    { start: number; end: number }[]
  >();
  private readonly selectionListeners = new Set<SelectionListener>();
  private readonly textCache = new Map<number, string>();
  private currentLocator: BookLocator = {
    version: 1,
    format: 'pdf',
    pageIndex: 0,
    progression: 0,
  };
  private document: PDFDocumentProxy | null = null;
  private host: HTMLElement | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private lastSelection: ReaderTextSelection | null = null;
  private lifecycleVersion = 0;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pageShells: HTMLElement[] = [];
  private runtime: PdfJsRuntime | null = null;
  private scroller: HTMLElement | null = null;
  private scrollFrame: number | null = null;
  private settings: ReaderDisplayOptions = {
    contentWidth: 720,
    fontFamily: 'publisher',
    fontSize: 18,
    fontWeight: 400,
    lineHeight: 1.6,
    margin: 32,
    theme: 'light',
  };
  constructor(loadRuntime: PdfJsRuntimeLoader = loadPdfJsRuntime) {
    this.loadRuntime = loadRuntime;
  }

  mount(host: HTMLElement): void {
    if (this.document || this.loadingTask) {
      throw new AppError('READER_OPEN_FAILED');
    }
    this.host = host;
  }

  async open(source: ArrayBuffer): Promise<void> {
    if (!this.host || source.byteLength === 0) {
      throw new AppError('READER_OPEN_FAILED');
    }
    await this.close();
    const lifecycleVersion = this.lifecycleVersion;
    try {
      const runtime = await this.loadRuntime();
      if (lifecycleVersion !== this.lifecycleVersion) return;
      runtime.GlobalWorkerOptions.workerSrc = new URL(
        pdfWorkerUrl,
        window.location.href,
      ).href;
      this.runtime = runtime;
      const document = await this.loadDocument(runtime, source);
      if (lifecycleVersion !== this.lifecycleVersion) {
        await document.cleanup();
        await this.close();
        return;
      }
      if (document.numPages < 1) throw new Error('PDF has no pages.');
      this.document = document;
      await this.createPageShells(document);
      this.installListeners();
      await this.renderWindow(0);
      this.updateLocator(0, 0, false);
    } catch (error) {
      if (lifecycleVersion === this.lifecycleVersion) await this.close();
      throw new AppError('READER_OPEN_FAILED', { cause: error });
    }
  }

  applyDisplaySettings(settings: ReaderDisplayOptions): void {
    this.settings = settings;
    const scroller = this.scroller;
    if (!scroller) return;
    const background =
      settings.theme === 'dark'
        ? '#171717'
        : settings.theme === 'sepia'
          ? '#e9dfc8'
          : '#e5e7eb';
    scroller.style.background = background;
    for (const shell of this.pageShells) {
      shell.style.maxWidth = `${String(settings.contentWidth)}px`;
      shell.style.marginBlock = `${String(Math.max(8, settings.margin / 2))}px`;
    }
    void this.rerenderActivePages();
  }

  getTableOfContents(): ReaderTocItem[] {
    return [];
  }

  async goTo(value: BookLocator): Promise<void> {
    const locator = pdfBookLocatorSchema.parse(value);
    const document = this.requireDocument();
    if (locator.pageIndex >= document.numPages) {
      throw new AppError('READER_NAVIGATION_FAILED');
    }
    await this.renderWindow(locator.pageIndex);
    const shell = this.pageShells[locator.pageIndex];
    if (this.scroller) {
      this.scroller.scrollTop =
        shell.offsetTop +
        shell.offsetHeight * (locator.withinPageProgression ?? 0);
    }
    this.updateLocator(
      locator.pageIndex,
      locator.withinPageProgression ?? 0,
      true,
      locator.textRange,
    );
    this.drawPageOverlays(locator.pageIndex);
  }

  previousPage(): Promise<void> {
    const pageIndex =
      this.currentLocator.format === 'pdf' ? this.currentLocator.pageIndex : 0;
    return this.goTo({
      version: 1,
      format: 'pdf',
      pageIndex: Math.max(0, pageIndex - 1),
    });
  }

  nextPage(): Promise<void> {
    const document = this.requireDocument();
    const pageIndex =
      this.currentLocator.format === 'pdf' ? this.currentLocator.pageIndex : 0;
    return this.goTo({
      version: 1,
      format: 'pdf',
      pageIndex: Math.min(document.numPages - 1, pageIndex + 1),
    });
  }

  async search(query: string): Promise<ReaderSearchResult[]> {
    const normalized = query.trim();
    this.clearSearch();
    if (!normalized) return [];
    const document = this.requireDocument();
    const needle = normalized.toLocaleLowerCase();
    const results: ReaderSearchResult[] = [];
    try {
      for (
        let pageIndex = 0;
        pageIndex < document.numPages &&
        results.length < pdfRenderLimits.searchResults;
        pageIndex += 1
      ) {
        const text = await this.getPageText(pageIndex);
        const haystack = text.toLocaleLowerCase();
        let start = 0;
        while (
          start < haystack.length &&
          results.length < pdfRenderLimits.searchResults
        ) {
          const matchStart = haystack.indexOf(needle, start);
          if (matchStart < 0) break;
          const end = matchStart + normalized.length;
          const ranges = this.searchRanges.get(pageIndex) ?? [];
          ranges.push({ start: matchStart, end });
          this.searchRanges.set(pageIndex, ranges);
          results.push({
            excerpt: {
              pre: text.slice(Math.max(0, matchStart - 48), matchStart),
              match: text.slice(matchStart, end),
              post: text.slice(end, end + 48),
            },
            locator: {
              version: 1,
              format: 'pdf',
              pageIndex,
              textRange: { start: matchStart, end },
              progression:
                document.numPages === 1
                  ? 1
                  : pageIndex / (document.numPages - 1),
            },
          });
          start = end;
        }
      }
      for (const pageIndex of this.renderedPages.keys()) {
        this.drawPageOverlays(pageIndex);
      }
      return results;
    } catch (error) {
      throw new AppError('READER_NAVIGATION_FAILED', { cause: error });
    }
  }

  clearSearch(): void {
    this.searchRanges.clear();
    for (const pageIndex of this.renderedPages.keys()) {
      this.drawPageOverlays(pageIndex);
    }
  }

  getCurrentLocator(): Promise<BookLocator> {
    return Promise.resolve(structuredClone(this.currentLocator));
  }

  subscribeToRelocation(listener: RelocationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSelection(): ReaderTextSelection | null {
    return this.lastSelection ? structuredClone(this.lastSelection) : null;
  }

  subscribeToSelection(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  createHighlight(highlight: ReaderHighlight): Promise<void> {
    try {
      const locator = this.requireHighlightLocator(highlight);
      this.highlights.set(highlight.id, structuredClone(highlight));
      if (this.renderedPages.has(locator.pageIndex)) {
        this.drawPageOverlays(locator.pageIndex);
      }
      this.host?.ownerDocument.getSelection()?.removeAllRanges();
      this.setSelection(null);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new AppError('ANNOTATION_RENDER_FAILED', { cause: error }),
      );
    }
  }

  removeHighlight(id: string): Promise<void> {
    const highlight = this.highlights.get(id);
    this.highlights.delete(id);
    if (highlight?.locator.format === 'pdf') {
      this.drawPageOverlays(highlight.locator.pageIndex);
    }
    return Promise.resolve();
  }

  restoreHighlights(
    highlights: ReaderHighlight[],
  ): Promise<HighlightRestoreResult[]> {
    this.highlights.clear();
    const document = this.requireDocument();
    const results = highlights.map((highlight): HighlightRestoreResult => {
      try {
        const locator = this.requireHighlightLocator(highlight);
        if (locator.pageIndex >= document.numPages) throw new Error();
        this.highlights.set(highlight.id, structuredClone(highlight));
        return { id: highlight.id, status: 'restored' };
      } catch {
        return { id: highlight.id, status: 'unresolved' };
      }
    });
    for (const pageIndex of this.renderedPages.keys()) {
      this.drawPageOverlays(pageIndex);
    }
    return Promise.resolve(results);
  }

  async showHighlight(id: string): Promise<void> {
    const highlight = this.highlights.get(id);
    if (!highlight) throw new AppError('ANNOTATION_NOT_FOUND');
    const locator = this.requireHighlightLocator(highlight);
    await this.goTo(locator);
  }

  subscribeToHighlightActivation(
    listener: HighlightActivationListener,
  ): () => void {
    this.highlightActivationListeners.add(listener);
    return () => this.highlightActivationListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.lifecycleVersion += 1;
    this.uninstallListeners();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    for (const pageIndex of [...this.renderedPages.keys()]) {
      this.releasePage(pageIndex);
    }
    const document = this.document;
    const loadingTask = this.loadingTask;
    this.document = null;
    this.loadingTask = null;
    this.runtime = null;
    await document?.cleanup().catch(() => undefined);
    await loadingTask?.destroy().catch(() => undefined);
    this.pageShells = [];
    this.renderingPages.clear();
    this.scroller?.remove();
    this.scroller = null;
    this.host?.replaceChildren();
    this.textCache.clear();
    this.searchRanges.clear();
    this.highlights.clear();
    this.currentLocator = {
      version: 1,
      format: 'pdf',
      pageIndex: 0,
      progression: 0,
    };
    this.setSelection(null);
  }

  private async loadDocument(
    runtime: PdfJsRuntime,
    source: ArrayBuffer,
  ): Promise<PDFDocumentProxy> {
    const task = runtime.getDocument({
      data: Uint8Array.from(new Uint8Array(source)),
      maxImageSize: pdfRenderLimits.canvasPixels,
      stopAtErrors: false,
    });
    this.loadingTask = task;
    return task.promise;
  }

  private async createPageShells(document: PDFDocumentProxy): Promise<void> {
    const host = this.host;
    if (!host) throw new AppError('READER_OPEN_FAILED');
    const result = await createPdfPageShells(
      host,
      document,
      this.settings.contentWidth,
    );
    this.pageShells = result.pageShells;
    this.scroller = result.scroller;
  }

  private installListeners(): void {
    const scroller = this.scroller;
    const host = this.host;
    if (!scroller || !host) return;
    scroller.addEventListener('scroll', this.handleScroll, { passive: true });
    host.addEventListener('pointerup', this.handleSelection);
    host.addEventListener('keyup', this.handleSelection);
    host.ownerDocument.addEventListener(
      'selectionchange',
      this.handleSelection,
    );
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const pageIndex = Number(
              (entry.target as HTMLElement).dataset.pdfPageIndex,
            );
            if (Number.isInteger(pageIndex)) {
              void this.renderWindow(pageIndex);
            }
          }
        },
        { root: scroller, rootMargin: '100% 0px' },
      );
      for (const shell of this.pageShells) {
        this.intersectionObserver.observe(shell);
      }
    }
  }

  private uninstallListeners(): void {
    this.scroller?.removeEventListener('scroll', this.handleScroll);
    this.host?.removeEventListener('pointerup', this.handleSelection);
    this.host?.removeEventListener('keyup', this.handleSelection);
    this.host?.ownerDocument.removeEventListener(
      'selectionchange',
      this.handleSelection,
    );
    if (this.scrollFrame !== null) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }
  }

  private readonly handleScroll = () => {
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      const scroller = this.scroller;
      if (!scroller || this.pageShells.length === 0) return;
      const top = scroller.scrollTop;
      let pageIndex = 0;
      let distance = Number.POSITIVE_INFINITY;
      for (const [index, shell] of this.pageShells.entries()) {
        const nextDistance = Math.abs(shell.offsetTop - top);
        if (nextDistance < distance) {
          distance = nextDistance;
          pageIndex = index;
        }
      }
      const shell = this.pageShells[pageIndex];
      const withinPageProgression = clamp(
        (top - shell.offsetTop) / Math.max(1, shell.offsetHeight),
        0,
        1,
      );
      this.updateLocator(pageIndex, withinPageProgression, true);
      void this.renderWindow(pageIndex);
    });
  };

  private readonly handleSelection = () => {
    const host = this.host;
    if (!host) return;
    const document = this.requireDocument();
    this.setSelection(
      readPdfSelection(host, this.textCache, document.numPages),
    );
  };

  private async renderWindow(center: number): Promise<void> {
    const document = this.requireDocument();
    const start = Math.max(0, center - 1);
    const end = Math.min(document.numPages - 1, center + 1);
    await Promise.all(
      Array.from({ length: end - start + 1 }, (_, offset) =>
        this.renderPage(start + offset),
      ),
    );
    const retained = [...this.renderedPages.keys()]
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, pdfRenderLimits.activePages);
    const retainedSet = new Set(retained);
    for (const pageIndex of [...this.renderedPages.keys()]) {
      if (!retainedSet.has(pageIndex)) this.releasePage(pageIndex);
    }
  }

  private renderPage(pageIndex: number): Promise<void> {
    if (this.renderedPages.has(pageIndex)) return Promise.resolve();
    const pending = this.renderingPages.get(pageIndex);
    if (pending) return pending;
    const rendering = this.performRenderPage(pageIndex).finally(() => {
      if (this.renderingPages.get(pageIndex) === rendering) {
        this.renderingPages.delete(pageIndex);
      }
    });
    this.renderingPages.set(pageIndex, rendering);
    return rendering;
  }

  private async performRenderPage(pageIndex: number): Promise<void> {
    const document = this.requireDocument();
    const runtime = this.runtime;
    const shell = this.pageShells[pageIndex];
    if (!runtime) return;
    const lifecycleVersion = this.lifecycleVersion;
    const page = await document.getPage(pageIndex + 1);
    if (lifecycleVersion !== this.lifecycleVersion) {
      page.cleanup();
      return;
    }
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(
      320,
      (this.scroller?.clientWidth ?? this.settings.contentWidth) -
        this.settings.margin * 2,
    );
    const cssWidth = Math.min(this.settings.contentWidth, availableWidth);
    const viewport = page.getViewport({ scale: cssWidth / baseViewport.width });
    shell.style.aspectRatio = 'auto';
    shell.style.width = `${String(viewport.width)}px`;
    shell.style.height = `${String(viewport.height)}px`;
    shell.style.setProperty('--total-scale-factor', String(viewport.scale));
    const canvas = shell.ownerDocument.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    const context = canvas.getContext('2d');
    if (!context) {
      page.cleanup();
      throw new Error('Canvas 2D rendering is unavailable.');
    }
    const deviceScale = Math.max(1, window.devicePixelRatio || 1);
    const outputScale = Math.max(
      Number.EPSILON,
      Math.min(
        deviceScale,
        pdfRenderLimits.canvasDimension / viewport.width,
        pdfRenderLimits.canvasDimension / viewport.height,
        Math.sqrt(
          pdfRenderLimits.canvasPixels / (viewport.width * viewport.height),
        ),
      ),
    );
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${String(viewport.width)}px`;
    canvas.style.height = `${String(viewport.height)}px`;
    const textLayerElement = shell.ownerDocument.createElement('div');
    textLayerElement.className = 'textLayer';
    const overlay = shell.ownerDocument.createElement('div');
    overlay.className = 'pdf-page-overlay';
    shell.replaceChildren(canvas, textLayerElement, overlay);
    const renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      ...(outputScale === 1
        ? {}
        : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
    });
    const entry: RenderedPage = { page, renderTask, textLayer: null };
    this.renderedPages.set(pageIndex, entry);
    try {
      const [, textContent] = await Promise.all([
        renderTask.promise,
        readPageTextContent(page),
      ]);
      if (lifecycleVersion !== this.lifecycleVersion) return;
      this.cachePageText(pageIndex, normalizedPageText(textContent));
      const textLayer = new runtime.TextLayer({
        container: textLayerElement,
        textContentSource: textContent,
        viewport,
      });
      entry.textLayer = textLayer;
      await textLayer.render();
      entry.renderTask = null;
      if (lifecycleVersion === this.lifecycleVersion) {
        this.drawPageOverlays(pageIndex);
      }
    } catch (error) {
      if (this.renderedPages.get(pageIndex) === entry) {
        this.releasePage(pageIndex);
      }
      if (lifecycleVersion === this.lifecycleVersion) throw error;
    }
  }

  private async rerenderActivePages(): Promise<void> {
    const center =
      this.currentLocator.format === 'pdf' ? this.currentLocator.pageIndex : 0;
    for (const pageIndex of [...this.renderedPages.keys()]) {
      this.releasePage(pageIndex);
    }
    if (this.document) await this.renderWindow(center);
  }

  private releasePage(pageIndex: number): void {
    const entry = this.renderedPages.get(pageIndex);
    if (!entry) return;
    this.renderedPages.delete(pageIndex);
    try {
      entry.renderTask?.cancel();
      entry.textLayer?.cancel();
      entry.page.cleanup();
    } catch {
      // Release remaining page resources even when PDF.js reports cancellation.
    }
    const shell = this.pageShells[pageIndex];
    shell.replaceChildren();
  }

  private async getPageText(pageIndex: number): Promise<string> {
    const cached = this.textCache.get(pageIndex);
    if (cached !== undefined) {
      this.textCache.delete(pageIndex);
      this.textCache.set(pageIndex, cached);
      return cached;
    }
    const page = await this.requireDocument().getPage(pageIndex + 1);
    try {
      const text = normalizedPageText(await readPageTextContent(page));
      this.cachePageText(pageIndex, text);
      return text;
    } finally {
      if (!this.renderedPages.has(pageIndex)) page.cleanup();
    }
  }

  private cachePageText(pageIndex: number, text: string): void {
    this.textCache.delete(pageIndex);
    this.textCache.set(pageIndex, text);
    while (this.textCache.size > pdfRenderLimits.textCachePages) {
      const oldest = this.textCache.keys().next().value;
      if (oldest === undefined) break;
      this.textCache.delete(oldest);
    }
  }

  private drawPageOverlays(pageIndex: number): void {
    const shell = this.pageShells[pageIndex];
    drawPdfPageOverlays({
      highlights: this.highlights.values(),
      onActivate: (highlightId) => {
        for (const listener of this.highlightActivationListeners) {
          listener(highlightId);
        }
      },
      pageIndex,
      searchRanges: this.searchRanges.get(pageIndex) ?? [],
      shell,
    });
  }

  private updateLocator(
    pageIndex: number,
    withinPageProgression: number,
    notify: boolean,
    textRange?: { start: number; end: number },
  ): void {
    const document = this.requireDocument();
    const locator = pdfBookLocatorSchema.parse({
      version: 1,
      format: 'pdf',
      pageIndex,
      withinPageProgression,
      ...(textRange ? { textRange } : {}),
      progression:
        document.numPages === 1 ? 1 : pageIndex / (document.numPages - 1),
    });
    this.currentLocator = locator;
    if (notify) {
      for (const listener of this.listeners) listener(structuredClone(locator));
    }
  }

  private setSelection(selection: ReaderTextSelection | null): void {
    this.lastSelection = selection;
    for (const listener of this.selectionListeners) {
      listener(this.getSelection());
    }
  }

  private requireHighlightLocator(highlight: ReaderHighlight) {
    const locator = pdfBookLocatorSchema.parse(highlight.locator);
    if (!locator.textRange) throw new AppError('ANNOTATION_RENDER_FAILED');
    return locator;
  }

  private requireDocument(): PDFDocumentProxy {
    if (!this.document) throw new AppError('READER_OPEN_FAILED');
    return this.document;
  }
}

export { normalizedPageText };

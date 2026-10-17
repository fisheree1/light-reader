import { AppError } from '../lib/app-error';
import {
  epubBookLocatorSchema,
  type BookLocator,
  type EbookReader,
  type ReaderTocItem,
  type ReaderSearchResult,
  type RelocationListener,
  type ReaderDisplayOptions,
  type ReaderHighlight,
  type ReaderTextSelection,
  type SelectionListener,
  type HighlightActivationListener,
  type HighlightRestoreResult,
} from './types';
import {
  createFoliateView,
  getRangeContext,
  getReaderStyles,
  highlightColors,
  isDocument,
  isRecord,
  loadFoliateView,
  makeInteractiveHighlight,
  mapRelocation,
  mapTableOfContents,
  normalizeContext,
  readString,
  type FoliateViewElement,
  type HighlightDraw,
  type ViewFactory,
  type ViewModuleLoader,
} from './foliate-reader-support';
import { PageTurnGestures } from './page-turn-gestures';
import { createFoliateFile, foliateSectionIndex } from './foliate-book-loader';
import type { FoliateBookFormat } from '../features/library/domain/book';

export class FoliateEbookReader implements EbookReader {
  private readonly listeners = new Set<RelocationListener>();
  private readonly selectionListeners = new Set<SelectionListener>();
  private readonly highlightActivationListeners =
    new Set<HighlightActivationListener>();
  private readonly loadViewModule: ViewModuleLoader;
  private readonly viewFactory: ViewFactory;
  private currentLocator: BookLocator = {
    version: 1,
    format: 'epub',
    progression: 0,
  };
  private currentSectionIndex = 0;
  private host: HTMLElement | null = null;
  private highlightDraw: HighlightDraw | null = null;
  private lastSelection: ReaderTextSelection | null = null;
  private readonly highlights = new Map<string, ReaderHighlight>();
  private readonly highlightIdsByCfi = new Map<string, string>();
  private readonly sectionCleanups = new Map<Document, () => void>();
  private readonly gestures = new PageTurnGestures((direction) =>
    direction === 'next' ? this.nextPage() : this.previousPage(),
  );
  private view: FoliateViewElement | null = null;
  private lifecycleVersion = 0;

  private readonly format: FoliateBookFormat;

  constructor(
    loadViewModule: ViewModuleLoader = loadFoliateView,
    viewFactory: ViewFactory = createFoliateView,
    format: FoliateBookFormat = 'epub',
  ) {
    this.loadViewModule = loadViewModule;
    this.viewFactory = viewFactory;
    this.format = format;
  }

  mount(host: HTMLElement): void {
    if (this.view) {
      throw new AppError('READER_OPEN_FAILED');
    }
    this.host = host;
  }

  async open(source: ArrayBuffer): Promise<void> {
    const host = this.host;
    if (!host) throw new AppError('READER_OPEN_FAILED');

    await this.close();
    const lifecycleVersion = this.lifecycleVersion;
    const opening = { view: null as FoliateViewElement | null };
    try {
      const [, { Overlayer }] = await Promise.all([
        this.loadViewModule(),
        import('foliate-js/overlayer.js'),
      ]);
      if (lifecycleVersion !== this.lifecycleVersion) {
        throw new AppError('READER_OPEN_FAILED');
      }
      this.highlightDraw = (rects, options) =>
        Overlayer.highlight(rects, options);
      const view = this.viewFactory();
      opening.view = view;
      this.view = view;
      view.addEventListener('relocate', this.handleRelocation);
      view.addEventListener('external-link', this.blockExternalLink);
      view.addEventListener('load', this.handleSectionLoad);
      view.addEventListener('draw-annotation', this.handleDrawAnnotation);
      view.addEventListener('create-overlay', this.handleCreateOverlay);
      view.addEventListener('show-annotation', this.handleShowAnnotation);
      host.replaceChildren(view);

      await view.open(createFoliateFile(source, this.format));
      if (lifecycleVersion !== this.lifecycleVersion) {
        throw new AppError('READER_OPEN_FAILED');
      }
      await view.init({ showTextStart: true });
      if (lifecycleVersion !== this.lifecycleVersion) {
        throw new AppError('READER_OPEN_FAILED');
      }
    } catch (error) {
      const openingView = opening.view;
      if (openingView && this.view === openingView) {
        this.disposeView(openingView);
      }
      throw new AppError('READER_OPEN_FAILED', { cause: error });
    }
  }

  getTableOfContents(): ReaderTocItem[] {
    return mapTableOfContents(this.view?.book?.toc);
  }

  applyDisplaySettings(settings: ReaderDisplayOptions): void {
    const renderer = this.requireView().renderer;
    if (!renderer) throw new AppError('READER_SETTINGS_WRITE_FAILED');
    renderer.setAttribute(
      'max-inline-size',
      `${String(settings.contentWidth)}px`,
    );
    renderer.setAttribute('margin', `${String(settings.margin)}px`);
    renderer.setStyles?.(getReaderStyles(settings));
  }

  async goTo(value: BookLocator): Promise<void> {
    const locator = epubBookLocatorSchema.parse(value);
    const view = this.requireView();
    const fractionDestination =
      locator.progression === undefined
        ? null
        : { fraction: locator.progression };
    const target = locator.cfi ?? locator.chapterHref;
    const sectionIndex = target ? foliateSectionIndex(target) : null;
    const destination = sectionIndex ?? target ?? fractionDestination;
    if (destination === null) throw new AppError('READER_NAVIGATION_FAILED');

    try {
      await view.goTo(destination);
    } catch (error) {
      throw new AppError('READER_NAVIGATION_FAILED', { cause: error });
    }
  }

  async previousPage(): Promise<void> {
    try {
      await this.requireView().prev();
    } catch (error) {
      throw new AppError('READER_NAVIGATION_FAILED', { cause: error });
    }
  }

  async nextPage(): Promise<void> {
    try {
      await this.requireView().next();
    } catch (error) {
      throw new AppError('READER_NAVIGATION_FAILED', { cause: error });
    }
  }

  async searchCurrentChapter(query: string): Promise<ReaderSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) {
      this.clearSearch();
      return [];
    }
    try {
      const results: ReaderSearchResult[] = [];
      for await (const result of this.requireView().search({
        index: this.currentSectionIndex,
        query: normalized,
      })) {
        if (typeof result === 'string' || !result.cfi || !result.excerpt) {
          continue;
        }
        results.push({
          excerpt: result.excerpt,
          locator: {
            version: 1,
            format: 'epub',
            cfi: result.cfi,
            ...(this.currentLocator.format === 'epub' &&
            this.currentLocator.chapterHref
              ? { chapterHref: this.currentLocator.chapterHref }
              : {}),
          },
        });
      }
      return results;
    } catch (error) {
      throw new AppError('READER_NAVIGATION_FAILED', { cause: error });
    }
  }

  clearSearch(): void {
    this.view?.clearSearch();
  }

  getCurrentLocator(): Promise<BookLocator> {
    return Promise.resolve({ ...this.currentLocator });
  }

  subscribeToRelocation(listener: RelocationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSelection(): ReaderTextSelection | null {
    return this.lastSelection
      ? {
          ...this.lastSelection,
          locator: { ...this.lastSelection.locator },
        }
      : null;
  }

  subscribeToSelection(listener: SelectionListener): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  async createHighlight(highlight: ReaderHighlight): Promise<void> {
    const cfi = this.requireHighlightCfi(highlight);
    this.highlights.set(highlight.id, highlight);
    this.highlightIdsByCfi.set(cfi, highlight.id);
    try {
      await this.renderHighlight(highlight);
      this.clearDocumentSelections();
    } catch (error) {
      this.highlights.delete(highlight.id);
      this.highlightIdsByCfi.delete(cfi);
      throw new AppError('ANNOTATION_RENDER_FAILED', { cause: error });
    }
  }

  async removeHighlight(id: string): Promise<void> {
    const highlight = this.highlights.get(id);
    if (!highlight) return;
    const cfi = this.requireHighlightCfi(highlight);
    try {
      await this.requireView().deleteAnnotation({ value: cfi, color: '' });
    } catch (error) {
      throw new AppError('ANNOTATION_RENDER_FAILED', { cause: error });
    } finally {
      this.highlights.delete(id);
      this.highlightIdsByCfi.delete(cfi);
    }
  }

  async restoreHighlights(
    highlights: ReaderHighlight[],
  ): Promise<HighlightRestoreResult[]> {
    this.highlights.clear();
    this.highlightIdsByCfi.clear();
    return Promise.all(
      highlights.map(async (highlight): Promise<HighlightRestoreResult> => {
        try {
          const cfi = this.requireHighlightCfi(highlight);
          this.highlights.set(highlight.id, highlight);
          this.highlightIdsByCfi.set(cfi, highlight.id);
          await this.renderHighlight(highlight);
          return { id: highlight.id, status: 'restored' };
        } catch {
          return { id: highlight.id, status: 'unresolved' };
        }
      }),
    );
  }

  async showHighlight(id: string): Promise<void> {
    const highlight = this.highlights.get(id);
    if (!highlight) throw new AppError('ANNOTATION_NOT_FOUND');
    try {
      await this.requireView().showAnnotation({
        value: this.requireHighlightCfi(highlight),
        color: highlightColors[highlight.color],
      });
    } catch (error) {
      throw new AppError('ANNOTATION_RENDER_FAILED', { cause: error });
    }
  }

  subscribeToHighlightActivation(
    listener: HighlightActivationListener,
  ): () => void {
    this.highlightActivationListeners.add(listener);
    return () => {
      this.highlightActivationListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.lifecycleVersion += 1;
    const view = this.view;
    if (view && this.view === view) this.view = null;
    this.currentLocator = { version: 1, format: 'epub', progression: 0 };
    this.currentSectionIndex = 0;
    this.lastSelection = null;
    this.highlights.clear();
    this.highlightIdsByCfi.clear();
    this.highlightDraw = null;
    this.gestures.reset();
    if (view) {
      this.detachViewListeners(view);
      this.releaseView(view);
    }
    return Promise.resolve();
  }

  private disposeView(view: FoliateViewElement): void {
    if (this.view === view) this.view = null;
    this.detachViewListeners(view);
    this.releaseView(view);
  }

  private detachViewListeners(view: FoliateViewElement): void {
    view.removeEventListener('relocate', this.handleRelocation);
    view.removeEventListener('external-link', this.blockExternalLink);
    view.removeEventListener('load', this.handleSectionLoad);
    view.removeEventListener('draw-annotation', this.handleDrawAnnotation);
    view.removeEventListener('create-overlay', this.handleCreateOverlay);
    view.removeEventListener('show-annotation', this.handleShowAnnotation);
    for (const cleanup of this.sectionCleanups.values()) {
      try {
        cleanup();
      } catch {
        // Continue releasing the remaining renderer resources.
      }
    }
    this.sectionCleanups.clear();
  }

  private releaseView(view: FoliateViewElement): void {
    // Stop Foliate's ResizeObserver before invalidating iframe documents.
    try {
      view.close();
    } catch {
      // Continue releasing book resources when the renderer is already gone.
    }
    for (const section of view.book?.sections ?? []) {
      try {
        section.unload?.();
      } catch {
        // A broken section must not prevent the book from closing.
      }
    }
    try {
      view.book?.destroy?.();
    } catch {
      // Continue with view cleanup.
    }
    try {
      view.remove();
    } catch {
      this.host?.replaceChildren();
    }
  }

  private readonly handleRelocation: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const locator = mapRelocation(detail);
    if (!locator) return;
    // Foliate reports the section as `section.current` (from its progress
    // tracker); `index` is kept for renderers that send it directly.
    const section =
      isRecord(detail) && isRecord(detail.section)
        ? detail.section.current
        : isRecord(detail)
          ? detail.index
          : undefined;
    if (typeof section === 'number') this.currentSectionIndex = section;
    this.currentLocator = locator;
    for (const listener of this.listeners) listener({ ...locator });
  };

  private readonly blockExternalLink: EventListener = (event) => {
    event.preventDefault();
  };

  private readonly handleSectionLoad: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail)) return;
    const doc = detail.doc;
    const index = detail.index;
    if (!isDocument(doc) || typeof index !== 'number') return;

    const updateSelection = () => {
      this.readSelection(doc, index);
    };
    doc.addEventListener('selectionchange', updateSelection);
    doc.addEventListener('pointerup', updateSelection);
    doc.addEventListener('keyup', updateSelection);
    const detachGestures = this.gestures.attach(doc);
    this.sectionCleanups.get(doc)?.();
    this.sectionCleanups.set(doc, () => {
      doc.removeEventListener('selectionchange', updateSelection);
      doc.removeEventListener('pointerup', updateSelection);
      doc.removeEventListener('keyup', updateSelection);
      detachGestures();
    });
  };

  private readonly handleDrawAnnotation: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail) || typeof detail.draw !== 'function') return;
    if (!this.highlightDraw) return;
    const annotation = isRecord(detail.annotation) ? detail.annotation : null;
    const color = readString(annotation?.color) ?? highlightColors.yellow;
    const cfi = readString(annotation?.value);
    const id = cfi ? this.highlightIdsByCfi.get(cfi) : null;
    const draw = detail.draw as (
      method: HighlightDraw,
      options: { color: string },
    ) => void;
    draw(
      makeInteractiveHighlight(this.highlightDraw, () => {
        if (id) this.notifyHighlightActivation(id);
      }),
      { color },
    );
  };

  private readonly handleCreateOverlay: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail) || typeof detail.index !== 'number') return;
    const chapterHref = this.view?.book?.sections?.[detail.index]?.id;
    for (const highlight of this.highlights.values()) {
      if (
        chapterHref &&
        (highlight.locator.format !== 'epub' ||
          highlight.locator.chapterHref !== chapterHref)
      )
        continue;
      void this.renderHighlight(highlight).catch(() => undefined);
    }
  };

  private readonly handleShowAnnotation: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail)) return;
    const cfi = readString(detail.value);
    const id = cfi ? this.highlightIdsByCfi.get(cfi) : null;
    if (!id) return;
    this.notifyHighlightActivation(id);
  };

  private notifyHighlightActivation(id: string): void {
    for (const listener of this.highlightActivationListeners) listener(id);
  }

  private readSelection(doc: Document, index: number): void {
    const selection = doc.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      this.setSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const text = normalizeContext(selection.toString());
    if (!text) {
      this.setSelection(null);
      return;
    }
    try {
      const cfi = this.requireView().getCFI(index, range);
      const chapterHref = this.view?.book?.sections?.[index]?.id;
      const context = getRangeContext(doc, range);
      this.setSelection({
        text,
        ...context,
        locator: {
          version: 1,
          format: 'epub',
          cfi,
          ...(chapterHref ? { chapterHref } : {}),
        },
      });
    } catch {
      this.setSelection(null);
    }
  }

  private setSelection(selection: ReaderTextSelection | null): void {
    this.lastSelection = selection;
    for (const listener of this.selectionListeners)
      listener(this.getSelection());
  }

  private clearDocumentSelections(): void {
    for (const doc of this.sectionCleanups.keys())
      doc.getSelection()?.removeAllRanges();
    this.setSelection(null);
  }

  private renderHighlight(highlight: ReaderHighlight): Promise<unknown> {
    return this.requireView().addAnnotation({
      value: this.requireHighlightCfi(highlight),
      color: highlightColors[highlight.color],
    });
  }

  private requireHighlightCfi(highlight: ReaderHighlight): string {
    const cfi =
      highlight.locator.format === 'epub'
        ? highlight.locator.cfi?.trim()
        : undefined;
    if (!cfi) throw new AppError('ANNOTATION_RENDER_FAILED');
    return cfi;
  }

  private requireView(): FoliateViewElement {
    if (!this.view) throw new AppError('READER_OPEN_FAILED');
    return this.view;
  }
}

export { mapRelocation, mapTableOfContents };

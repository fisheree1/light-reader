import { AppError } from '../lib/app-error';
import {
  bookLocatorSchema,
  type BookLocator,
  type EbookReader,
  type ReaderTocItem,
  type RelocationListener,
  type ReaderDisplayOptions,
  type ReaderHighlight,
  type ReaderTextSelection,
  type SelectionListener,
  type HighlightActivationListener,
  type HighlightRestoreResult,
} from './types';

interface FoliateSection {
  id?: string;
  unload?: () => void;
}

interface FoliateBook {
  destroy?: () => void;
  sections?: FoliateSection[];
  toc?: unknown;
}

interface FoliateViewElement extends HTMLElement {
  book?: FoliateBook;
  close(): void;
  goTo(target: string | { fraction: number }): Promise<unknown>;
  init(options: { showTextStart: boolean }): Promise<void>;
  next(): Promise<void>;
  open(source: Blob): Promise<void>;
  prev(): Promise<void>;
  getCFI(index: number, range: Range): string;
  addAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
  deleteAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
  showAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
  renderer?: {
    setAttribute(name: string, value: string): void;
    setStyles?(styles: string): void;
  };
}

interface FoliateAnnotation {
  color: string;
  value: string;
}

type ViewModuleLoader = () => Promise<unknown>;
type ViewFactory = () => FoliateViewElement;
type HighlightDraw = (
  rects: Iterable<DOMRect>,
  options?: { color?: string },
) => SVGGElement;

const loadFoliateView: ViewModuleLoader = () => import('foliate-js/view.js');

function createFoliateView(): FoliateViewElement {
  return document.createElement('foliate-view') as FoliateViewElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDocument(value: unknown): value is Document {
  return (
    isRecord(value) &&
    typeof value.addEventListener === 'function' &&
    typeof value.createRange === 'function' &&
    typeof value.getSelection === 'function'
  );
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function mapTableOfContents(value: unknown, depth = 0): ReaderTocItem[] {
  if (!Array.isArray(value) || depth > 16) return [];

  return value.flatMap((candidate): ReaderTocItem[] => {
    if (!isRecord(candidate)) return [];
    const href = readString(candidate.href);
    const label = readString(candidate.label);
    if (!href || !label) return [];
    return [
      {
        href,
        label,
        subitems: mapTableOfContents(candidate.subitems, depth + 1),
      },
    ];
  });
}

function mapRelocation(value: unknown): BookLocator | null {
  if (!isRecord(value)) return null;
  const tocItem = isRecord(value.tocItem) ? value.tocItem : null;
  const chapterHref = readString(tocItem?.href);
  const cfi = readString(value.cfi);
  const rawProgression = value.fraction;
  const progression =
    typeof rawProgression === 'number' && Number.isFinite(rawProgression)
      ? Math.min(1, Math.max(0, rawProgression))
      : undefined;

  return bookLocatorSchema.parse({
    version: 1,
    format: 'epub',
    ...(chapterHref ? { chapterHref } : {}),
    ...(cfi ? { cfi } : {}),
    ...(progression === undefined ? {} : { progression }),
  });
}

const themeColors = {
  light: { background: '#ffffff', foreground: '#202124', link: '#315b9d' },
  sepia: { background: '#f4ecd8', foreground: '#433a2e', link: '#795c2f' },
  dark: { background: '#171717', foreground: '#e8e5df', link: '#9bbcff' },
} as const;

function getReaderStyles(settings: ReaderDisplayOptions): string {
  const colors = themeColors[settings.theme];
  const colorScheme = settings.theme === 'dark' ? 'dark' : 'light';
  return `
    :root { color-scheme: ${colorScheme}; }
    html, body {
      background: ${colors.background} !important;
      color: ${colors.foreground} !important;
      font-size: ${String(settings.fontSize)}px !important;
    }
    body { line-height: ${String(settings.lineHeight)} !important; }
    p, li, blockquote, dd { line-height: ${String(settings.lineHeight)} !important; }
    a:link, a:visited { color: ${colors.link} !important; }
  `;
}

const highlightColors = {
  yellow: '#facc15',
  blue: '#60a5fa',
  green: '#4ade80',
  red: '#f87171',
} as const;

function makeInteractiveHighlight(drawHighlight: HighlightDraw): HighlightDraw {
  return (rects, options) => {
    const group = drawHighlight(rects, options);
    group.style.cursor = 'pointer';
    group.style.pointerEvents = 'auto';
    group.style.transition = 'opacity 120ms ease';
    group.addEventListener('pointerenter', () => {
      group.style.opacity = '.45';
    });
    group.addEventListener('pointerleave', () => {
      group.style.opacity = 'var(--overlayer-highlight-opacity, .3)';
    });
    group.addEventListener('pointerdown', () => {
      group.style.opacity = '.6';
    });
    group.addEventListener('pointerup', () => {
      group.style.opacity = '.45';
    });
    return group;
  };
}

function normalizeContext(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function getRangeContext(doc: Document, range: Range) {
  const root = doc.body;
  try {
    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const after = doc.createRange();
    after.selectNodeContents(root);
    after.setStart(range.endContainer, range.endOffset);
    return {
      textBefore: normalizeContext(before.toString().slice(-160)),
      textAfter: normalizeContext(after.toString().slice(0, 160)),
    };
  } catch {
    return { textBefore: null, textAfter: null };
  }
}

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
  private host: HTMLElement | null = null;
  private highlightDraw: HighlightDraw | null = null;
  private lastSelection: ReaderTextSelection | null = null;
  private readonly highlights = new Map<string, ReaderHighlight>();
  private readonly highlightIdsByCfi = new Map<string, string>();
  private readonly sectionCleanups = new Map<Document, () => void>();
  private view: FoliateViewElement | null = null;

  constructor(
    loadViewModule: ViewModuleLoader = loadFoliateView,
    viewFactory: ViewFactory = createFoliateView,
  ) {
    this.loadViewModule = loadViewModule;
    this.viewFactory = viewFactory;
  }

  mount(host: HTMLElement): void {
    if (this.view) {
      throw new AppError('READER_OPEN_FAILED');
    }
    this.host = host;
  }

  async open(source: ArrayBuffer): Promise<void> {
    if (!this.host) throw new AppError('READER_OPEN_FAILED');

    await this.close();
    try {
      const [, { Overlayer }] = await Promise.all([
        this.loadViewModule(),
        import('foliate-js/overlayer.js'),
      ]);
      this.highlightDraw = makeInteractiveHighlight((rects, options) =>
        Overlayer.highlight(rects, options),
      );
      const view = this.viewFactory();
      this.view = view;
      view.addEventListener('relocate', this.handleRelocation);
      view.addEventListener('external-link', this.blockExternalLink);
      view.addEventListener('load', this.handleSectionLoad);
      view.addEventListener('draw-annotation', this.handleDrawAnnotation);
      view.addEventListener('create-overlay', this.handleCreateOverlay);
      view.addEventListener('show-annotation', this.handleShowAnnotation);
      this.host.replaceChildren(view);

      await view.open(
        new File([source], 'book.epub', {
          type: 'application/epub+zip',
        }),
      );
      await view.init({ showTextStart: true });
    } catch (error) {
      await this.close();
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
    const locator = bookLocatorSchema.parse(value);
    const view = this.requireView();
    const fractionDestination =
      locator.progression === undefined
        ? null
        : { fraction: locator.progression };
    const destination =
      locator.cfi ?? locator.chapterHref ?? fractionDestination;
    if (!destination) throw new AppError('READER_NAVIGATION_FAILED');

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
    this.highlightDraw = null;
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
    const view = this.view;
    if (view) {
      view.removeEventListener('relocate', this.handleRelocation);
      view.removeEventListener('external-link', this.blockExternalLink);
      view.removeEventListener('load', this.handleSectionLoad);
      view.removeEventListener('draw-annotation', this.handleDrawAnnotation);
      view.removeEventListener('create-overlay', this.handleCreateOverlay);
      view.removeEventListener('show-annotation', this.handleShowAnnotation);
      for (const cleanup of this.sectionCleanups.values()) cleanup();
      this.sectionCleanups.clear();
      for (const section of view.book?.sections ?? []) section.unload?.();
      view.book?.destroy?.();
      view.close();
      view.remove();
      this.view = null;
    }
    this.currentLocator = { version: 1, format: 'epub', progression: 0 };
    this.lastSelection = null;
    this.highlights.clear();
    this.highlightIdsByCfi.clear();
    return Promise.resolve();
  }

  private readonly handleRelocation: EventListener = (event) => {
    const locator = mapRelocation((event as CustomEvent<unknown>).detail);
    if (!locator) return;
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
    this.sectionCleanups.get(doc)?.();
    this.sectionCleanups.set(doc, () => {
      doc.removeEventListener('selectionchange', updateSelection);
      doc.removeEventListener('pointerup', updateSelection);
      doc.removeEventListener('keyup', updateSelection);
    });
  };

  private readonly handleDrawAnnotation: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail) || typeof detail.draw !== 'function') return;
    if (!this.highlightDraw) return;
    const annotation = isRecord(detail.annotation) ? detail.annotation : null;
    const color = readString(annotation?.color) ?? highlightColors.yellow;
    const draw = detail.draw as (
      method: HighlightDraw,
      options: { color: string },
    ) => void;
    draw(this.highlightDraw, { color });
  };

  private readonly handleCreateOverlay: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isRecord(detail) || typeof detail.index !== 'number') return;
    const chapterHref = this.view?.book?.sections?.[detail.index]?.id;
    for (const highlight of this.highlights.values()) {
      if (chapterHref && highlight.locator.chapterHref !== chapterHref)
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
    for (const listener of this.highlightActivationListeners) listener(id);
  };

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
    const cfi = highlight.locator.cfi?.trim();
    if (!cfi) throw new AppError('ANNOTATION_RENDER_FAILED');
    return cfi;
  }

  private requireView(): FoliateViewElement {
    if (!this.view) throw new AppError('READER_OPEN_FAILED');
    return this.view;
  }
}

export { mapRelocation, mapTableOfContents };

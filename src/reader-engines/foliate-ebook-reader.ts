import { AppError } from '../lib/app-error';
import {
  bookLocatorSchema,
  type BookLocator,
  type EbookReader,
  type ReaderTocItem,
  type RelocationListener,
  type ReaderDisplayOptions,
} from './types';

interface FoliateSection {
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
  renderer?: {
    setAttribute(name: string, value: string): void;
    setStyles?(styles: string): void;
  };
}

type ViewModuleLoader = () => Promise<unknown>;
type ViewFactory = () => FoliateViewElement;

const loadFoliateView: ViewModuleLoader = () => import('foliate-js/view.js');

function createFoliateView(): FoliateViewElement {
  return document.createElement('foliate-view') as FoliateViewElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

export class FoliateEbookReader implements EbookReader {
  private readonly listeners = new Set<RelocationListener>();
  private readonly loadViewModule: ViewModuleLoader;
  private readonly viewFactory: ViewFactory;
  private currentLocator: BookLocator = {
    version: 1,
    format: 'epub',
    progression: 0,
  };
  private host: HTMLElement | null = null;
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
      await this.loadViewModule();
      const view = this.viewFactory();
      this.view = view;
      view.addEventListener('relocate', this.handleRelocation);
      view.addEventListener('external-link', this.blockExternalLink);
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

  close(): Promise<void> {
    const view = this.view;
    if (view) {
      view.removeEventListener('relocate', this.handleRelocation);
      view.removeEventListener('external-link', this.blockExternalLink);
      for (const section of view.book?.sections ?? []) section.unload?.();
      view.book?.destroy?.();
      view.close();
      view.remove();
      this.view = null;
    }
    this.currentLocator = { version: 1, format: 'epub', progression: 0 };
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

  private requireView(): FoliateViewElement {
    if (!this.view) throw new AppError('READER_OPEN_FAILED');
    return this.view;
  }
}

export { mapRelocation, mapTableOfContents };

import {
  bookLocatorSchema,
  type BookLocator,
  type ReaderDisplayOptions,
  type ReaderTocItem,
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

export interface FoliateViewElement extends HTMLElement {
  book?: FoliateBook;
  close(): void;
  goTo(target: string | { fraction: number }): Promise<unknown>;
  init(options: { showTextStart: boolean }): Promise<void>;
  next(): Promise<void>;
  open(source: Blob): Promise<void>;
  prev(): Promise<void>;
  search(options: { index: number; query: string }): AsyncIterable<
    | string
    | {
        cfi?: string;
        excerpt?: { match: string; post: string; pre: string };
      }
  >;
  clearSearch(): void;
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

export type ViewModuleLoader = () => Promise<unknown>;
export type ViewFactory = () => FoliateViewElement;
export type HighlightDraw = (
  rects: Iterable<DOMRect>,
  options?: { color?: string },
) => SVGGElement;

export interface PointerStart {
  x: number;
  y: number;
}

export const foliateInteractionLimits = {
  cooldown: 320,
  swipeThreshold: 48,
  wheelThreshold: 80,
} as const;

export const highlightColors = {
  yellow: '#facc15',
  blue: '#60a5fa',
  green: '#4ade80',
  red: '#f87171',
} as const;

export const loadFoliateView: ViewModuleLoader = () =>
  import('foliate-js/view.js');

export function createFoliateView(): FoliateViewElement {
  return document.createElement('foliate-view') as FoliateViewElement;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDocument(value: unknown): value is Document {
  return (
    isRecord(value) &&
    typeof value.addEventListener === 'function' &&
    typeof value.createRange === 'function' &&
    typeof value.getSelection === 'function'
  );
}

export function readString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function mapTableOfContents(value: unknown, depth = 0): ReaderTocItem[] {
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

export function mapRelocation(value: unknown): BookLocator | null {
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

export function getReaderStyles(settings: ReaderDisplayOptions): string {
  const themeColors = {
    light: { background: '#ffffff', foreground: '#202124', link: '#315b9d' },
    sepia: { background: '#f4ecd8', foreground: '#433a2e', link: '#795c2f' },
    dark: { background: '#171717', foreground: '#e8e5df', link: '#9bbcff' },
  } as const;
  const colors = themeColors[settings.theme];
  const colorScheme = settings.theme === 'dark' ? 'dark' : 'light';
  const fontFamily =
    settings.fontFamily === 'publisher'
      ? 'inherit'
      : settings.fontFamily === 'sans-serif'
        ? 'system-ui, -apple-system, sans-serif'
        : 'ui-serif, Georgia, serif';
  return `
    :root { color-scheme: ${colorScheme}; }
    html, body {
      background: ${colors.background} !important;
      color: ${colors.foreground} !important;
      font-size: ${String(settings.fontSize)}px !important;
      font-family: ${fontFamily} !important;
      font-weight: ${String(settings.fontWeight)} !important;
    }
    body { line-height: ${String(settings.lineHeight)} !important; }
    p, li, blockquote, dd { line-height: ${String(settings.lineHeight)} !important; }
    a:link, a:visited { color: ${colors.link} !important; }
  `;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object' || !('closest' in target)) {
    return false;
  }
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== 'function') return false;
  return Boolean(
    (closest as (selector: string) => Element | null).call(
      target,
      'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
    ),
  );
}

export function makeInteractiveHighlight(
  drawHighlight: HighlightDraw,
  onActivate: () => void,
): HighlightDraw {
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
    group.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });
    return group;
  };
}

export function normalizeContext(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

export function getRangeContext(doc: Document, range: Range) {
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

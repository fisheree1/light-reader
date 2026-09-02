import { z } from 'zod';

export const epubBookLocatorSchema = z.object({
  version: z.literal(1),
  format: z.literal('epub'),
  chapterHref: z.string().trim().min(1).optional(),
  cfi: z.string().trim().min(1).optional(),
  progression: z.number().min(0).max(1).optional(),
});

export const pdfTextRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((range) => range.end > range.start, {
    message: 'PDF text range end must be greater than start.',
  });

export const pdfBookLocatorSchema = z.object({
  version: z.literal(1),
  format: z.literal('pdf'),
  /** Zero-based PDF page index. */
  pageIndex: z.number().int().nonnegative(),
  /** Optional vertical position within the page, from top (0) to bottom (1). */
  withinPageProgression: z.number().min(0).max(1).optional(),
  /** Stable character offsets in the normalized PDF.js text layer. */
  textRange: pdfTextRangeSchema.optional(),
  progression: z.number().min(0).max(1).optional(),
});

export const bookLocatorSchema = z.discriminatedUnion('format', [
  epubBookLocatorSchema,
  pdfBookLocatorSchema,
]);

/** Stable position. Never store DOM, Foliate, PDF.js, worker, or canvas state. */
export type BookLocator = z.infer<typeof bookLocatorSchema>;

export interface ReaderTocItem {
  href: string;
  label: string;
  subitems: ReaderTocItem[];
}

export interface ReaderSearchResult {
  excerpt: {
    match: string;
    post: string;
    pre: string;
  };
  locator: BookLocator;
}

export type RelocationListener = (locator: BookLocator) => void;

export type AnnotationColor = 'yellow' | 'blue' | 'green' | 'red';

export interface ReaderTextSelection {
  locator: BookLocator;
  text: string;
  textAfter: string | null;
  textBefore: string | null;
}

export interface ReaderHighlight {
  color: AnnotationColor;
  id: string;
  locator: BookLocator;
}

export interface HighlightRestoreResult {
  id: string;
  status: 'restored' | 'unresolved';
}

export type SelectionListener = (selection: ReaderTextSelection | null) => void;
export type HighlightActivationListener = (id: string) => void;

export interface ReaderDisplayOptions {
  contentWidth: number;
  fontFamily: 'publisher' | 'sans-serif' | 'serif';
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  margin: number;
  theme: 'light' | 'sepia' | 'dark';
}

/** Engine-neutral lifecycle used by the reader feature. */
export interface EbookReader {
  mount(host: HTMLElement): void;
  open(source: ArrayBuffer): Promise<void>;
  applyDisplaySettings(settings: ReaderDisplayOptions): void;
  getTableOfContents(): ReaderTocItem[];
  goTo(locator: BookLocator): Promise<void>;
  previousPage(): Promise<void>;
  nextPage(): Promise<void>;
  search?(query: string): Promise<ReaderSearchResult[]>;
  searchCurrentChapter?(query: string): Promise<ReaderSearchResult[]>;
  clearSearch?(): void;
  getCurrentLocator(): Promise<BookLocator>;
  subscribeToRelocation(listener: RelocationListener): () => void;
  getSelection(): ReaderTextSelection | null;
  subscribeToSelection(listener: SelectionListener): () => void;
  createHighlight(highlight: ReaderHighlight): Promise<void>;
  removeHighlight(id: string): Promise<void>;
  restoreHighlights(
    highlights: ReaderHighlight[],
  ): Promise<HighlightRestoreResult[]>;
  showHighlight(id: string): Promise<void>;
  subscribeToHighlightActivation(
    listener: HighlightActivationListener,
  ): () => void;
  close(): Promise<void>;
}

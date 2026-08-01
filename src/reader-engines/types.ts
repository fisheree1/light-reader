import { z } from 'zod';

export const bookLocatorSchema = z.object({
  version: z.literal(1),
  format: z.literal('epub'),
  chapterHref: z.string().trim().min(1).optional(),
  cfi: z.string().trim().min(1).optional(),
  progression: z.number().min(0).max(1).optional(),
});

/** Stable, serializable reading position. Never store DOM or Foliate objects. */
export type BookLocator = z.infer<typeof bookLocatorSchema>;

export interface ReaderTocItem {
  href: string;
  label: string;
  subitems: ReaderTocItem[];
}

export type RelocationListener = (locator: BookLocator) => void;

export interface ReaderDisplayOptions {
  contentWidth: number;
  fontSize: number;
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
  getCurrentLocator(): Promise<BookLocator>;
  subscribeToRelocation(listener: RelocationListener): () => void;
  close(): Promise<void>;
}

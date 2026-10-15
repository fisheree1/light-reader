import {
  bookFormatMediaTypes,
  type FoliateBookFormat,
} from '../features/library/domain/book';

/** The subset of a parsed Foliate book that LightReader reads outside the view. */
export interface FoliateBook {
  getCover?: () => Promise<Blob | null | undefined> | Blob | null | undefined;
  metadata?: Record<string, unknown>;
  sections?: {
    createDocument?: () => Promise<Document> | Document;
    linear?: string;
  }[];
  toc?: unknown;
  resolveHref?: (href: string) => { index: number } | null | undefined;
  destroy?: () => void;
}

/**
 * Wraps managed bytes in a `File` whose name and type let Foliate pick the
 * right parser (CBZ and FB2 are detected by name; MOBI/AZW3 by magic bytes).
 */
export function createFoliateFile(
  source: ArrayBuffer | Uint8Array,
  format: FoliateBookFormat,
): File {
  const bytes =
    source instanceof Uint8Array ? Uint8Array.from(source) : source.slice(0);
  return new File([bytes], `book.${format}`, {
    type: bookFormatMediaTypes[format],
  });
}

/** Parses a book with Foliate without mounting a reader view. */
export async function openFoliateBook(
  source: ArrayBuffer | Uint8Array,
  format: FoliateBookFormat,
): Promise<FoliateBook> {
  const { makeBook } = await import('foliate-js/view.js');
  return (await makeBook(createFoliateFile(source, format))) as FoliateBook;
}

/** Section-level CFI that Foliate resolves for books without an EPUB spine. */
export function foliateSectionCfi(index: number): string {
  return `epubcfi(/6/${String((index + 1) * 2)})`;
}

/**
 * Returns the section index of a section-level CFI produced by
 * `foliateSectionCfi`. Foliate cannot resolve such CFIs to an in-document
 * range, so the reader navigates to them by index instead.
 */
export function foliateSectionIndex(cfi: string): number | null {
  const match = /^epubcfi\(\/6\/(\d+)\)$/.exec(cfi);
  if (!match) return null;
  const step = Number(match[1]);
  return step >= 2 && step % 2 === 0 ? step / 2 - 1 : null;
}

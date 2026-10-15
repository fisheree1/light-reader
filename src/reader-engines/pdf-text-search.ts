import type { BookLocator, ReaderSearchResult } from './types';

export interface PdfTextRange {
  end: number;
  start: number;
}

export interface PdfPageMatches {
  ranges: PdfTextRange[];
  results: ReaderSearchResult[];
}

/** Book-level progression of a page, matching the reader locator contract. */
export function pdfPageProgression(pageIndex: number, pageCount: number) {
  return pageCount === 1 ? 1 : pageIndex / (pageCount - 1);
}

/**
 * Finds up to `limit` case-insensitive matches of `query` in one page's
 * normalized text and returns both the locators and the overlay ranges.
 */
export function findPdfPageMatches(
  text: string,
  query: string,
  pageIndex: number,
  pageCount: number,
  limit: number,
): PdfPageMatches {
  const needle = query.toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  const ranges: PdfTextRange[] = [];
  const results: ReaderSearchResult[] = [];
  let start = 0;
  while (needle && start < haystack.length && results.length < limit) {
    const matchStart = haystack.indexOf(needle, start);
    if (matchStart < 0) break;
    const end = matchStart + query.length;
    ranges.push({ start: matchStart, end });
    const locator: BookLocator = {
      version: 1,
      format: 'pdf',
      pageIndex,
      textRange: { start: matchStart, end },
      progression: pdfPageProgression(pageIndex, pageCount),
    };
    results.push({
      excerpt: {
        pre: text.slice(Math.max(0, matchStart - 48), matchStart),
        match: text.slice(matchStart, end),
        post: text.slice(end, end + 48),
      },
      locator,
    });
    start = end;
  }
  return { ranges, results };
}

/** Least-recently-used cache of normalized page text. */
export class PdfPageTextCache {
  private readonly capacity: number;
  private readonly pages = new Map<number, string>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(pageIndex: number): string | undefined {
    const text = this.pages.get(pageIndex);
    if (text !== undefined) this.set(pageIndex, text);
    return text;
  }

  set(pageIndex: number, text: string): void {
    this.pages.delete(pageIndex);
    this.pages.set(pageIndex, text);
    while (this.pages.size > this.capacity) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
  }

  clear(): void {
    this.pages.clear();
  }
}

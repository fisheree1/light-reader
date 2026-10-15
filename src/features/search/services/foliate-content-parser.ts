import type { FoliateBookFormat } from '../../library/domain/book';
import {
  foliateSectionCfi,
  openFoliateBook,
  type FoliateBook,
} from '../../../reader-engines/foliate-book-loader';
import type { BookContentChapter } from '../domain/search';
import { translate } from '../../../i18n/i18n';

type BookOpener = (
  source: ArrayBuffer | Uint8Array,
  format: FoliateBookFormat,
) => Promise<FoliateBook>;

interface TocItem {
  href?: unknown;
  label?: unknown;
  subitems?: unknown;
}

function sectionTitles(book: FoliateBook): Map<number, string> {
  const titles = new Map<number, string>();
  const visit = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as TocItem[]) {
      if (typeof item.href === 'string' && typeof item.label === 'string') {
        try {
          const index = book.resolveHref?.(item.href)?.index;
          const label = item.label.trim();
          if (index !== undefined && label && !titles.has(index)) {
            titles.set(index, label);
          }
        } catch {
          // An unresolvable TOC entry only loses its title.
        }
      }
      visit(item.subitems);
    }
  };
  visit(book.toc);
  return titles;
}

/**
 * Extracts plain text per section from MOBI, AZW3, FB2, and CBZ books. Each
 * chapter is addressed by a section-level CFI that the Foliate reader can
 * navigate to. Image-only comic books yield no chapters.
 */
export class FoliateBookContentParser {
  private readonly open: BookOpener;

  constructor(open: BookOpener = openFoliateBook) {
    this.open = open;
  }

  async parse(
    source: ArrayBuffer | Uint8Array,
    format: FoliateBookFormat,
    signal?: AbortSignal,
  ): Promise<BookContentChapter[]> {
    if (format === 'cbz') return [];
    const book = await this.open(source, format);
    try {
      const titles = sectionTitles(book);
      const chapters: BookContentChapter[] = [];
      for (const [index, section] of (book.sections ?? []).entries()) {
        signal?.throwIfAborted();
        if (!section.createDocument || section.linear === 'no') continue;
        const document = await section.createDocument();
        const text = (document.body.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) continue;
        chapters.push({
          chapterHref: foliateSectionCfi(index),
          chapterTitle:
            titles.get(index) ??
            translate('content.sectionNumber', { number: index + 1 }),
          text,
        });
      }
      return chapters;
    } finally {
      book.destroy?.();
    }
  }
}

import type { BookFormat } from '../../library/domain/book';
import { FflateEpubContentParser } from '../../search/services/epub-content-parser';
import { FoliateBookContentParser } from '../../search/services/foliate-content-parser';
import { PdfBookTextParser } from '../../../reader-engines/pdf-book-text-parser';
import { bookTextBlockSchema, type BookTextBlock } from './book-retrieval';
import {
  emitBookIndexingProgress,
  throwIfBookIndexingAborted,
  type BookRetrievalOptions,
} from './book-indexing';

export interface BookTextExtractor {
  extract(
    format: BookFormat,
    source: ArrayBuffer,
    options?: BookRetrievalOptions,
  ): Promise<BookTextBlock[]>;
}

export class LocalBookTextExtractor implements BookTextExtractor {
  private readonly epubParser: FflateEpubContentParser;
  private readonly pdfParser: PdfBookTextParser;
  private readonly foliateParser: Pick<FoliateBookContentParser, 'parse'>;

  constructor(
    epubParser = new FflateEpubContentParser(),
    pdfParser = new PdfBookTextParser(),
    foliateParser: Pick<
      FoliateBookContentParser,
      'parse'
    > = new FoliateBookContentParser(),
  ) {
    this.epubParser = epubParser;
    this.pdfParser = pdfParser;
    this.foliateParser = foliateParser;
  }

  async extract(
    format: BookFormat,
    source: ArrayBuffer,
    options: BookRetrievalOptions = {},
  ): Promise<BookTextBlock[]> {
    throwIfBookIndexingAborted(options.signal);
    if (format === 'pdf') {
      const pages = await this.pdfParser.parse(source, {
        signal: options.signal,
        onProgress: (completed, total) => {
          emitBookIndexingProgress(
            options,
            'extracting-text',
            completed,
            total,
          );
        },
      });
      return pages.map((page, ordinal) =>
        bookTextBlockSchema.parse({
          chapterHref: null,
          chapterTitle: `PDF 第 ${String(page.pageIndex + 1)} 页`,
          locator: {
            version: 1,
            format: 'pdf',
            pageIndex: page.pageIndex,
            textRange: { start: 0, end: page.text.length },
          },
          ordinal,
          text: page.text,
        }),
      );
    }

    if (format !== 'epub') {
      const sections = await this.foliateParser.parse(
        source,
        format,
        options.signal,
      );
      return sections.map((section, ordinal) => {
        emitBookIndexingProgress(
          options,
          'extracting-text',
          ordinal + 1,
          sections.length,
        );
        return bookTextBlockSchema.parse({
          chapterHref: null,
          chapterTitle: section.chapterTitle,
          // Section CFIs navigate MOBI/AZW3/FB2 books without an EPUB spine.
          locator: { version: 1, format: 'epub', cfi: section.chapterHref },
          ordinal,
          text: section.text,
        });
      });
    }

    const chapters = await this.epubParser.parse(new Uint8Array(source));
    throwIfBookIndexingAborted(options.signal);
    return chapters.map((chapter, ordinal) => {
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(
        options,
        'extracting-text',
        ordinal + 1,
        chapters.length,
      );
      return bookTextBlockSchema.parse({
        chapterHref: chapter.chapterHref,
        chapterTitle: chapter.chapterTitle,
        locator: {
          version: 1,
          format: 'epub',
          chapterHref: chapter.chapterHref,
        },
        ordinal,
        text: chapter.text,
      });
    });
  }
}

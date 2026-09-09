import type { BookFormat } from '../../library/domain/book';
import { FflateEpubContentParser } from '../../search/services/epub-content-parser';
import { PdfBookTextParser } from '../../../reader-engines/pdf-book-text-parser';
import { bookTextBlockSchema, type BookTextBlock } from './book-retrieval';

export interface BookTextExtractor {
  extract(format: BookFormat, source: ArrayBuffer): Promise<BookTextBlock[]>;
}

export class LocalBookTextExtractor implements BookTextExtractor {
  private readonly epubParser: FflateEpubContentParser;
  private readonly pdfParser: PdfBookTextParser;

  constructor(
    epubParser = new FflateEpubContentParser(),
    pdfParser = new PdfBookTextParser(),
  ) {
    this.epubParser = epubParser;
    this.pdfParser = pdfParser;
  }

  async extract(
    format: BookFormat,
    source: ArrayBuffer,
  ): Promise<BookTextBlock[]> {
    if (format === 'pdf') {
      const pages = await this.pdfParser.parse(source);
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

    const chapters = await this.epubParser.parse(new Uint8Array(source));
    return chapters.map((chapter, ordinal) =>
      bookTextBlockSchema.parse({
        chapterHref: chapter.chapterHref,
        chapterTitle: chapter.chapterTitle,
        locator: {
          version: 1,
          format: 'epub',
          chapterHref: chapter.chapterHref,
        },
        ordinal,
        text: chapter.text,
      }),
    );
  }
}

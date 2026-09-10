import type { BookRepository } from '../../../database/repositories/book-repository';
import type { SearchRepository } from '../../../database/repositories/search-repository';
import { asAppError } from '../../../lib/app-error';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
import type { Book } from '../../library/domain/book';
import { PdfBookTextParser } from '../../../reader-engines/pdf-book-text-parser';
import {
  normalizeSearchQuery,
  type LocalSearchResults,
} from '../domain/search';
import type { EpubContentParser } from './epub-content-parser';

export interface SearchIndexRebuildResult {
  failedBooks: number;
  indexedBooks: number;
}

export class LocalSearchService {
  private readonly attemptedBookIds = new Set<string>();
  private readonly failedBookIds = new Set<string>();
  private readonly repository: SearchRepository;
  private readonly bookRepository: BookRepository;
  private readonly source: ReaderBookSource;
  private readonly contentParser: EpubContentParser;
  private readonly pdfParser: Pick<PdfBookTextParser, 'parse'>;

  constructor(
    repository: SearchRepository,
    bookRepository: BookRepository,
    source: ReaderBookSource,
    contentParser: EpubContentParser,
    pdfParser: Pick<PdfBookTextParser, 'parse'> = new PdfBookTextParser(),
  ) {
    this.repository = repository;
    this.bookRepository = bookRepository;
    this.source = source;
    this.contentParser = contentParser;
    this.pdfParser = pdfParser;
  }

  async search(value: string): Promise<LocalSearchResults> {
    const query = normalizeSearchQuery(value);
    if (!query) {
      return {
        annotations: [],
        books: [],
        bookContent: [],
        indexFailures: 0,
        notes: [],
        query,
      };
    }

    try {
      const indexFailures = await this.indexMissingBooks();
      const [books, notes, annotations, bookContent] = await Promise.all([
        this.repository.searchBooks(query),
        this.repository.searchNotes(query),
        this.repository.searchAnnotations(query),
        this.repository.searchBookContent(query),
      ]);
      return { annotations, books, bookContent, indexFailures, notes, query };
    } catch (error) {
      throw asAppError(error, 'SEARCH_FAILED');
    }
  }

  async rebuildIndex(): Promise<SearchIndexRebuildResult> {
    try {
      this.attemptedBookIds.clear();
      this.failedBookIds.clear();
      await this.repository.rebuildTextIndexes();
      await this.repository.clearBookContent();
      const books = await this.bookRepository.list();
      let indexedBooks = 0;
      let failedBooks = 0;
      for (const book of books) {
        if (await this.indexBook(book)) indexedBooks += 1;
        else failedBooks += 1;
      }
      return { failedBooks, indexedBooks };
    } catch (error) {
      throw asAppError(error, 'SEARCH_INDEX_FAILED');
    }
  }

  private async indexMissingBooks(): Promise<number> {
    const [books, indexedIds] = await Promise.all([
      this.bookRepository.list(),
      this.repository.findIndexedBookIds(),
    ]);
    const indexed = new Set(indexedIds);
    const currentIds = new Set(books.map((book) => book.id));
    let failures = [...this.failedBookIds].filter((id) =>
      currentIds.has(id),
    ).length;
    for (const book of books) {
      if (indexed.has(book.id)) continue;
      if (this.attemptedBookIds.has(book.id)) continue;
      if (!(await this.indexBook(book))) failures += 1;
    }
    return failures;
  }

  private async indexBook(book: Book): Promise<boolean> {
    this.attemptedBookIds.add(book.id);
    try {
      const source = await this.source.read(book.filePath);
      const chapters =
        book.format === 'pdf'
          ? (await this.pdfParser.parse(source)).map((page) => ({
              chapterHref: `pdf-page:${String(page.pageIndex)}`,
              chapterTitle: `PDF 第 ${String(page.pageIndex + 1)} 页`,
              text: page.text,
            }))
          : await this.contentParser.parse(new Uint8Array(source));
      await this.repository.replaceBookContent(book.id, chapters);
      this.failedBookIds.delete(book.id);
      return true;
    } catch {
      // The index is derived. Keep the book and allow a later rebuild instead of
      // turning a single corrupt document into a total local-search failure.
      await this.repository
        .replaceBookContent(book.id, [])
        .catch(() => undefined);
      this.failedBookIds.add(book.id);
      return false;
    }
  }
}

import type { BookRepository } from '../../../database/repositories/book-repository';
import type { SearchRepository } from '../../../database/repositories/search-repository';
import { asAppError } from '../../../lib/app-error';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
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
  private readonly repository: SearchRepository;
  private readonly bookRepository: BookRepository;
  private readonly source: ReaderBookSource;
  private readonly contentParser: EpubContentParser;

  constructor(
    repository: SearchRepository,
    bookRepository: BookRepository,
    source: ReaderBookSource,
    contentParser: EpubContentParser,
  ) {
    this.repository = repository;
    this.bookRepository = bookRepository;
    this.source = source;
    this.contentParser = contentParser;
  }

  async search(value: string): Promise<LocalSearchResults> {
    const query = normalizeSearchQuery(value);
    if (!query) {
      return {
        annotations: [],
        bookContent: [],
        indexFailures: 0,
        notes: [],
        query,
      };
    }

    try {
      const indexFailures = await this.indexMissingBooks();
      const [notes, annotations, bookContent] = await Promise.all([
        this.repository.searchNotes(query),
        this.repository.searchAnnotations(query),
        this.repository.searchBookContent(query),
      ]);
      return { annotations, bookContent, indexFailures, notes, query };
    } catch (error) {
      throw asAppError(error, 'SEARCH_FAILED');
    }
  }

  async rebuildIndex(): Promise<SearchIndexRebuildResult> {
    try {
      await this.repository.rebuildTextIndexes();
      await this.repository.clearBookContent();
      const books = await this.bookRepository.list();
      let indexedBooks = 0;
      let failedBooks = 0;
      for (const book of books) {
        if (await this.indexBook(book.id, book.filePath)) indexedBooks += 1;
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
    let failures = 0;
    for (const book of books) {
      if (indexed.has(book.id)) continue;
      if (!(await this.indexBook(book.id, book.filePath))) failures += 1;
    }
    return failures;
  }

  private async indexBook(bookId: string, filePath: string): Promise<boolean> {
    try {
      const source = await this.source.read(filePath);
      const chapters = await this.contentParser.parse(new Uint8Array(source));
      await this.repository.replaceBookContent(bookId, chapters);
      return true;
    } catch {
      // The index is derived. Keep the book and allow a later rebuild instead of
      // turning a single corrupt EPUB into a total local-search failure.
      await this.repository
        .replaceBookContent(bookId, [])
        .catch(() => undefined);
      return false;
    }
  }
}

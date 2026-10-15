import type { AnnotationRepository } from './annotation-repository';
import type { BookRepository } from './book-repository';
import type { NoteRepository } from './note-repository';
import type { SearchRepository } from './search-repository';
import {
  annotationSearchResultSchema,
  bookSearchResultSchema,
  bookContentChapterSchema,
  bookContentSearchResultSchema,
  normalizeSearchQuery,
  noteSearchResultSchema,
  type AnnotationSearchResult,
  type BookContentChapter,
  type BookContentSearchResult,
  type BookSearchResult,
  type NoteSearchResult,
} from '../../features/search/domain/search';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import {
  webBookContentRecordSchema,
  type WebBookContentRecord,
} from '../web/web-records';

function includesQuery(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function excerpt(value: string, query: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const index = normalized
    .toLocaleLowerCase()
    .indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  const result = normalized.slice(start, start + 260);
  return `${start > 0 ? '…' : ''}${result}${start + 260 < normalized.length ? '…' : ''}`;
}

export class WebSearchRepository implements SearchRepository {
  private readonly noteRepository: NoteRepository;
  private readonly annotationRepository: AnnotationRepository;
  private readonly bookRepository: BookRepository;
  private readonly database: WebDatabase;

  constructor(
    noteRepository: NoteRepository,
    annotationRepository: AnnotationRepository,
    bookRepository: BookRepository,
    database: WebDatabase = getWebDatabase(),
  ) {
    this.noteRepository = noteRepository;
    this.annotationRepository = annotationRepository;
    this.bookRepository = bookRepository;
    this.database = database;
  }

  async searchBooks(value: string, limit = 20): Promise<BookSearchResult[]> {
    const query = normalizeSearchQuery(value);
    try {
      const books = await this.bookRepository.list();
      return books
        .filter(
          (book) =>
            includesQuery(book.title, query) ||
            includesQuery(book.author ?? '', query),
        )
        .slice(0, limit)
        .map((book) =>
          bookSearchResultSchema.parse({
            kind: 'book',
            id: book.id,
            title: book.title,
            author: book.author,
            format: book.format,
          }),
        );
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchNotes(value: string, limit = 20): Promise<NoteSearchResult[]> {
    const query = normalizeSearchQuery(value);
    try {
      const notes = await this.noteRepository.list();
      return notes
        .filter(
          (note) =>
            includesQuery(note.title, query) ||
            includesQuery(note.plainText, query),
        )
        .slice(0, limit)
        .map((note) =>
          noteSearchResultSchema.parse({
            kind: 'note',
            id: note.id,
            title: note.title,
            excerpt: excerpt(note.plainText || note.title, query),
            updatedAt: note.updatedAt,
          }),
        );
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchAnnotations(
    value: string,
    limit = 20,
  ): Promise<AnnotationSearchResult[]> {
    const query = normalizeSearchQuery(value);
    try {
      const books = await this.bookRepository.list();
      const bookTitles = new Map(books.map((book) => [book.id, book.title]));
      const annotations = (
        await Promise.all(
          books.map((book) => this.annotationRepository.findByBookId(book.id)),
        )
      ).flat();
      return annotations
        .filter((annotation) => includesQuery(annotation.text, query))
        .slice(0, limit)
        .map((annotation) =>
          annotationSearchResultSchema.parse({
            kind: 'annotation',
            id: annotation.id,
            bookId: annotation.bookId,
            bookTitle: bookTitles.get(annotation.bookId) ?? '未知书籍',
            text: annotation.text,
            chapterHref: annotation.chapterHref,
            locator: annotation.locator,
            createdAt: annotation.createdAt,
          }),
        );
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchBookContent(
    value: string,
    limit = 40,
  ): Promise<BookContentSearchResult[]> {
    const query = normalizeSearchQuery(value);
    try {
      const books = await this.bookRepository.list();
      const bookTitles = new Map(books.map((book) => [book.id, book.title]));
      const matches: WebBookContentRecord[] = [];
      // Stream the index with a cursor so a large library is never loaded
      // into memory at once, and stop as soon as enough chapters match.
      await this.database.iterate('bookContent', (value) => {
        if (matches.length >= limit) return false;
        const chapter = webBookContentRecordSchema.parse(value);
        if (
          includesQuery(chapter.chapterTitle, query) ||
          includesQuery(chapter.text, query)
        ) {
          matches.push(chapter);
        }
        return matches.length < limit;
      });
      return matches.map((chapter) =>
        bookContentSearchResultSchema.parse({
          kind: 'book-content',
          bookId: chapter.bookId,
          bookTitle: bookTitles.get(chapter.bookId) ?? '未知书籍',
          sectionLabel: chapter.chapterTitle,
          locator: chapter.chapterHref.startsWith('pdf-page:')
            ? {
                version: 1,
                format: 'pdf',
                pageIndex: Number(chapter.chapterHref.slice(9)),
              }
            : {
                version: 1,
                format: 'epub',
                chapterHref: chapter.chapterHref,
              },
          excerpt: excerpt(chapter.text, query),
        }),
      );
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async findIndexedBookIds(): Promise<string[]> {
    try {
      const keys = await this.database.getAllKeys('bookContent');
      return [
        ...new Set(
          keys.flatMap((key) =>
            Array.isArray(key) && typeof key[0] === 'string' ? [key[0]] : [],
          ),
        ),
      ];
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async replaceBookContent(
    bookId: string,
    values: BookContentChapter[],
  ): Promise<void> {
    try {
      const chapters = bookContentChapterSchema.array().parse(values);
      await this.database.write([
        { type: 'deleteByBook', store: 'bookContent', bookId },
        ...chapters.map((chapter, ordinal) => ({
          type: 'put' as const,
          store: 'bookContent' as const,
          value: webBookContentRecordSchema.parse({
            ...chapter,
            bookId,
            ordinal,
          }),
        })),
      ]);
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async clearBookContent(): Promise<void> {
    try {
      await this.database.write([{ type: 'clear', store: 'bookContent' }]);
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  rebuildTextIndexes(): Promise<void> {
    // Notes and annotations are already persisted as validated Web domain data.
    return Promise.resolve();
  }
}

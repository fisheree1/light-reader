import { z } from 'zod';

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

const storageKey = 'light-reader-web-book-content-index';
const storedChapterSchema = bookContentChapterSchema.extend({
  bookId: z.string().trim().min(1).max(128),
});
type StoredChapter = z.infer<typeof storedChapterSchema>;

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

  constructor(
    noteRepository: NoteRepository,
    annotationRepository: AnnotationRepository,
    bookRepository: BookRepository,
  ) {
    this.noteRepository = noteRepository;
    this.annotationRepository = annotationRepository;
    this.bookRepository = bookRepository;
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
      return this.readChapters()
        .filter(
          (chapter) =>
            includesQuery(chapter.chapterTitle, query) ||
            includesQuery(chapter.text, query),
        )
        .slice(0, limit)
        .map((chapter) =>
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

  findIndexedBookIds(): Promise<string[]> {
    return Promise.resolve([
      ...new Set(this.readChapters().map((chapter) => chapter.bookId)),
    ]);
  }

  replaceBookContent(
    bookId: string,
    values: BookContentChapter[],
  ): Promise<void> {
    try {
      const chapters = bookContentChapterSchema.array().parse(values);
      const retained = this.readChapters().filter(
        (chapter) => chapter.bookId !== bookId,
      );
      const next = [
        ...retained,
        ...chapters.map((chapter) =>
          storedChapterSchema.parse({ ...chapter, bookId }),
        ),
      ];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        new AppError('SEARCH_INDEX_FAILED', { cause: error }),
      );
    }
  }

  clearBookContent(): Promise<void> {
    localStorage.removeItem(storageKey);
    return Promise.resolve();
  }

  rebuildTextIndexes(): Promise<void> {
    // Notes and annotations are already persisted as validated Web domain data.
    return Promise.resolve();
  }

  private readChapters(): StoredChapter[] {
    const value = localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return storedChapterSchema.array().parse(parsed);
  }
}

export { storageKey as WEB_BOOK_CONTENT_INDEX_KEY };

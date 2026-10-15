import { bookSchema, type Book } from '../../features/library/domain/book';
import { AppError } from '../../lib/app-error';
import {
  getWebDatabase,
  type WebDatabase,
  type WebStoreName,
} from '../web/web-database';
import {
  isConstraintError,
  parseRecords,
  withAppError,
} from '../web/web-repository-support';
import type { BookRepository } from './book-repository';

/** Stores that reference a book and follow SQLite's `ON DELETE CASCADE`. */
const dependentStores: WebStoreName[] = [
  'libraryMetadata',
  'annotations',
  'bookmarks',
  'readingSessions',
  'readerOverrides',
  'readingStates',
  'bookContent',
  'bookChunks',
];

export class WebBookRepository implements BookRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  async create(value: Book): Promise<Book> {
    const book = bookSchema.parse(value);
    try {
      await this.database.write([{ type: 'add', store: 'books', value: book }]);
      return book;
    } catch (error) {
      if (isConstraintError(error)) {
        throw new AppError('DUPLICATE_BOOK', { cause: error });
      }
      throw new AppError('DATABASE_WRITE_FAILED', { cause: error });
    }
  }

  findById(id: string): Promise<Book | null> {
    return withAppError('DATABASE_READ_FAILED', async () => {
      const value = await this.database.get('books', id);
      return value === undefined ? null : bookSchema.parse(value);
    });
  }

  async findByHash(fileHash: string): Promise<Book | null> {
    return (
      (await this.list()).find((book) => book.fileHash === fileHash) ?? null
    );
  }

  list(): Promise<Book[]> {
    return withAppError('DATABASE_READ_FAILED', async () =>
      parseRecords(bookSchema, await this.database.getAll('books')).sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          left.title.localeCompare(right.title),
      ),
    );
  }

  /** Removes the book and every record that depends on it atomically. */
  delete(id: string): Promise<void> {
    return withAppError('DATABASE_WRITE_FAILED', () =>
      this.database.write([
        ...dependentStores.map((store) => ({
          type: 'deleteByBook' as const,
          store,
          bookId: id,
        })),
        { type: 'delete', store: 'books', key: id },
      ]),
    );
  }
}

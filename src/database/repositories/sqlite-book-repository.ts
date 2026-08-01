import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import { mapBookRecord, type BookRecord } from '../schema/book-record';
import type { BookRepository } from './book-repository';
import { bookSchema, type Book } from '../../features/library/domain/book';

type DatabaseProvider = () => Promise<SqlDatabase>;

function isUniqueHashError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed: books.file_hash')
  );
}

export class SqliteBookRepository implements BookRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async create(value: Book): Promise<Book> {
    const book = bookSchema.parse(value);

    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO books (
          id, title, author, format, file_path, file_hash, cover_path,
          metadata_json, file_size, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          book.id,
          book.title,
          book.author,
          book.format,
          book.filePath,
          book.fileHash,
          book.coverPath,
          JSON.stringify(book.metadata),
          book.fileSize,
          book.createdAt,
          book.updatedAt,
        ],
      );
      return book;
    } catch (error) {
      if (isUniqueHashError(error)) {
        throw new AppError('DUPLICATE_BOOK', { cause: error });
      }
      throw new AppError('DATABASE_WRITE_FAILED', { cause: error });
    }
  }

  async findById(id: string): Promise<Book | null> {
    return this.findOne('id', id);
  }

  async findByHash(fileHash: string): Promise<Book | null> {
    return this.findOne('file_hash', fileHash);
  }

  async list(): Promise<Book[]> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookRecord[]>(
        `SELECT id, title, author, format, file_path, file_hash, cover_path,
                metadata_json, file_size, created_at, updated_at
         FROM books
         ORDER BY created_at DESC, title COLLATE NOCASE ASC`,
      );
      return rows.map(mapBookRecord);
    } catch (error) {
      throw new AppError('DATABASE_READ_FAILED', { cause: error });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute('DELETE FROM books WHERE id = $1', [id]);
    } catch (error) {
      throw new AppError('DATABASE_WRITE_FAILED', { cause: error });
    }
  }

  private async findOne(
    field: 'id' | 'file_hash',
    value: string,
  ): Promise<Book | null> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookRecord[]>(
        `SELECT id, title, author, format, file_path, file_hash, cover_path,
                metadata_json, file_size, created_at, updated_at
         FROM books WHERE ${field} = $1 LIMIT 1`,
        [value],
      );
      return rows[0] ? mapBookRecord(rows[0]) : null;
    } catch (error) {
      throw new AppError('DATABASE_READ_FAILED', { cause: error });
    }
  }
}

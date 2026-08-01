import {
  bookListOptionsSchema,
  bookTagSchema,
  normalizeBookTags,
  noteReferenceUpdateSchema,
  type BookListOptions,
  type LibraryBook,
  type NoteReferenceUpdate,
} from '../../features/library/domain/library';
import { extractPlainText } from '../../features/notes/domain/note';
import { AppError, isAppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import {
  bookTagRecordSchema,
  mapLibraryBookRecord,
  type BookTagRecord,
  type LibraryBookRecord,
} from '../schema/library-book-record';
import type { LibraryRepository } from './library-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const bookColumns = `b.id, b.title, b.author, b.format, b.file_path,
  b.file_hash, b.cover_path, b.metadata_json, b.file_size, b.created_at,
  b.updated_at, b.favorite, rs.updated_at AS last_read_at`;

function validId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new AppError('BOOK_NOT_FOUND');
  return id;
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function orderBy(sort: BookListOptions['sort']): string {
  switch (sort) {
    case 'title':
      return 'b.title COLLATE NOCASE ASC, b.created_at DESC';
    case 'added':
      return 'b.created_at DESC, b.title COLLATE NOCASE ASC';
    case 'recent':
      return `CASE WHEN rs.updated_at IS NULL THEN 1 ELSE 0 END,
        rs.updated_at DESC, b.created_at DESC`;
  }
}

export class SqliteLibraryRepository implements LibraryRepository {
  private readonly databaseProvider: DatabaseProvider;
  private readonly now: () => number;

  constructor(
    databaseProvider: DatabaseProvider = getDatabase,
    now: () => number = Date.now,
  ) {
    this.databaseProvider = databaseProvider;
    this.now = now;
  }

  async list(value: BookListOptions): Promise<LibraryBook[]> {
    const options = bookListOptionsSchema.parse(value);
    const where: string[] = [];
    const bindings: unknown[] = [];
    if (options.query) {
      bindings.push(`%${escapeLike(options.query)}%`);
      const binding = `$${String(bindings.length)}`;
      where.push(`(
        b.title LIKE ${binding} ESCAPE '\\' COLLATE NOCASE OR
        COALESCE(b.author, '') LIKE ${binding} ESCAPE '\\' COLLATE NOCASE OR
        EXISTS (
          SELECT 1 FROM book_tags bt
          WHERE bt.book_id = b.id
            AND bt.tag LIKE ${binding} ESCAPE '\\' COLLATE NOCASE
        )
      )`);
    }
    if (options.favoritesOnly) where.push('b.favorite = 1');

    try {
      const database = await this.databaseProvider();
      const rows = await database.select<LibraryBookRecord[]>(
        `SELECT ${bookColumns}
         FROM books b
         LEFT JOIN reading_states rs ON rs.book_id = b.id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY ${orderBy(options.sort)}`,
        bindings,
      );
      return await this.mapRows(database, rows);
    } catch (error) {
      throw new AppError('DATABASE_READ_FAILED', { cause: error });
    }
  }

  async setFavorite(bookId: string, favorite: boolean): Promise<LibraryBook> {
    const id = validId(bookId);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'UPDATE books SET favorite = $1, updated_at = $2 WHERE id = $3',
        [favorite ? 1 : 0, this.now(), id],
      );
      return await this.requireBook(database, id);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOK_UPDATE_FAILED', { cause: error });
    }
  }

  async replaceTags(bookId: string, values: string[]): Promise<LibraryBook> {
    const id = validId(bookId);
    const tags = normalizeBookTags(values);
    try {
      const database = await this.databaseProvider();
      await this.transaction(database, async () => {
        await database.execute('DELETE FROM book_tags WHERE book_id = $1', [
          id,
        ]);
        for (const tag of tags) {
          await database.execute(
            `INSERT INTO book_tags (book_id, tag, created_at)
             VALUES ($1, $2, $3)`,
            [id, bookTagSchema.parse(tag), this.now()],
          );
        }
        await database.execute(
          'UPDATE books SET updated_at = $1 WHERE id = $2',
          [this.now(), id],
        );
      });
      return await this.requireBook(database, id);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOK_UPDATE_FAILED', { cause: error });
    }
  }

  async deleteBook(
    bookId: string,
    values: NoteReferenceUpdate[],
  ): Promise<void> {
    const id = validId(bookId);
    const updates = noteReferenceUpdateSchema.array().parse(values);
    try {
      const database = await this.databaseProvider();
      await this.transaction(database, async () => {
        for (const update of updates) {
          await database.execute(
            `UPDATE notes
             SET content_json = $1, plain_text = $2, updated_at = $3
             WHERE id = $4`,
            [
              JSON.stringify(update.document),
              extractPlainText(update.document),
              this.now(),
              update.id,
            ],
          );
        }
        await database.execute('DELETE FROM books WHERE id = $1', [id]);
      });
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOK_DELETE_FAILED', { cause: error });
    }
  }

  private async requireBook(
    database: SqlDatabase,
    id: string,
  ): Promise<LibraryBook> {
    const rows = await database.select<LibraryBookRecord[]>(
      `SELECT ${bookColumns}
       FROM books b
       LEFT JOIN reading_states rs ON rs.book_id = b.id
       WHERE b.id = $1 LIMIT 1`,
      [id],
    );
    const books = await this.mapRows(database, rows);
    const book = books.at(0);
    if (!book) throw new AppError('BOOK_NOT_FOUND');
    return book;
  }

  private async mapRows(
    database: SqlDatabase,
    rows: LibraryBookRecord[],
  ): Promise<LibraryBook[]> {
    const tagRows = bookTagRecordSchema
      .array()
      .parse(
        await database.select<BookTagRecord[]>(
          'SELECT book_id, tag FROM book_tags ORDER BY tag COLLATE NOCASE ASC',
        ),
      );
    const tagsByBook = new Map<string, string[]>();
    tagRows.forEach((row) => {
      const current = tagsByBook.get(row.book_id) ?? [];
      current.push(row.tag);
      tagsByBook.set(row.book_id, current);
    });
    return rows.map((row) =>
      mapLibraryBookRecord(row, tagsByBook.get(row.id) ?? []),
    );
  }

  private async transaction(
    database: SqlDatabase,
    action: () => Promise<void>,
  ): Promise<void> {
    await database.execute('BEGIN IMMEDIATE');
    try {
      await action();
      await database.execute('COMMIT');
    } catch (error) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
}

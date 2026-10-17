import { bookMetadataSchema } from '../../features/library/domain/book';
import {
  bookDetailsSchema,
  bookListOptionsSchema,
  FINISHED_PROGRESS,
  normalizeBookTags,
  noteReferenceUpdateSchema,
  type BookDetails,
  type BookListOptions,
  type LibraryBook,
  type NoteReferenceUpdate,
} from '../../features/library/domain/library';
import { extractPlainText } from '../../features/notes/domain/note';
import { AppError, isAppError } from '../../lib/app-error';
import {
  deleteBookAtomically,
  replaceTagsAtomically,
  type AtomicBookDelete,
  type AtomicTagReplace,
} from '../atomic-writes';
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
  b.updated_at, b.favorite, rs.updated_at AS last_read_at,
  rs.progression AS progression`;

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
  private readonly atomicBookDelete: AtomicBookDelete;
  private readonly atomicTagReplace: AtomicTagReplace;

  constructor(
    databaseProvider: DatabaseProvider = getDatabase,
    now: () => number = Date.now,
    atomicBookDelete: AtomicBookDelete = deleteBookAtomically,
    atomicTagReplace: AtomicTagReplace = replaceTagsAtomically,
  ) {
    this.databaseProvider = databaseProvider;
    this.now = now;
    this.atomicBookDelete = atomicBookDelete;
    this.atomicTagReplace = atomicTagReplace;
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
        COALESCE(json_extract(b.metadata_json, '$.series.title'), '')
          LIKE ${binding} ESCAPE '\\' COLLATE NOCASE OR
        EXISTS (
          SELECT 1 FROM book_tags bt
          WHERE bt.book_id = b.id
            AND bt.tag LIKE ${binding} ESCAPE '\\' COLLATE NOCASE
        )
      )`);
    }
    if (options.favoritesOnly) where.push('b.favorite = 1');
    const finished = `COALESCE(rs.progression, 0) >= ${String(FINISHED_PROGRESS)}`;
    if (options.status === 'unread') where.push('rs.updated_at IS NULL');
    if (options.status === 'reading')
      where.push(`rs.updated_at IS NOT NULL AND NOT (${finished})`);
    if (options.status === 'finished')
      where.push(`rs.updated_at IS NOT NULL AND ${finished}`);

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
      await this.atomicTagReplace(id, tags, this.now());
      return await this.requireBook(database, id);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOK_UPDATE_FAILED', { cause: error });
    }
  }

  async updateDetails(
    bookId: string,
    value: BookDetails,
  ): Promise<LibraryBook> {
    const id = validId(bookId);
    const details = bookDetailsSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      const book = await this.requireBook(database, id);
      const metadata = bookMetadataSchema.parse({
        ...book.metadata,
        series: details.series,
      });
      // One statement, so the change is atomic without a transaction.
      await database.execute(
        `UPDATE books SET title = $1, author = $2, metadata_json = $3,
           updated_at = $4 WHERE id = $5`,
        [
          details.title,
          details.author,
          JSON.stringify(metadata),
          this.now(),
          id,
        ],
      );
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
      const timestamp = this.now();
      await this.atomicBookDelete(
        id,
        updates.map((update) => ({
          contentJson: JSON.stringify(update.document),
          id: update.id,
          plainText: extractPlainText(update.document),
          updatedAt: timestamp,
        })),
      );
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
}

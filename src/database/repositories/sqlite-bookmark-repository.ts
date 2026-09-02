import {
  bookmarkNameSchema,
  bookmarkSchema,
  type Bookmark,
} from '../../features/reader/domain/bookmark';
import { bookLocatorSchema } from '../../reader-engines/types';
import { AppError, isAppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import type { BookmarkRepository } from './bookmark-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

interface BookmarkRecord {
  id: string;
  book_id: string;
  name: string;
  locator_json: string;
  created_at: number;
  updated_at: number;
}

const columns = 'id, book_id, name, locator_json, created_at, updated_at';

function mapRecord(record: BookmarkRecord): Bookmark {
  return bookmarkSchema.parse({
    id: record.id,
    bookId: record.book_id,
    name: record.name,
    locator: bookLocatorSchema.parse(JSON.parse(record.locator_json)),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

function validId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new AppError('BOOKMARK_NOT_FOUND');
  return id;
}

export class SqliteBookmarkRepository implements BookmarkRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async create(value: Bookmark): Promise<Bookmark> {
    const bookmark = bookmarkSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'INSERT INTO bookmarks (id, book_id, name, locator_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          bookmark.id,
          bookmark.bookId,
          bookmark.name,
          JSON.stringify(bookmark.locator),
          bookmark.createdAt,
          bookmark.updatedAt,
        ],
      );
      return bookmark;
    } catch (error) {
      throw new AppError('BOOKMARK_WRITE_FAILED', { cause: error });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute('DELETE FROM bookmarks WHERE id = $1', [
        validId(id),
      ]);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOKMARK_WRITE_FAILED', { cause: error });
    }
  }

  async listByBook(bookId: string, query = ''): Promise<Bookmark[]> {
    try {
      const database = await this.databaseProvider();
      const id = validId(bookId);
      const search = query.trim();
      const rows = search
        ? await database.select<BookmarkRecord[]>(
            'SELECT ' +
              columns +
              " FROM bookmarks WHERE book_id = $1 AND name LIKE $2 ESCAPE '\\' ORDER BY created_at DESC, id ASC",
            [id, '%' + search.replace(/[\\%_]/g, '\\$&') + '%'],
          )
        : await database.select<BookmarkRecord[]>(
            'SELECT ' +
              columns +
              ' FROM bookmarks WHERE book_id = $1 ORDER BY created_at DESC, id ASC',
            [id],
          );
      return rows.map(mapRecord);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOKMARK_READ_FAILED', { cause: error });
    }
  }

  async rename(id: string, name: string): Promise<Bookmark> {
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'UPDATE bookmarks SET name = $1, updated_at = $2 WHERE id = $3',
        [bookmarkNameSchema.parse(name), Date.now(), validId(id)],
      );
      const rows = await database.select<BookmarkRecord[]>(
        'SELECT ' + columns + ' FROM bookmarks WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!rows[0]) throw new AppError('BOOKMARK_NOT_FOUND');
      return mapRecord(rows[0]);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BOOKMARK_WRITE_FAILED', { cause: error });
    }
  }
}

import {
  bookmarkNameSchema,
  bookmarkSchema,
  type Bookmark,
} from '../../features/reader/domain/bookmark';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { parseRecords, withAppError } from '../web/web-repository-support';
import type { BookmarkRepository } from './bookmark-repository';

export class WebBookmarkRepository implements BookmarkRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  create(value: Bookmark): Promise<Bookmark> {
    return withAppError('BOOKMARK_WRITE_FAILED', async () => {
      const bookmark = bookmarkSchema.parse(value);
      await this.database.write([
        { type: 'put', store: 'bookmarks', value: bookmark },
      ]);
      return bookmark;
    });
  }

  delete(id: string): Promise<void> {
    return withAppError('BOOKMARK_WRITE_FAILED', () =>
      this.database.write([{ type: 'delete', store: 'bookmarks', key: id }]),
    );
  }

  listByBook(bookId: string, query = ''): Promise<Bookmark[]> {
    return withAppError('BOOKMARK_READ_FAILED', async () => {
      const search = query.trim().toLocaleLowerCase();
      return parseRecords(
        bookmarkSchema,
        await this.database.getAllByBook('bookmarks', bookId),
      )
        .filter(
          (bookmark) =>
            !search || bookmark.name.toLocaleLowerCase().includes(search),
        )
        .sort((left, right) => right.createdAt - left.createdAt);
    });
  }

  rename(id: string, name: string): Promise<Bookmark> {
    return withAppError('BOOKMARK_WRITE_FAILED', async () => {
      const stored = await this.database.get('bookmarks', id);
      if (stored === undefined) throw new AppError('BOOKMARK_NOT_FOUND');
      const updated = bookmarkSchema.parse({
        ...bookmarkSchema.parse(stored),
        name: bookmarkNameSchema.parse(name),
        updatedAt: Date.now(),
      });
      await this.database.write([
        { type: 'put', store: 'bookmarks', value: updated },
      ]);
      return updated;
    });
  }
}

import {
  bookmarkNameSchema,
  bookmarkSchema,
  type Bookmark,
} from '../../features/reader/domain/bookmark';
import { AppError } from '../../lib/app-error';
import type { BookmarkRepository } from './bookmark-repository';

const storageKey = 'light-reader-web-bookmarks';
export const WEB_BOOKMARKS_KEY = storageKey;

export class WebBookmarkRepository implements BookmarkRepository {
  create(value: Bookmark): Promise<Bookmark> {
    return this.writeResult(() => {
      const bookmark = bookmarkSchema.parse(value);
      const items = this.read();
      this.write([
        bookmark,
        ...items.filter((item) => item.id !== bookmark.id),
      ]);
      return bookmark;
    });
  }

  delete(id: string): Promise<void> {
    return this.writeResult(() => {
      this.write(this.read().filter((bookmark) => bookmark.id !== id));
    });
  }

  listByBook(bookId: string, query = ''): Promise<Bookmark[]> {
    return this.readResult(() => {
      const search = query.trim().toLocaleLowerCase();
      return this.read()
        .filter(
          (bookmark) =>
            bookmark.bookId === bookId &&
            (!search || bookmark.name.toLocaleLowerCase().includes(search)),
        )
        .sort((left, right) => right.createdAt - left.createdAt);
    });
  }

  rename(id: string, name: string): Promise<Bookmark> {
    return this.writeResult(() => {
      const items = this.read();
      const current = items.find((item) => item.id === id);
      if (!current) throw new AppError('BOOKMARK_NOT_FOUND');
      const updated = bookmarkSchema.parse({
        ...current,
        name: bookmarkNameSchema.parse(name),
        updatedAt: Date.now(),
      });
      this.write(items.map((item) => (item.id === id ? updated : item)));
      return updated;
    });
  }

  private read(): Bookmark[] {
    const value = localStorage.getItem(storageKey);
    return value ? bookmarkSchema.array().parse(JSON.parse(value)) : [];
  }

  private write(items: Bookmark[]): void {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }

  private readResult<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('BOOKMARK_READ_FAILED', { cause: error });
      });
  }

  private writeResult<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('BOOKMARK_WRITE_FAILED', { cause: error });
      });
  }
}

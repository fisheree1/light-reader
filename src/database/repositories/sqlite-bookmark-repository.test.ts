import type { SqlDatabase } from '../client';
import { SqliteBookmarkRepository } from './sqlite-bookmark-repository';

interface BookmarkRow {
  id: string;
  book_id: string;
  name: string;
  locator_json: string;
  created_at: number;
  updated_at: number;
}

class BookmarkDatabase implements SqlDatabase {
  rows: BookmarkRow[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.startsWith('INSERT INTO bookmarks')) {
      this.rows.push({
        id: String(values[0]),
        book_id: String(values[1]),
        name: String(values[2]),
        locator_json: String(values[3]),
        created_at: Number(values[4]),
        updated_at: Number(values[5]),
      });
    } else if (query.startsWith('UPDATE bookmarks')) {
      this.rows = this.rows.map((row) =>
        row.id === values[2]
          ? {
              ...row,
              name: String(values[0]),
              updated_at: Number(values[1]),
            }
          : row,
      );
    } else if (query.startsWith('DELETE FROM bookmarks')) {
      this.rows = this.rows.filter((row) => row.id !== values[0]);
    }
    return Promise.resolve({});
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    let rows = [...this.rows];
    if (query.includes('book_id = $1')) {
      rows = rows.filter((row) => row.book_id === values[0]);
      const searchValue = values[1];
      if (typeof searchValue === 'string') {
        const queryText = searchValue.replaceAll('%', '').toLocaleLowerCase();
        rows = rows.filter((row) =>
          row.name.toLocaleLowerCase().includes(queryText),
        );
      }
      rows.sort((left, right) => right.created_at - left.created_at);
    } else if (query.includes('id = $1')) {
      rows = rows.filter((row) => row.id === values[0]);
    }
    return Promise.resolve(rows as T);
  }
}

describe('SqliteBookmarkRepository', () => {
  it('persists, searches, renames, and deletes versioned bookmarks', async () => {
    const database = new BookmarkDatabase();
    const repository = new SqliteBookmarkRepository(() =>
      Promise.resolve(database),
    );
    const bookmark = {
      id: 'bookmark-1',
      bookId: 'book-1',
      name: '第一处',
      locator: {
        version: 1 as const,
        format: 'epub' as const,
        chapterHref: 'one.xhtml',
        cfi: 'epubcfi(/6/2)',
      },
      createdAt: 1,
      updatedAt: 1,
    };

    await repository.create(bookmark);
    await expect(repository.listByBook('book-1', '第一')).resolves.toEqual([
      bookmark,
    ]);
    await expect(
      repository.rename(bookmark.id, '已重命名'),
    ).resolves.toMatchObject({ name: '已重命名' });
    await repository.delete(bookmark.id);
    await expect(repository.listByBook('book-1')).resolves.toEqual([]);
  });
});

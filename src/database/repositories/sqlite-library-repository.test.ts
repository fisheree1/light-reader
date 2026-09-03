import type { BookListOptions } from '../../features/library/domain/library';
import type { SqlDatabase } from '../client';
import type {
  BookTagRecord,
  LibraryBookRecord,
} from '../schema/library-book-record';
import { SqliteLibraryRepository } from './sqlite-library-repository';

function record(overrides: Partial<LibraryBookRecord> = {}): LibraryBookRecord {
  return {
    id: 'book-1',
    title: 'Alpha',
    author: '作者乙',
    format: 'epub',
    file_path: 'light-reader/books/book-1/book.epub',
    file_hash: 'a'.repeat(64),
    cover_path: null,
    metadata_json: JSON.stringify({
      title: 'Alpha',
      creators: ['作者乙'],
      language: null,
      publisher: null,
      description: null,
      identifier: null,
    }),
    file_size: 10,
    created_at: 10,
    updated_at: 10,
    favorite: 0,
    last_read_at: null,
    ...overrides,
  };
}

class MemoryLibraryDatabase implements SqlDatabase {
  rows: LibraryBookRecord[] = [
    record(),
    record({
      id: 'book-2',
      title: 'Zulu',
      author: 'Author A',
      file_path: 'light-reader/books/book-2/book.epub',
      file_hash: 'b'.repeat(64),
      metadata_json: JSON.stringify({
        title: 'Zulu',
        creators: ['Author A'],
        language: null,
        publisher: null,
        description: null,
        identifier: null,
      }),
      created_at: 20,
      updated_at: 20,
      favorite: 1,
      last_read_at: 30,
    }),
  ];
  tags: BookTagRecord[] = [
    { book_id: 'book-1', tag: '技术' },
    { book_id: 'book-2', tag: '收藏' },
  ];
  readonly executions: { query: string; values: unknown[] }[] = [];
  readonly selections: { query: string; values: unknown[] }[] = [];
  failBookDelete = false;

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    this.executions.push({ query, values });
    if (query.includes('UPDATE books SET favorite')) {
      this.rows = this.rows.map((row) =>
        row.id === values[2]
          ? { ...row, favorite: Number(values[0]) as 0 | 1 }
          : row,
      );
    } else if (query.includes('DELETE FROM book_tags')) {
      this.tags = this.tags.filter((tag) => tag.book_id !== values[0]);
    } else if (query.includes('INSERT INTO book_tags')) {
      this.tags.push({ book_id: String(values[0]), tag: String(values[1]) });
    } else if (query.includes('DELETE FROM books')) {
      if (this.failBookDelete) return Promise.reject(new Error('locked'));
      this.rows = this.rows.filter((row) => row.id !== values[0]);
      this.tags = this.tags.filter((tag) => tag.book_id !== values[0]);
    }
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    this.selections.push({ query, values });
    if (query.includes('SELECT book_id, tag FROM book_tags')) {
      return Promise.resolve([...this.tags] as T);
    }

    let rows = [...this.rows];
    if (query.includes('WHERE b.id =')) {
      rows = rows.filter((row) => row.id === values[0]);
    }
    if (query.includes('b.favorite = 1')) {
      rows = rows.filter((row) => row.favorite === 1);
    }
    if (query.includes('ORDER BY b.title COLLATE NOCASE ASC')) {
      rows.sort((left, right) => left.title.localeCompare(right.title));
    } else if (query.includes('rs.updated_at DESC')) {
      rows.sort((left, right) => {
        if (left.last_read_at === null) return 1;
        if (right.last_read_at === null) return -1;
        return right.last_read_at - left.last_read_at;
      });
    } else if (query.includes('b.created_at DESC')) {
      rows.sort((left, right) => right.created_at - left.created_at);
    }
    return Promise.resolve(rows as T);
  }
}

function options(overrides: Partial<BookListOptions> = {}): BookListOptions {
  return {
    query: '',
    sort: 'recent',
    favoritesOnly: false,
    ...overrides,
  };
}

describe('SqliteLibraryRepository', () => {
  it('maps favorite, tags, and recent reading order safely', async () => {
    const database = new MemoryLibraryDatabase();
    const repository = new SqliteLibraryRepository(
      () => Promise.resolve(database),
      () => 100,
    );

    await expect(repository.list(options())).resolves.toMatchObject([
      { id: 'book-2', favorite: true, tags: ['收藏'], lastReadAt: 30 },
      { id: 'book-1', favorite: false, tags: ['技术'], lastReadAt: null },
    ]);
    await expect(
      repository.list(options({ sort: 'added' })),
    ).resolves.toMatchObject([{ id: 'book-2' }, { id: 'book-1' }]);
    await expect(
      repository.list(options({ sort: 'title' })),
    ).resolves.toMatchObject([{ id: 'book-1' }, { id: 'book-2' }]);
  });

  it('escapes local search input and applies favorite filtering', async () => {
    const database = new MemoryLibraryDatabase();
    const repository = new SqliteLibraryRepository(() =>
      Promise.resolve(database),
    );

    await repository.list(options({ query: '100%_本地', favoritesOnly: true }));

    const selection = database.selections.find((item) =>
      item.query.includes('FROM books b'),
    );
    expect(selection?.query).toContain('EXISTS');
    expect(selection?.query).toContain('b.favorite = 1');
    expect(selection?.values).toEqual(['%100\\%\\_本地%']);
  });

  it('persists favorites and normalized tags', async () => {
    const database = new MemoryLibraryDatabase();
    const repository = new SqliteLibraryRepository(
      () => Promise.resolve(database),
      () => 100,
    );

    await expect(repository.setFavorite('book-1', true)).resolves.toMatchObject(
      { favorite: true },
    );
    await expect(
      repository.replaceTags('book-1', [' 技术 ', '技术', '待读']),
    ).resolves.toMatchObject({ tags: ['技术', '待读'] });
    expect(database.executions.map((item) => item.query.trim())).toEqual(
      expect.arrayContaining(['BEGIN IMMEDIATE', 'COMMIT']),
    );
  });

  it('deletes the book transactionally and rolls back on failure', async () => {
    const database = new MemoryLibraryDatabase();
    const atomicDelete = vi.fn((bookId: string) => {
      if (database.failBookDelete) {
        return Promise.reject(new Error('locked'));
      }
      database.rows = database.rows.filter((row) => row.id !== bookId);
      database.tags = database.tags.filter((tag) => tag.book_id !== bookId);
      return Promise.resolve();
    });
    const repository = new SqliteLibraryRepository(
      () => Promise.resolve(database),
      Date.now,
      atomicDelete,
    );

    database.failBookDelete = true;
    await expect(repository.deleteBook('book-1', [])).rejects.toMatchObject({
      code: 'BOOK_DELETE_FAILED',
    });
    expect(database.rows.some((row) => row.id === 'book-1')).toBe(true);

    database.failBookDelete = false;
    await repository.deleteBook('book-1', []);
    expect(database.rows.some((row) => row.id === 'book-1')).toBe(false);
    expect(atomicDelete).toHaveBeenLastCalledWith('book-1', []);
  });
});

import type { SqlDatabase } from '../client';
import {
  createSearchQuery,
  SqliteSearchRepository,
} from './sqlite-search-repository';

class RecordingSearchDatabase implements SqlDatabase {
  readonly executions: { query: string; values: unknown[] }[] = [];
  readonly selections: { query: string; values: unknown[] }[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    this.executions.push({ query, values });
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    this.selections.push({ query, values });
    if (query.includes('FROM notes_fts')) {
      return Promise.resolve([
        {
          id: 'note-1',
          title: '离线搜索',
          excerpt: '中文搜索内容',
          updated_at: 1,
        },
      ] as T);
    }
    if (query.includes('DISTINCT book_id')) {
      return Promise.resolve([{ book_id: 'book-1' }] as T);
    }
    return Promise.resolve([] as T);
  }
}

describe('SqliteSearchRepository', () => {
  it('quotes FTS input and falls back for short Chinese queries', () => {
    expect(createSearchQuery('local search')).toEqual({
      binding: '"local" AND "search"',
      mode: 'fts',
    });
    expect(createSearchQuery('中文')).toEqual({
      binding: '%中文%',
      mode: 'like',
    });
    expect(createSearchQuery('a%')).toEqual({
      binding: '%a\\%%',
      mode: 'like',
    });
  });

  it('searches through FTS and maps results', async () => {
    const database = new RecordingSearchDatabase();
    const repository = new SqliteSearchRepository(() =>
      Promise.resolve(database),
    );

    await expect(repository.searchNotes('中文搜索')).resolves.toMatchObject([
      { id: 'note-1', kind: 'note' },
    ]);
    expect(database.selections[0]?.values[0]).toBe('"中文搜索"');
  });

  it('replaces EPUB chapters transactionally and rebuilds derived indexes', async () => {
    const database = new RecordingSearchDatabase();
    const repository = new SqliteSearchRepository(() =>
      Promise.resolve(database),
    );

    await repository.replaceBookContent('book-1', [
      {
        chapterHref: 'one.xhtml',
        chapterTitle: '第一章',
        text: '大量正文内容',
      },
    ]);
    await repository.rebuildTextIndexes();

    expect(database.executions.map((item) => item.query.trim())).toEqual(
      expect.arrayContaining([
        'BEGIN IMMEDIATE',
        'DELETE FROM book_content_index WHERE book_id = $1',
        'COMMIT',
        'DELETE FROM notes_fts',
        'DELETE FROM annotations_fts',
      ]),
    );
    await expect(repository.findIndexedBookIds()).resolves.toEqual(['book-1']);
  });
});

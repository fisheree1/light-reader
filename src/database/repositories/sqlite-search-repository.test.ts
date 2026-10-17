import type { AtomicSearchIndexWrites } from '../atomic-writes';
import type { SqlDatabase } from '../client';
import {
  createSearchQuery,
  SqliteSearchRepository,
} from './sqlite-search-repository';

function fakeIndexWrites(
  replaceBookContent: AtomicSearchIndexWrites['replaceBookContent'] = () =>
    Promise.resolve(),
  rebuildTextIndexes: AtomicSearchIndexWrites['rebuildTextIndexes'] = () =>
    Promise.resolve(),
) {
  return {
    replaceBookContent: vi.fn(replaceBookContent),
    rebuildTextIndexes: vi.fn(rebuildTextIndexes),
  };
}

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

  it('replaces EPUB chapters and rebuilds derived indexes through atomic commands', async () => {
    const database = new RecordingSearchDatabase();
    const writes = fakeIndexWrites();
    const repository = new SqliteSearchRepository(
      () => Promise.resolve(database),
      writes,
    );
    const chapter = {
      chapterHref: 'one.xhtml',
      chapterTitle: '第一章',
      text: '大量正文内容',
    };

    await repository.replaceBookContent(' book-1 ', [chapter]);
    await repository.rebuildTextIndexes();

    expect(writes.replaceBookContent).toHaveBeenCalledWith('book-1', [chapter]);
    expect(writes.rebuildTextIndexes).toHaveBeenCalledOnce();
    // Statement-by-statement transactions would split across the plugin's
    // pooled connections, so none may run through the SQL plugin.
    expect(database.executions).toEqual([]);
    await expect(repository.findIndexedBookIds()).resolves.toEqual(['book-1']);
  });

  it('handles quoting and LIKE escaping in query building', () => {
    expect(createSearchQuery('say "hello"')).toEqual({
      binding: '"say" AND """hello"""',
      mode: 'fts',
    });
    expect(createSearchQuery('_\\')).toEqual({
      binding: '%\\_\\\\%',
      mode: 'like',
    });
  });
});

/** Answers each SELECT with the rows of the first matching SQL fragment. */
class ScriptedSearchDatabase implements SqlDatabase {
  readonly executions: string[] = [];
  readonly selections: { query: string; values: unknown[] }[] = [];
  failExecute: ((query: string) => boolean) | null = null;
  failSelect = false;
  private readonly rows: [fragment: string, rows: unknown[]][];

  constructor(rows: [fragment: string, rows: unknown[]][]) {
    this.rows = rows;
  }

  execute(query: string): Promise<unknown> {
    this.executions.push(query.trim());
    if (this.failExecute?.(query.trim())) {
      return Promise.reject(new Error('disk I/O error'));
    }
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    this.selections.push({ query, values });
    if (this.failSelect) return Promise.reject(new Error('database locked'));
    const match = this.rows.find(([fragment]) => query.includes(fragment));
    return Promise.resolve((match?.[1] ?? []) as T);
  }
}

function createRepository(
  database: SqlDatabase,
  writes: AtomicSearchIndexWrites = fakeIndexWrites(),
) {
  return new SqliteSearchRepository(() => Promise.resolve(database), writes);
}

const annotationRow = {
  id: 'annotation-1',
  book_id: 'book-1',
  book_title: '测试书',
  text: 'important highlight',
  chapter_href: 'one.xhtml',
  locator_json: JSON.stringify({
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2)',
  }),
  created_at: 1,
};

describe('SqliteSearchRepository query modes', () => {
  it('searches books with an escaped LIKE pattern and a validated limit', async () => {
    const database = new ScriptedSearchDatabase([
      [
        'FROM books b',
        [{ id: 'book-1', title: '测试书', author: null, format: 'pdf' }],
      ],
    ]);
    const repository = createRepository(database);

    await expect(repository.searchBooks('50%', 5)).resolves.toEqual([
      {
        kind: 'book',
        id: 'book-1',
        title: '测试书',
        author: null,
        format: 'pdf',
      },
    ]);
    expect(database.selections[0]?.values).toEqual(['%50\\%%', 5]);
    await expect(repository.searchBooks('书', 0)).rejects.toThrow();
    await expect(repository.searchBooks('书', 101)).rejects.toThrow();
  });

  it('uses LIKE for short note queries and falls back to the title excerpt', async () => {
    const database = new ScriptedSearchDatabase([
      [
        'FROM notes\n',
        [{ id: 'note-1', title: '短', excerpt: null, updated_at: 3 }],
      ],
    ]);

    await expect(
      createRepository(database).searchNotes('短'),
    ).resolves.toMatchObject([{ id: 'note-1', excerpt: '短' }]);
    expect(database.selections[0]?.query).toContain('plain_text LIKE $1');
    expect(database.selections[0]?.values).toEqual(['%短%', 20]);
  });

  it('searches annotations through FTS and LIKE and parses locators', async () => {
    const database = new ScriptedSearchDatabase([
      ['FROM annotations_fts', [annotationRow]],
      ['FROM annotations a', [{ ...annotationRow, id: 'annotation-2' }]],
    ]);
    const repository = createRepository(database);

    await expect(
      repository.searchAnnotations('important highlight'),
    ).resolves.toMatchObject([
      {
        kind: 'annotation',
        id: 'annotation-1',
        locator: { cfi: 'epubcfi(/6/2)' },
      },
    ]);
    await expect(repository.searchAnnotations('im')).resolves.toMatchObject([
      { id: 'annotation-2' },
    ]);
    expect(database.selections[1]?.query).toContain('a.text LIKE $1');
  });

  it('maps EPUB and PDF content hits in both query modes', async () => {
    const database = new ScriptedSearchDatabase([
      [
        'MATCH $1',
        [
          {
            book_id: 'book-1',
            book_title: 'EPUB 书',
            book_format: 'epub',
            chapter_href: 'one.xhtml',
            chapter_title: '第一章',
            excerpt: '…命中内容…',
          },
        ],
      ],
      [
        'book_content_index.text LIKE',
        [
          {
            book_id: 'book-2',
            book_title: 'PDF 书',
            book_format: 'pdf',
            chapter_href: 'pdf-page:4',
            chapter_title: '第 5 页',
            excerpt: null,
          },
        ],
      ],
    ]);
    const repository = createRepository(database);

    await expect(repository.searchBookContent('命中内容')).resolves.toEqual([
      {
        kind: 'book-content',
        bookId: 'book-1',
        bookTitle: 'EPUB 书',
        sectionLabel: '第一章',
        locator: { version: 1, format: 'epub', chapterHref: 'one.xhtml' },
        excerpt: '…命中内容…',
      },
    ]);
    await expect(repository.searchBookContent('命中', 10)).resolves.toEqual([
      {
        kind: 'book-content',
        bookId: 'book-2',
        bookTitle: 'PDF 书',
        sectionLabel: '第 5 页',
        locator: { version: 1, format: 'pdf', pageIndex: 4 },
        excerpt: '第 5 页',
      },
    ]);
  });

  it('maps database and row failures to SEARCH_FAILED', async () => {
    const failing = new ScriptedSearchDatabase([]);
    failing.failSelect = true;
    const repository = createRepository(failing);

    for (const search of [
      () => repository.searchBooks('书'),
      () => repository.searchNotes('笔记内容'),
      () => repository.searchAnnotations('高亮'),
      () => repository.searchBookContent('正文'),
    ]) {
      await expect(search()).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    }

    const corrupt = new ScriptedSearchDatabase([
      ['FROM annotations a', [{ ...annotationRow, locator_json: '{' }]],
    ]);
    await expect(
      createRepository(corrupt).searchAnnotations('高亮'),
    ).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });
});

describe('SqliteSearchRepository index maintenance', () => {
  it('rejects invalid book ids before touching the database', async () => {
    const database = new ScriptedSearchDatabase([]);
    const writes = fakeIndexWrites();
    const repository = createRepository(database, writes);

    await expect(repository.replaceBookContent('  ', [])).rejects.toMatchObject(
      { code: 'SEARCH_INDEX_FAILED' },
    );
    await expect(
      repository.replaceBookContent('x'.repeat(129), []),
    ).rejects.toMatchObject({ code: 'SEARCH_INDEX_FAILED' });
    expect(database.executions).toEqual([]);
    expect(writes.replaceBookContent).not.toHaveBeenCalled();
  });

  it('maps failed atomic index writes to SEARCH_INDEX_FAILED with the cause', async () => {
    const database = new ScriptedSearchDatabase([]);
    const writes = fakeIndexWrites(
      () => Promise.reject(new Error('database is locked')),
      () => Promise.reject(new Error('disk I/O error')),
    );
    const repository = createRepository(database, writes);

    await expect(
      repository.replaceBookContent('book-1', [
        { chapterHref: 'one.xhtml', chapterTitle: '第一章', text: '正文' },
      ]),
    ).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
      cause: { message: 'database is locked' },
    });
    await expect(repository.rebuildTextIndexes()).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
      cause: { message: 'disk I/O error' },
    });
    expect(database.executions).toEqual([]);
  });

  it('clears the content index and maps clear and listing failures', async () => {
    const database = new ScriptedSearchDatabase([
      ['DISTINCT book_id', [{ book_id: '' }]],
    ]);
    const repository = createRepository(database);

    await repository.clearBookContent();
    expect(database.executions).toEqual(['DELETE FROM book_content_index']);
    await expect(repository.findIndexedBookIds()).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
    });

    database.failExecute = () => true;
    await expect(repository.clearBookContent()).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
    });
  });

  it('fails clearly when the database cannot be opened', async () => {
    const writes = fakeIndexWrites();
    const repository = new SqliteSearchRepository(
      () => Promise.reject(new Error('missing plugin')),
      writes,
    );

    await expect(repository.findIndexedBookIds()).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
    });
    await expect(repository.rebuildTextIndexes()).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
    });
    expect(writes.rebuildTextIndexes).not.toHaveBeenCalled();
  });
});

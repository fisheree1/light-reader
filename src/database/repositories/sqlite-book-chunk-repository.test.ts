import type { AtomicChunkReplace } from '../atomic-writes';
import type { SqlDatabase } from '../client';
import type { BookChunk } from '../../features/ai-agent/retrieval/book-retrieval';
import { SqliteBookChunkRepository } from './sqlite-book-chunk-repository';

const chunk: BookChunk = {
  schemaVersion: 1,
  id: 'chunk-one',
  bookId: 'book-1',
  sourceFileHash: 'a'.repeat(64),
  chapterHref: 'one.xhtml',
  chapterTitle: '第一章',
  startLocator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    progression: 0.2,
  },
  endLocator: null,
  text: '本地优先的阅读内容',
  textHash: 'fnv1a-deadbeef',
  estimatedTokens: 10,
  ordinal: 0,
};

const row = {
  schema_version: chunk.schemaVersion,
  chunk_id: chunk.id,
  book_id: chunk.bookId,
  source_file_hash: chunk.sourceFileHash,
  chapter_href: chunk.chapterHref,
  chapter_title: chunk.chapterTitle,
  start_locator_json: JSON.stringify(chunk.startLocator),
  end_locator_json: null,
  text: chunk.text,
  text_hash: chunk.textHash,
  estimated_tokens: chunk.estimatedTokens,
  ordinal: chunk.ordinal,
  score: 0.5,
};

class RecordingDatabase implements SqlDatabase {
  readonly executions: { query: string; values: unknown[] }[] = [];
  readonly selections: { query: string; values: unknown[] }[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    this.executions.push({ query, values });
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    this.selections.push({ query, values });
    if (query.includes('source_file_hash FROM')) {
      return Promise.resolve([{ source_file_hash: chunk.sourceFileHash }] as T);
    }
    return Promise.resolve([row] as T);
  }
}

describe('SqliteBookChunkRepository', () => {
  it('replaces one book index through one atomic command and maps stored locators', async () => {
    const database = new RecordingDatabase();
    const replaceChunks = vi.fn<AtomicChunkReplace>(() => Promise.resolve());
    const repository = new SqliteBookChunkRepository(
      () => Promise.resolve(database),
      replaceChunks,
    );

    await repository.replaceBookChunks(chunk.bookId, [chunk]);
    await expect(repository.findById(chunk.bookId, chunk.id)).resolves.toEqual(
      chunk,
    );
    await expect(repository.getIndexedSourceHash(chunk.bookId)).resolves.toBe(
      chunk.sourceFileHash,
    );

    expect(replaceChunks).toHaveBeenCalledWith(chunk.bookId, [
      {
        schemaVersion: row.schema_version,
        chunkId: row.chunk_id,
        bookId: row.book_id,
        sourceFileHash: row.source_file_hash,
        chapterHref: row.chapter_href,
        chapterTitle: row.chapter_title,
        startLocatorJson: row.start_locator_json,
        endLocatorJson: null,
        text: row.text,
        textHash: row.text_hash,
        estimatedTokens: row.estimated_tokens,
        ordinal: row.ordinal,
      },
    ]);
    expect(database.executions).toEqual([]);
  });

  it('serializes end locators and maps command failures to SEARCH_INDEX_FAILED', async () => {
    const endLocator = { ...chunk.startLocator, progression: 0.4 };
    const replaceChunks = vi.fn(() =>
      Promise.reject(new Error('database is locked')),
    );
    const repository = new SqliteBookChunkRepository(
      () => Promise.resolve(new RecordingDatabase()),
      replaceChunks,
    );

    await expect(
      repository.replaceBookChunks(chunk.bookId, [{ ...chunk, endLocator }]),
    ).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
      cause: { message: 'database is locked' },
    });
    expect(replaceChunks).toHaveBeenCalledWith(chunk.bookId, [
      expect.objectContaining({ endLocatorJson: JSON.stringify(endLocator) }),
    ]);
    await expect(
      repository.replaceBookChunks('book-2', [chunk]),
    ).rejects.toMatchObject({ code: 'SEARCH_INDEX_FAILED' });
    expect(replaceChunks).toHaveBeenCalledOnce();
  });

  it('always scopes FTS and short-term fallback searches to one book', async () => {
    const database = new RecordingDatabase();
    const repository = new SqliteBookChunkRepository(() =>
      Promise.resolve(database),
    );

    await expect(
      repository.searchBookChunks('book-1', ['本地优'], 4),
    ).resolves.toMatchObject([{ chunk: { id: chunk.id }, score: 0.5 }]);
    await repository.searchBookChunks('book-1', ['AI'], 4);

    expect(database.selections[0]).toMatchObject({
      values: ['"本地优"', 'book-1', 4],
    });
    expect(database.selections[0]?.query).toContain('book_id = $2');
    expect(database.selections[1]).toMatchObject({
      values: ['book-1', '%AI%', 4],
    });
    expect(database.selections[1]?.query).toContain('book_id = $1');
  });

  it('取消后不再写入索引', async () => {
    const controller = new AbortController();
    controller.abort();
    const database = new RecordingDatabase();
    const replaceChunks = vi.fn(() => Promise.resolve());
    const repository = new SqliteBookChunkRepository(
      () => Promise.resolve(database),
      replaceChunks,
    );

    await expect(
      repository.replaceBookChunks(chunk.bookId, [chunk], controller.signal),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    expect(replaceChunks).not.toHaveBeenCalled();
    expect(database.executions).toEqual([]);
  });
});

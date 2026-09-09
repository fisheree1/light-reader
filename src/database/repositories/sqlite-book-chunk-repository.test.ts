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
  it('replaces one book index in a transaction and maps stored locators', async () => {
    const database = new RecordingDatabase();
    const repository = new SqliteBookChunkRepository(() =>
      Promise.resolve(database),
    );

    await repository.replaceBookChunks(chunk.bookId, [chunk]);
    await expect(repository.findById(chunk.bookId, chunk.id)).resolves.toEqual(
      chunk,
    );
    await expect(repository.getIndexedSourceHash(chunk.bookId)).resolves.toBe(
      chunk.sourceFileHash,
    );

    expect(database.executions.map(({ query }) => query.trim())).toEqual(
      expect.arrayContaining([
        'BEGIN IMMEDIATE',
        'DELETE FROM ai_book_chunks WHERE book_id = $1',
        'COMMIT',
      ]),
    );
    expect(
      database.executions.some(({ query }) =>
        query.includes('INSERT INTO ai_book_chunks'),
      ),
    ).toBe(true);
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
});

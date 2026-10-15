import type { BookChunk } from '../../features/ai-agent/retrieval/book-retrieval';
import { createTestWebDatabase } from '../../test/fixtures/web-records';
import { WebBookChunkRepository } from './web-book-chunk-repository';

function createChunk(overrides: Partial<BookChunk> = {}): BookChunk {
  return {
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
    ...overrides,
  };
}

describe('WebBookChunkRepository', () => {
  it('replaces one book index and keeps other books intact', async () => {
    const repository = new WebBookChunkRepository(createTestWebDatabase());
    await repository.replaceBookChunks('book-1', [createChunk()]);
    await repository.replaceBookChunks('book-2', [
      createChunk({ bookId: 'book-2', sourceFileHash: 'b'.repeat(64) }),
    ]);

    await expect(repository.getIndexedSourceHash('book-1')).resolves.toBe(
      'a'.repeat(64),
    );
    await expect(
      repository.findById('book-1', 'chunk-one'),
    ).resolves.toMatchObject({ startLocator: { progression: 0.2 } });

    await repository.replaceBookChunks('book-1', [
      createChunk({ id: 'chunk-two', sourceFileHash: 'c'.repeat(64) }),
    ]);
    await expect(
      repository.findById('book-1', 'chunk-one'),
    ).resolves.toBeNull();
    await expect(repository.getIndexedSourceHash('book-1')).resolves.toBe(
      'c'.repeat(64),
    );
    await expect(repository.getIndexedSourceHash('book-2')).resolves.toBe(
      'b'.repeat(64),
    );
    await expect(repository.getIndexedSourceHash('book-3')).resolves.toBeNull();
  });

  it('scopes scored searches to one book and caps the limit', async () => {
    const repository = new WebBookChunkRepository(createTestWebDatabase());
    await repository.replaceBookChunks(
      'book-1',
      Array.from({ length: 10 }, (_, ordinal) =>
        createChunk({
          id: `chunk-${String(ordinal)}`,
          ordinal,
          text: ordinal === 5 ? '阅读 阅读 内容' : '阅读内容',
        }),
      ),
    );
    await repository.replaceBookChunks('book-2', [
      createChunk({ bookId: 'book-2', text: '阅读 阅读 阅读' }),
    ]);

    const matches = await repository.searchBookChunks('book-1', ['阅读'], 50);
    expect(matches).toHaveLength(8);
    expect(matches.every((match) => match.chunk.bookId === 'book-1')).toBe(
      true,
    );
    await expect(
      repository.searchBookChunks('book-1', ['不存在'], 3),
    ).resolves.toEqual([]);
  });

  it('rejects cancelled, mismatched, and invalid requests', async () => {
    const repository = new WebBookChunkRepository(createTestWebDatabase());
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.replaceBookChunks(
        'book-1',
        [createChunk()],
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    await expect(
      repository.replaceBookChunks('book-2', [createChunk()]),
    ).rejects.toMatchObject({ code: 'SEARCH_INDEX_FAILED' });
    await expect(repository.getIndexedSourceHash(' ')).rejects.toMatchObject({
      code: 'SEARCH_INDEX_FAILED',
    });
    await expect(repository.findById('', 'chunk')).rejects.toMatchObject({
      code: 'SEARCH_FAILED',
    });
    await expect(
      repository.searchBookChunks('book-1', ['a'], 3),
    ).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
    await expect(repository.getIndexedSourceHash('book-1')).resolves.toBeNull();
  });
});

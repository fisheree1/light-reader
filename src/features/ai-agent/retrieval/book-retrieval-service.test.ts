import { describe, expect, it, vi } from 'vitest';

import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import type { Book } from '../../library/domain/book';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
import type { BookTextExtractor } from './book-text-extractor';
import { BookRetrievalService } from './book-retrieval-service';
import type { BookChunk } from './book-retrieval';

const book: Book = {
  id: 'book-1',
  title: '索引测试书',
  author: null,
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '索引测试书',
    creators: [],
    language: 'zh-CN',
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 100,
  createdAt: 1,
  updatedAt: 1,
};

function createDependencies(indexedHash: string | null = null) {
  const stored: BookChunk[] = [];
  const replaceBookChunks = vi.fn(
    (_bookId: string, chunks: BookChunk[]): Promise<void> => {
      stored.splice(0, stored.length, ...chunks);
      return Promise.resolve();
    },
  );
  const searchBookChunks = vi.fn(() =>
    Promise.resolve(
      stored.map((chunk) => ({
        chunk,
        score: 1,
      })),
    ),
  );
  const repository: BookChunkRepository = {
    findById: () => Promise.resolve(null),
    getIndexedSourceHash: vi.fn(() => Promise.resolve(indexedHash)),
    replaceBookChunks,
    searchBookChunks,
  };
  const read = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]).buffer));
  const source: ReaderBookSource = {
    read,
  };
  const extractor: BookTextExtractor = {
    extract: vi.fn(() =>
      Promise.resolve([
        {
          chapterHref: 'chapter.xhtml',
          chapterTitle: '第一章',
          locator: {
            version: 1 as const,
            format: 'epub' as const,
            chapterHref: 'chapter.xhtml',
          },
          ordinal: 0,
          text: '本地优先能够让用户控制自己的阅读数据。',
        },
      ]),
    ),
  };
  return { extractor, read, replaceBookChunks, repository, source };
}

describe('BookRetrievalService', () => {
  it('首次检索时报告可见阶段，并完成本地索引与搜索', async () => {
    const dependencies = createDependencies();
    const stages: string[] = [];
    const service = new BookRetrievalService(
      dependencies.repository,
      dependencies.source,
      dependencies.extractor,
    );

    const passages = await service.retrieve(book, '本地优先', 6, {
      onProgress: (progress) => stages.push(progress.stage),
    });

    expect(passages[0]?.text).toContain('阅读数据');
    expect(stages).toEqual([
      'reading-source',
      'extracting-text',
      'chunking-text',
      'writing-index',
      'ready',
      'searching-index',
    ]);
    expect(dependencies.replaceBookChunks).toHaveBeenCalledOnce();
  });

  it('手动重建不会因现有索引命中而跳过', async () => {
    const dependencies = createDependencies(book.fileHash);
    const service = new BookRetrievalService(
      dependencies.repository,
      dependencies.source,
      dependencies.extractor,
    );

    await service.rebuildIndex(book);

    expect(dependencies.read).toHaveBeenCalledOnce();
    expect(dependencies.replaceBookChunks).toHaveBeenCalledOnce();
  });

  it('取消时停止在写入之前，不留下部分索引', async () => {
    const controller = new AbortController();
    const dependencies = createDependencies();
    dependencies.extractor.extract = vi.fn(() => {
      controller.abort();
      return Promise.resolve([]);
    });
    const service = new BookRetrievalService(
      dependencies.repository,
      dependencies.source,
      dependencies.extractor,
    );

    await expect(
      service.rebuildIndex(book, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    expect(dependencies.replaceBookChunks).not.toHaveBeenCalled();
  });
});

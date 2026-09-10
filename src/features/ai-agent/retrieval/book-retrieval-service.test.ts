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

  it('跨书检索保持来源隔离并为每本书限制候选数量', async () => {
    const second = {
      ...book,
      id: 'book-2',
      title: '第二本书',
      filePath: 'light-reader/books/book-2/book.epub',
      fileHash: 'b'.repeat(64),
    };
    const repository: BookChunkRepository = {
      findById: () => Promise.resolve(null),
      getIndexedSourceHash: (bookId) =>
        Promise.resolve(bookId === book.id ? book.fileHash : second.fileHash),
      replaceBookChunks: () => Promise.resolve(),
      searchBookChunks: () => Promise.resolve([]),
    };
    const candidate = {
      retrieve: (bookId: string) =>
        Promise.resolve([
          {
            chunk: {
              schemaVersion: 1 as const,
              id: `chunk-${bookId}`,
              bookId,
              sourceFileHash:
                bookId === book.id ? book.fileHash : second.fileHash,
              chapterHref: 'chapter.xhtml',
              chapterTitle: '章节',
              startLocator: {
                version: 1 as const,
                format: 'epub' as const,
                chapterHref: 'chapter.xhtml',
              },
              endLocator: null,
              text: `${bookId} 的共同观点是本地优先。`,
              textHash: `fnv1a-${bookId}`,
              estimatedTokens: 10,
              ordinal: 0,
            },
            score: bookId === book.id ? 2 : 1,
          },
        ]),
    };
    const service = new BookRetrievalService(
      repository,
      { read: () => Promise.reject(new Error('index is current')) },
      { extract: () => Promise.resolve([]) },
      undefined,
      candidate,
    );

    const passages = await service.retrieveAcrossBooks(
      [book, second],
      '共同观点',
    );
    expect(passages.map((passage) => passage.bookId)).toEqual([
      'book-1',
      'book-2',
    ]);
  });
});

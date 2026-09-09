import { describe, expect, it, vi } from 'vitest';

import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import type { Book } from '../../library/domain/book';
import type {
  AgentModelRequest,
  AgentProviderEvent,
  ModelProviderGateway,
} from '../../../platform/ai/model-provider-gateway';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
import { defaultAiSettings } from '../domain/ai-settings';
import type { BookTextExtractor } from '../retrieval/book-text-extractor';
import { BookRetrievalService } from '../retrieval/book-retrieval-service';
import type { BookChunk } from '../retrieval/book-retrieval';
import { BookQaRunner } from './book-qa-runner';

const book: Book = {
  id: 'book-1',
  title: '公共领域测试书',
  author: '作者',
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '公共领域测试书',
    creators: ['作者'],
    language: 'zh-CN',
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 100,
  createdAt: 1,
  updatedAt: 1,
};

function createRetrieval(searchResults = true) {
  const chunk: BookChunk = {
    schemaVersion: 1,
    id: 'chunk-one',
    bookId: book.id,
    sourceFileHash: book.fileHash,
    chapterHref: 'chapter.xhtml',
    chapterTitle: '第一章',
    startLocator: {
      version: 1,
      format: 'epub',
      chapterHref: 'chapter.xhtml',
      progression: 0.25,
    },
    endLocator: null,
    text: '核心观点是本地优先，并且用户应当明确授权。',
    textHash: 'fnv1a-deadbeef',
    estimatedTokens: 24,
    ordinal: 0,
  };
  const repository: BookChunkRepository = {
    findById: () => Promise.resolve(chunk),
    getIndexedSourceHash: () => Promise.resolve(book.fileHash),
    replaceBookChunks: () => Promise.resolve(),
    searchBookChunks: () =>
      Promise.resolve(searchResults ? [{ chunk, score: 1 }] : []),
  };
  const source: ReaderBookSource = {
    read: () => Promise.reject(new Error('index should already be current')),
  };
  const extractor: BookTextExtractor = {
    extract: () => Promise.resolve([]),
  };
  return new BookRetrievalService(repository, source, extractor);
}

function createProvider(captured: AgentModelRequest[]): ModelProviderGateway {
  return {
    capabilities: {
      streaming: true,
      structuredOutput: false,
      functionTools: false,
    },
    getStatus: () =>
      Promise.resolve({ available: true, errorCode: null, models: [] }),
    async *run(request): AsyncIterable<AgentProviderEvent> {
      await Promise.resolve();
      captured.push(request);
      yield { type: 'output-delta', delta: '答案来自本书依据 [S1]。' };
      yield { type: 'completed' };
    },
  };
}

describe('BookQaRunner', () => {
  it('answers from bounded passages and produces verified locators', async () => {
    const captured: AgentModelRequest[] = [];
    let id = 0;
    const runner = new BookQaRunner(
      createProvider(captured),
      createRetrieval(),
      undefined,
      undefined,
      () => `id-${String((id += 1))}`,
      () => 100,
    );

    const result = await runner.run(
      book,
      '核心观点是什么？',
      { ...defaultAiSettings, enabled: true },
      new AbortController().signal,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.prompt).toContain('<USER_QUESTION>');
    expect(captured[0]?.prompt).toContain('[S1] 第一章');
    expect(result.run).toMatchObject({
      task: 'book-qa',
      status: 'completed',
      toolCallCount: 1,
    });
    expect(result.trace[0]).toMatchObject({
      name: 'search_books',
      status: 'completed',
    });
    expect(result.draft.citations[0]).toMatchObject({
      bookId: book.id,
      validation: 'verified',
      chapterTitleSnapshot: '第一章',
      locator: { format: 'epub', chapterHref: 'chapter.xhtml' },
    });
  });

  it('does not call the model when local retrieval finds no evidence', async () => {
    const captured: AgentModelRequest[] = [];
    const provider = createProvider(captured);
    const run = vi.spyOn(provider, 'run');
    const runner = new BookQaRunner(provider, createRetrieval(false));

    await expect(
      runner.run(
        book,
        '完全无关的问题',
        { ...defaultAiSettings, enabled: true },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_NO_EVIDENCE' });
    expect(run).not.toHaveBeenCalled();
  });
});

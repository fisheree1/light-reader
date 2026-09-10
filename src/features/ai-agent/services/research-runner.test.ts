import { describe, expect, it, vi } from 'vitest';

import type { ModelProviderGateway } from '../../../platform/ai/model-provider-gateway';
import type { Book } from '../../library/domain/book';
import { defaultAiSettings } from '../domain/ai-settings';
import type { BookRetrievalService } from '../retrieval/book-retrieval-service';
import { ResearchRunner } from './research-runner';

function book(id: string, hashCharacter: string): Book {
  return {
    id,
    title: `图书 ${id}`,
    author: null,
    format: 'epub',
    filePath: `light-reader/books/${id}/book.epub`,
    fileHash: hashCharacter.repeat(64),
    coverPath: null,
    metadata: {
      title: `图书 ${id}`,
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
}

describe('ResearchRunner', () => {
  it('uses bounded local expansion and returns citations from selected books', async () => {
    const books = [book('one', 'a'), book('two', 'b')];
    const provider: ModelProviderGateway = {
      capabilities: {
        streaming: true,
        structuredOutput: false,
        functionTools: false,
      },
      getStatus: () =>
        Promise.resolve({ available: true, errorCode: null, models: [] }),
      async *run(request) {
        await Promise.resolve();
        yield {
          type: 'output-delta',
          delta: request.systemPrompt.includes('查询规划器')
            ? '离线阅读\n隐私保护'
            : '两本书都强调本地处理 [S1]，第二本进一步讨论隐私 [S2]。',
        };
        yield { type: 'completed' };
      },
    };
    const retrieveAcrossBooks = vi.fn(() =>
      Promise.resolve(
        books.map((item, index) => ({
          schemaVersion: 1 as const,
          id: `passage-${item.id}`,
          bookId: item.id,
          sourceFileHash: item.fileHash,
          chapterHref: 'chapter.xhtml',
          chapterTitle: `第 ${String(index + 1)} 章`,
          startLocator: {
            version: 1 as const,
            format: 'epub' as const,
            chapterHref: 'chapter.xhtml',
          },
          endLocator: null,
          text: `${item.title} 强调本地处理和隐私。`,
          textHash: `fnv1a-${item.id}`,
          estimatedTokens: 12,
          ordinal: 0,
          sourceChunkIds: [`chunk-${item.id}`],
          score: 1,
        })),
      ),
    );
    const retrieval = {
      retrieveAcrossBooks,
      retrieve: () => Promise.resolve([]),
      readChunk: () => Promise.resolve(null),
    } as unknown as BookRetrievalService;
    let nextId = 0;
    const runner = new ResearchRunner(
      provider,
      retrieval,
      () => `id-${String((nextId += 1))}`,
      () => 100,
    );

    const result = await runner.run(
      books,
      '比较本地处理方式',
      { ...defaultAiSettings, enabled: true },
      new AbortController().signal,
    );

    expect(retrieveAcrossBooks).toHaveBeenCalledWith(
      books,
      '比较本地处理方式',
      8,
      expect.objectContaining({ semanticTerms: ['离线阅读', '隐私保护'] }),
    );
    expect(result.draft.task).toBe('research');
    expect(result.draft.citations.map((citation) => citation.bookId)).toEqual([
      'one',
      'two',
    ]);
  });
});

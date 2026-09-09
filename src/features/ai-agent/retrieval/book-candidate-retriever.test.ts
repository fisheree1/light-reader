import { describe, expect, it } from 'vitest';

import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import type { BookChunk } from './book-retrieval';
import { scoreBookChunkTerms } from './book-retrieval';
import {
  buildBookQueryPlan,
  LocalHybridBookCandidateRetriever,
} from './book-candidate-retriever';

function chunk(id: string, text: string, ordinal: number): BookChunk {
  return {
    schemaVersion: 1,
    id,
    bookId: 'book-1',
    sourceFileHash: 'a'.repeat(64),
    chapterHref: `${id}.xhtml`,
    chapterTitle: `章节 ${String(ordinal + 1)}`,
    startLocator: {
      version: 1,
      format: 'epub',
      chapterHref: `${id}.xhtml`,
    },
    endLocator: null,
    text,
    textHash: `fnv1a-${String(ordinal).padStart(8, '0')}`,
    estimatedTokens: Math.max(1, Math.ceil(text.length / 2)),
    ordinal,
  };
}

function createRepository(chunks: BookChunk[]): BookChunkRepository {
  return {
    findById: () => Promise.resolve(null),
    getIndexedSourceHash: () => Promise.resolve(null),
    replaceBookChunks: () => Promise.resolve(),
    searchBookChunks: (_bookId, terms, limit) =>
      Promise.resolve(
        chunks
          .map((candidate) => ({
            chunk: candidate,
            score: scoreBookChunkTerms(candidate.text, terms),
          }))
          .filter((match) => match.score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.chunk.ordinal - right.chunk.ordinal,
          )
          .slice(0, limit),
      ),
  };
}

describe('LocalHybridBookCandidateRetriever', () => {
  it('通过本地同义表达扩展找到没有字面重合的片段', async () => {
    const offline = chunk(
      'chunk-offline',
      '应用支持完全离线阅读，不依赖云端服务。',
      0,
    );
    const retriever = new LocalHybridBookCandidateRetriever(
      createRepository([offline]),
    );

    await expect(
      retriever.retrieve('book-1', '怎样在断网时阅读？', 6),
    ).resolves.toMatchObject([{ chunk: { id: offline.id } }]);
    expect(buildBookQueryPlan('怎样在断网时阅读？').expandedTerms).toContain(
      '离线',
    );
  });

  it('用 RRF 去重多路结果，并优先保留原始问题直接命中', async () => {
    const direct = chunk(
      'chunk-direct',
      '本地存储的阅读笔记会保存在 SQLite 中。',
      0,
    );
    const expanded = chunk(
      'chunk-expanded',
      'Reading notes are saved on the device.',
      1,
    );
    const retriever = new LocalHybridBookCandidateRetriever(
      createRepository([expanded, direct]),
    );

    const results = await retriever.retrieve('book-1', '阅读笔记如何存储？', 6);
    const ids = results.map((result) => result.chunk.id);

    expect(ids).toEqual([direct.id, expanded.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('没有任何相关证据时仍返回空结果', async () => {
    const retriever = new LocalHybridBookCandidateRetriever(
      createRepository([chunk('chunk-layout', '排版可调整字号和行高。', 0)]),
    );

    await expect(
      retriever.retrieve('book-1', '谁发现了量子纠缠？', 6),
    ).resolves.toEqual([]);
  });

  it('在开始召回前响应取消', async () => {
    const controller = new AbortController();
    controller.abort();
    const retriever = new LocalHybridBookCandidateRetriever(
      createRepository([]),
    );

    await expect(
      retriever.retrieve('book-1', '阅读数据', 6, controller.signal),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
  });
});

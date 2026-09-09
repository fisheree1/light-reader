import { describe, expect, it } from 'vitest';

import type { Book } from '../../library/domain/book';
import { agentRunSchema } from '../domain/agent';
import type { RetrievedPassage } from './book-retrieval';
import {
  CitationValidator,
  extractCitedPassageIndexes,
} from './citation-validator';

const book: Book = {
  id: 'book-1',
  title: '测试书',
  author: null,
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '测试书',
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

const run = agentRunSchema.parse({
  schemaVersion: 1,
  id: 'run-1',
  task: 'book-qa',
  action: 'custom',
  instruction: '测试问题',
  status: 'completed',
  provider: 'ollama',
  model: 'deepseek-r1:8b',
  promptVersion: 'book-qa-v1',
  scopeGrantId: 'grant-1',
  createdAt: 1,
  startedAt: 1,
  completedAt: 2,
  inputTokens: null,
  outputTokens: null,
  toolCallCount: 1,
  errorCode: null,
});

function passage(index: number): RetrievedPassage {
  return {
    schemaVersion: 1,
    id: `passage-${String(index)}`,
    bookId: book.id,
    sourceFileHash: book.fileHash,
    chapterHref: `${String(index)}.xhtml`,
    chapterTitle: `第 ${String(index)} 章`,
    startLocator: {
      version: 1,
      format: 'epub',
      chapterHref: `${String(index)}.xhtml`,
      progression: 0,
    },
    endLocator: null,
    text: `第 ${String(index)} 条依据`,
    textHash: `fnv1a-${String(index).padStart(8, '0')}`,
    estimatedTokens: 4,
    ordinal: index,
    sourceChunkIds: [`chunk-${String(index)}`],
    score: 1,
  };
}

describe('CitationValidator', () => {
  it('只保留回答实际使用的依据，并对重复标记去重', () => {
    const citations = new CitationValidator().create(
      run,
      book,
      [passage(1), passage(2)],
      '结论由第二条依据支持 [S2]，再次引用 [S2]。',
    );

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      sourceChunkId: 'chunk-2',
      quote: '第 2 条依据',
      validation: 'verified',
      supportValidation: 'not-assessed',
    });
  });

  it('拒绝缺少标记和越界标记', () => {
    expect(() => extractCitedPassageIndexes('无引用', 2)).toThrow();
    expect(() => extractCitedPassageIndexes('错误 [S3]', 2)).toThrow();
  });

  it('拒绝与当前图书版本不一致的依据', () => {
    const stalePassage = {
      ...passage(1),
      sourceFileHash: 'b'.repeat(64),
    };

    expect(() =>
      new CitationValidator().create(run, book, [stalePassage], '结论 [S1]'),
    ).toThrow();
  });
});

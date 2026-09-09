import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../../library/domain/book';
import type { AgentCapabilityGrant } from '../domain/agent';
import type { BookRetrievalService } from '../retrieval/book-retrieval-service';
import type { RetrievedPassage } from '../retrieval/book-retrieval';
import { AgentToolRegistry } from './agent-tool-registry';

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
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 1,
  createdAt: 1,
  updatedAt: 1,
};

const passage: RetrievedPassage = {
  schemaVersion: 1,
  id: 'passage-one',
  bookId: book.id,
  sourceFileHash: book.fileHash,
  chapterHref: 'one.xhtml',
  chapterTitle: '第一章',
  startLocator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
  },
  endLocator: null,
  text: '只读检索内容',
  textHash: 'fnv1a-deadbeef',
  estimatedTokens: 8,
  ordinal: 0,
  sourceChunkIds: ['chunk-one'],
  score: 1,
};

function createGrant(overrides: Partial<AgentCapabilityGrant> = {}) {
  return {
    schemaVersion: 1,
    id: 'grant-1',
    runId: 'run-1',
    provider: 'ollama',
    model: 'deepseek-r1:8b',
    remoteProcessingAllowed: false,
    allowedTools: ['search_books', 'read_passage'],
    allowedBookIds: [book.id],
    allowedNoteIds: [],
    allowedAnnotationIds: [],
    maxCharsPerToolResult: 9_000,
    maxTotalContextChars: 12_000,
    maxToolCalls: 3,
    expiresAt: 1_000,
    approvedAt: 100,
    ...overrides,
  } satisfies AgentCapabilityGrant;
}

describe('AgentToolRegistry', () => {
  it('keeps search and passage reads within one approved book', async () => {
    const retrieval = {
      retrieve: vi.fn(() => Promise.resolve([passage])),
      readChunk: vi.fn(() => Promise.resolve(passage)),
    } as unknown as BookRetrievalService;
    const tools = new AgentToolRegistry(
      retrieval,
      createGrant(),
      book,
      () => 200,
    );

    const outside = await tools.execute({
      schemaVersion: 1,
      callId: 'call-outside',
      name: 'search_books',
      arguments: { query: '测试问题', bookIds: ['book-2'], limit: 6 },
    });
    const search = await tools.execute({
      schemaVersion: 1,
      callId: 'call-search',
      name: 'search_books',
      arguments: { query: '测试问题', bookIds: [book.id], limit: 6 },
    });
    const read = await tools.execute({
      schemaVersion: 1,
      callId: 'call-read',
      name: 'read_passage',
      arguments: { bookId: book.id, chunkId: 'chunk-one' },
    });

    expect(outside).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(search.ok).toBe(true);
    expect(read.ok).toBe(true);
    expect(tools.getTrace()).toHaveLength(3);
    expect(JSON.stringify(tools.getTrace())).not.toContain(passage.text);
  });

  it('rejects duplicate and expired calls before retrieval', async () => {
    const retrieval = {
      retrieve: vi.fn(() => Promise.resolve([passage])),
    } as unknown as BookRetrievalService;
    const active = new AgentToolRegistry(
      retrieval,
      createGrant(),
      book,
      () => 200,
    );
    const call = {
      schemaVersion: 1 as const,
      callId: 'call-1',
      name: 'search_books' as const,
      arguments: { query: '测试问题', bookIds: [book.id], limit: 6 },
    };
    await active.execute(call);
    const duplicate = await active.execute({ ...call, callId: 'call-2' });
    const expired = await new AgentToolRegistry(
      retrieval,
      createGrant({ expiresAt: 150 }),
      book,
      () => 200,
    ).execute(call);

    expect(duplicate).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    expect(expired).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
  });
});

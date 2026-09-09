import type { BookChunkRepository } from '../../../database/repositories/book-chunk-repository';
import { AppError, isAppError } from '../../../lib/app-error';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
import type { Book } from '../../library/domain/book';
import { hashAgentText } from '../domain/agent';
import { BookChunker } from './book-chunker';
import type { BookTextExtractor } from './book-text-extractor';
import {
  emitBookIndexingProgress,
  throwIfBookIndexingAborted,
  type BookRetrievalOptions,
} from './book-indexing';
import {
  extractBookQueryTerms,
  retrievedPassageSchema,
  type BookChunkMatch,
  type RetrievedPassage,
} from './book-retrieval';

const maxPassageChars = 1_500;
const maxContextChars = 9_000;

function removeOverlap(left: string, right: string): string {
  const limit = Math.min(200, left.length, right.length);
  for (let length = limit; length >= 20; length -= 1) {
    if (left.endsWith(right.slice(0, length))) return right.slice(length);
  }
  return `\n\n${right}`;
}

function toPassage(match: BookChunkMatch): RetrievedPassage {
  return retrievedPassageSchema.parse({
    ...match.chunk,
    id: `passage-${match.chunk.id.slice(6)}`,
    sourceChunkIds: [match.chunk.id],
    score: match.score,
  });
}

function canMerge(left: RetrievedPassage, right: RetrievedPassage): boolean {
  if (left.bookId !== right.bookId) return false;
  const sameSection =
    left.chapterHref === right.chapterHref &&
    left.startLocator.format === right.startLocator.format &&
    (left.startLocator.format !== 'pdf' ||
      (right.startLocator.format === 'pdf' &&
        left.startLocator.pageIndex === right.startLocator.pageIndex));
  return sameSection && Math.abs(left.ordinal - right.ordinal) === 1;
}

function mergePassages(
  left: RetrievedPassage,
  right: RetrievedPassage,
): RetrievedPassage | null {
  const first = left.ordinal <= right.ordinal ? left : right;
  const second = first === left ? right : left;
  const suffix = removeOverlap(first.text, second.text);
  const text = `${first.text}${suffix}`;
  if (text.length > maxPassageChars) return null;
  return retrievedPassageSchema.parse({
    ...first,
    id: `passage-${hashAgentText(`${first.id}:${second.id}`).slice(6)}`,
    endLocator: second.endLocator ?? second.startLocator,
    text,
    textHash: hashAgentText(text),
    estimatedTokens: Math.max(1, Math.ceil(text.length / 2)),
    sourceChunkIds: [...first.sourceChunkIds, ...second.sourceChunkIds],
    score: Math.max(first.score, second.score),
  });
}

export class BookRetrievalService {
  private readonly chunker: BookChunker;
  private readonly extractor: BookTextExtractor;
  private readonly indexing = new Map<string, Promise<void>>();
  private readonly repository: BookChunkRepository;
  private readonly source: ReaderBookSource;

  constructor(
    repository: BookChunkRepository,
    source: ReaderBookSource,
    extractor: BookTextExtractor,
    chunker = new BookChunker(),
  ) {
    this.repository = repository;
    this.source = source;
    this.extractor = extractor;
    this.chunker = chunker;
  }

  async ensureIndexed(
    book: Book,
    options: BookRetrievalOptions = {},
  ): Promise<void> {
    throwIfBookIndexingAborted(options.signal);
    if (
      (await this.repository.getIndexedSourceHash(book.id)) === book.fileHash
    ) {
      emitBookIndexingProgress(options, 'ready');
      return;
    }
    const active = this.indexing.get(book.id);
    if (active) {
      await active;
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(options, 'ready');
      return;
    }
    const indexing = this.buildIndex(book, options).finally(() => {
      if (this.indexing.get(book.id) === indexing)
        this.indexing.delete(book.id);
    });
    this.indexing.set(book.id, indexing);
    return indexing;
  }

  async retrieve(
    book: Book,
    question: string,
    limit = 6,
    options: BookRetrievalOptions = {},
  ): Promise<RetrievedPassage[]> {
    await this.ensureIndexed(book, options);
    throwIfBookIndexingAborted(options.signal);
    emitBookIndexingProgress(options, 'searching-index');
    const terms = extractBookQueryTerms(question);
    if (terms.length === 0) return [];
    const matches = await this.repository.searchBookChunks(
      book.id,
      terms,
      Math.max(1, Math.min(8, limit)),
    );
    throwIfBookIndexingAborted(options.signal);
    const passages: RetrievedPassage[] = [];
    let totalChars = 0;
    for (const match of matches) {
      const candidate = toPassage(match);
      const mergeIndex = passages.findIndex((passage) =>
        canMerge(passage, candidate),
      );
      if (mergeIndex >= 0) {
        const merged = mergePassages(passages[mergeIndex], candidate);
        if (merged) {
          totalChars += merged.text.length - passages[mergeIndex].text.length;
          passages[mergeIndex] = merged;
          continue;
        }
      }
      if (totalChars + candidate.text.length > maxContextChars) break;
      passages.push(candidate);
      totalChars += candidate.text.length;
    }
    return passages;
  }

  async readChunk(
    book: Book,
    chunkId: string,
    options: BookRetrievalOptions = {},
  ): Promise<RetrievedPassage | null> {
    await this.ensureIndexed(book, options);
    throwIfBookIndexingAborted(options.signal);
    const chunk = await this.repository.findById(book.id, chunkId);
    if (chunk?.sourceFileHash !== book.fileHash) return null;
    return retrievedPassageSchema.parse({
      ...chunk,
      id: `passage-${chunk.id.slice(6)}`,
      sourceChunkIds: [chunk.id],
      score: 0,
    });
  }

  async rebuildIndex(
    book: Book,
    options: BookRetrievalOptions = {},
  ): Promise<void> {
    const active = this.indexing.get(book.id);
    if (active) {
      await active;
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(options, 'ready');
      return;
    }
    throwIfBookIndexingAborted(options.signal);
    const indexing = this.buildIndex(book, options).finally(() => {
      if (this.indexing.get(book.id) === indexing)
        this.indexing.delete(book.id);
    });
    this.indexing.set(book.id, indexing);
    await indexing;
  }

  private async buildIndex(
    book: Book,
    options: BookRetrievalOptions,
  ): Promise<void> {
    try {
      emitBookIndexingProgress(options, 'reading-source');
      throwIfBookIndexingAborted(options.signal);
      const source = await this.source.read(book.filePath);
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(options, 'extracting-text');
      const blocks = await this.extractor.extract(book.format, source, options);
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(options, 'chunking-text');
      const chunks = this.chunker.chunk(book, blocks, options.signal);
      if (chunks.length === 0) throw new AppError('TEXT_UNAVAILABLE');
      throwIfBookIndexingAborted(options.signal);
      emitBookIndexingProgress(options, 'writing-index');
      await this.repository.replaceBookChunks(book.id, chunks, options.signal);
      emitBookIndexingProgress(options, 'ready');
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }
}

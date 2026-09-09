import { z } from 'zod';

import {
  bookChunkMatchSchema,
  bookChunkSchema,
  type BookChunk,
  type BookChunkMatch,
  scoreBookChunkTerms,
} from '../../features/ai-agent/retrieval/book-retrieval';
import { AppError, isAppError } from '../../lib/app-error';
import type { BookChunkRepository } from './book-chunk-repository';

const storageKey = 'light-reader-web-ai-book-chunks';
const idSchema = z.string().trim().min(1).max(128);

function readChunks(): BookChunk[] {
  const value = localStorage.getItem(storageKey);
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return bookChunkSchema.array().parse(parsed);
}

function writeChunks(chunks: BookChunk[]): void {
  localStorage.setItem(storageKey, JSON.stringify(chunks));
}

export function removeWebBookChunks(bookId: string): void {
  const id = idSchema.parse(bookId);
  writeChunks(readChunks().filter((chunk) => chunk.bookId !== id));
}

export class WebBookChunkRepository implements BookChunkRepository {
  findById(bookId: string, chunkId: string): Promise<BookChunk | null> {
    try {
      const id = idSchema.parse(bookId);
      const target = idSchema.parse(chunkId);
      return Promise.resolve(
        readChunks().find(
          (chunk) => chunk.bookId === id && chunk.id === target,
        ) ?? null,
      );
    } catch (error) {
      return Promise.reject(new AppError('SEARCH_FAILED', { cause: error }));
    }
  }

  getIndexedSourceHash(bookId: string): Promise<string | null> {
    try {
      const id = idSchema.parse(bookId);
      return Promise.resolve(
        readChunks().find((chunk) => chunk.bookId === id)?.sourceFileHash ??
          null,
      );
    } catch (error) {
      if (isAppError(error)) return Promise.reject(error);
      return Promise.reject(
        new AppError('SEARCH_INDEX_FAILED', { cause: error }),
      );
    }
  }

  replaceBookChunks(
    bookId: string,
    values: BookChunk[],
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const id = idSchema.parse(bookId);
      const chunks = bookChunkSchema.array().parse(values);
      if (signal?.aborted) throw new AppError('USER_CANCELLED');
      if (chunks.some((chunk) => chunk.bookId !== id)) throw new Error();
      writeChunks([
        ...readChunks().filter((chunk) => chunk.bookId !== id),
        ...chunks,
      ]);
      return Promise.resolve();
    } catch (error) {
      if (isAppError(error)) return Promise.reject(error);
      return Promise.reject(
        new AppError('SEARCH_INDEX_FAILED', { cause: error }),
      );
    }
  }

  searchBookChunks(
    bookId: string,
    terms: string[],
    limit: number,
  ): Promise<BookChunkMatch[]> {
    try {
      const id = idSchema.parse(bookId);
      const normalizedTerms = z
        .array(z.string().trim().min(2).max(32))
        .min(1)
        .max(12)
        .parse(terms)
        .map((term) => term.toLocaleLowerCase());
      const matches = readChunks()
        .filter((chunk) => chunk.bookId === id)
        .flatMap((chunk) => {
          const score = scoreBookChunkTerms(chunk.text, normalizedTerms);
          return score > 0
            ? [bookChunkMatchSchema.parse({ chunk, score })]
            : [];
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.chunk.ordinal - right.chunk.ordinal,
        )
        .slice(0, Math.max(1, Math.min(8, limit)));
      return Promise.resolve(matches);
    } catch (error) {
      return Promise.reject(new AppError('SEARCH_FAILED', { cause: error }));
    }
  }
}

export { storageKey as WEB_AI_BOOK_CHUNKS_KEY };

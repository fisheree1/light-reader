import { z } from 'zod';

import {
  bookChunkMatchSchema,
  bookChunkSchema,
  type BookChunk,
  type BookChunkMatch,
  scoreBookChunkTerms,
} from '../../features/ai-agent/retrieval/book-retrieval';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { parseRecords, withAppError } from '../web/web-repository-support';
import type { BookChunkRepository } from './book-chunk-repository';

const idSchema = z.string().trim().min(1).max(128);
const termsSchema = z.array(z.string().trim().min(2).max(32)).min(1).max(12);

export class WebBookChunkRepository implements BookChunkRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  findById(bookId: string, chunkId: string): Promise<BookChunk | null> {
    return withAppError('SEARCH_FAILED', async () => {
      const stored = await this.database.get('bookChunks', [
        idSchema.parse(bookId),
        idSchema.parse(chunkId),
      ]);
      return stored === undefined ? null : bookChunkSchema.parse(stored);
    });
  }

  getIndexedSourceHash(bookId: string): Promise<string | null> {
    return withAppError('SEARCH_INDEX_FAILED', async () => {
      const [first] = await this.database.getAllByBook(
        'bookChunks',
        idSchema.parse(bookId),
      );
      return first === undefined
        ? null
        : bookChunkSchema.parse(first).sourceFileHash;
    });
  }

  replaceBookChunks(
    bookId: string,
    values: BookChunk[],
    signal?: AbortSignal,
  ): Promise<void> {
    return withAppError('SEARCH_INDEX_FAILED', async () => {
      const id = idSchema.parse(bookId);
      const chunks = bookChunkSchema.array().parse(values);
      if (signal?.aborted) throw new AppError('USER_CANCELLED');
      if (chunks.some((chunk) => chunk.bookId !== id)) {
        throw new Error('Chunk belongs to a different book.');
      }
      await this.database.write([
        { type: 'deleteByBook', store: 'bookChunks', bookId: id },
        ...chunks.map((chunk) => ({
          type: 'put' as const,
          store: 'bookChunks' as const,
          value: chunk,
        })),
      ]);
    });
  }

  searchBookChunks(
    bookId: string,
    terms: string[],
    limit: number,
  ): Promise<BookChunkMatch[]> {
    return withAppError('SEARCH_FAILED', async () => {
      const id = idSchema.parse(bookId);
      const normalizedTerms = termsSchema
        .parse(terms)
        .map((term) => term.toLocaleLowerCase());
      const chunks = parseRecords(
        bookChunkSchema,
        await this.database.getAllByBook('bookChunks', id),
      );
      return chunks
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
    });
  }
}

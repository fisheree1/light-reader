import { z } from 'zod';

import {
  bookChunkMatchSchema,
  bookChunkSchema,
  type BookChunk,
  type BookChunkMatch,
} from '../../features/ai-agent/retrieval/book-retrieval';
import { AppError } from '../../lib/app-error';
import { bookLocatorSchema } from '../../reader-engines/types';
import { getDatabase, type SqlDatabase } from '../client';
import type { BookChunkRepository } from './book-chunk-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const idSchema = z.string().trim().min(1).max(128);
const searchTermsSchema = z
  .array(z.string().trim().min(2).max(32))
  .min(1)
  .max(12);
const limitSchema = z.number().int().min(1).max(8);
const rowSchema = z.object({
  schema_version: z.number().int(),
  chunk_id: z.string(),
  book_id: z.string(),
  source_file_hash: z.string(),
  chapter_href: z.string().nullable(),
  chapter_title: z.string().nullable(),
  start_locator_json: z.string(),
  end_locator_json: z.string().nullable(),
  text: z.string(),
  text_hash: z.string(),
  estimated_tokens: z.number().int(),
  ordinal: z.number().int(),
  score: z.number().optional(),
});

type BookChunkRow = z.infer<typeof rowSchema>;

const columns = `schema_version, chunk_id, book_id, source_file_hash,
  chapter_href, chapter_title, start_locator_json, end_locator_json,
  text, text_hash, estimated_tokens, ordinal`;

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function mapRow(value: unknown): BookChunk {
  const row = rowSchema.parse(value);
  return bookChunkSchema.parse({
    schemaVersion: row.schema_version,
    id: row.chunk_id,
    bookId: row.book_id,
    sourceFileHash: row.source_file_hash,
    chapterHref: row.chapter_href,
    chapterTitle: row.chapter_title,
    startLocator: bookLocatorSchema.parse(JSON.parse(row.start_locator_json)),
    endLocator: row.end_locator_json
      ? bookLocatorSchema.parse(JSON.parse(row.end_locator_json))
      : null,
    text: row.text,
    textHash: row.text_hash,
    estimatedTokens: row.estimated_tokens,
    ordinal: row.ordinal,
  });
}

export class SqliteBookChunkRepository implements BookChunkRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async findById(bookId: string, chunkId: string): Promise<BookChunk | null> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookChunkRow[]>(
        `SELECT ${columns}
         FROM ai_book_chunks
         WHERE book_id = $1 AND chunk_id = $2
         LIMIT 1`,
        [idSchema.parse(bookId), idSchema.parse(chunkId)],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async getIndexedSourceHash(bookId: string): Promise<string | null> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<{ source_file_hash: string }[]>(
        `SELECT source_file_hash FROM ai_book_chunks
         WHERE book_id = $1 LIMIT 1`,
        [idSchema.parse(bookId)],
      );
      return rows[0]?.source_file_hash ?? null;
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async replaceBookChunks(bookId: string, values: BookChunk[]): Promise<void> {
    const id = idSchema.parse(bookId);
    const chunks = bookChunkSchema.array().parse(values);
    if (chunks.some((chunk) => chunk.bookId !== id)) {
      throw new AppError('SEARCH_INDEX_FAILED');
    }
    const database = await this.databaseProvider();
    await database.execute('BEGIN IMMEDIATE');
    try {
      await database.execute('DELETE FROM ai_book_chunks WHERE book_id = $1', [
        id,
      ]);
      for (const chunk of chunks) {
        await database.execute(
          `INSERT INTO ai_book_chunks (
             schema_version, chunk_id, book_id, source_file_hash,
             chapter_href, chapter_title, start_locator_json,
             end_locator_json, text, text_hash, estimated_tokens, ordinal
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            chunk.schemaVersion,
            chunk.id,
            chunk.bookId,
            chunk.sourceFileHash,
            chunk.chapterHref,
            chunk.chapterTitle,
            JSON.stringify(chunk.startLocator),
            chunk.endLocator ? JSON.stringify(chunk.endLocator) : null,
            chunk.text,
            chunk.textHash,
            chunk.estimatedTokens,
            chunk.ordinal,
          ],
        );
      }
      await database.execute('COMMIT');
    } catch (error) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async searchBookChunks(
    bookId: string,
    valueTerms: string[],
    valueLimit: number,
  ): Promise<BookChunkMatch[]> {
    const id = idSchema.parse(bookId);
    const terms = searchTermsSchema.parse(valueTerms);
    const limit = limitSchema.parse(valueLimit);
    try {
      const database = await this.databaseProvider();
      const useFts = terms.every((term) => Array.from(term).length >= 3);
      let rows: BookChunkRow[];
      if (useFts) {
        const binding = terms
          .map((term) => `"${term.replaceAll('"', '""')}"`)
          .join(' OR ');
        rows = await database.select<BookChunkRow[]>(
          `SELECT ${columns}, MAX(0.0, -bm25(ai_book_chunks)) AS score
           FROM ai_book_chunks
           WHERE ai_book_chunks MATCH $1 AND book_id = $2
           ORDER BY bm25(ai_book_chunks), ordinal ASC
           LIMIT $3`,
          [binding, id, limit],
        );
      } else {
        const clauses = terms.map(
          (_term, index) => `text LIKE $${String(index + 2)} ESCAPE '\\'`,
        );
        rows = await database.select<BookChunkRow[]>(
          `SELECT ${columns}, 0.0 AS score
           FROM ai_book_chunks
           WHERE book_id = $1 AND (${clauses.join(' OR ')})
           ORDER BY ordinal ASC
           LIMIT $${String(terms.length + 2)}`,
          [id, ...terms.map((term) => `%${escapeLike(term)}%`), limit],
        );
      }
      return rows.map((row) =>
        bookChunkMatchSchema.parse({
          chunk: mapRow(row),
          score: Math.max(0, rowSchema.parse(row).score ?? 0),
        }),
      );
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }
}

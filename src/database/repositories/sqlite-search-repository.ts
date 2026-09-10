import { z } from 'zod';

import {
  bookContentChapterSchema,
  normalizeSearchQuery,
  type AnnotationSearchResult,
  type BookContentChapter,
  type BookContentSearchResult,
  type BookSearchResult,
  type NoteSearchResult,
} from '../../features/search/domain/search';
import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import {
  mapAnnotationSearchRecord,
  mapBookContentSearchRecord,
  mapBookSearchRecord,
  mapNoteSearchRecord,
  type AnnotationSearchRecord,
  type BookContentSearchRecord,
  type BookSearchRecord,
  type NoteSearchRecord,
} from '../schema/search-record';
import type { SearchRepository } from './search-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const resultLimitSchema = z.number().int().min(1).max(100);

function validId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new AppError('SEARCH_INDEX_FAILED');
  return id;
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

export function createSearchQuery(value: string): {
  binding: string;
  mode: 'fts' | 'like';
} {
  const query = normalizeSearchQuery(value);
  const tokens = query.split(' ').filter(Boolean);
  const requiresLike =
    tokens.length === 0 || tokens.some((token) => Array.from(token).length < 3);
  if (requiresLike) {
    return { binding: `%${escapeLike(query)}%`, mode: 'like' };
  }
  return {
    binding: tokens
      .map((token) => `"${token.replaceAll('"', '""')}"`)
      .join(' AND '),
    mode: 'fts',
  };
}

export class SqliteSearchRepository implements SearchRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async searchBooks(
    value: string,
    valueLimit = 20,
  ): Promise<BookSearchResult[]> {
    const query = normalizeSearchQuery(value);
    const limit = resultLimitSchema.parse(valueLimit);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookSearchRecord[]>(
        `SELECT DISTINCT b.id, b.title, b.author, b.format
         FROM books b
         LEFT JOIN book_tags bt ON bt.book_id = b.id
         WHERE b.title LIKE $1 ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(b.author, '') LIKE $1 ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(bt.tag, '') LIKE $1 ESCAPE '\\' COLLATE NOCASE
         ORDER BY b.updated_at DESC, b.title ASC
         LIMIT $2`,
        [`%${escapeLike(query)}%`, limit],
      );
      return rows.map(mapBookSearchRecord);
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchNotes(
    value: string,
    valueLimit = 20,
  ): Promise<NoteSearchResult[]> {
    const query = createSearchQuery(value);
    const limit = resultLimitSchema.parse(valueLimit);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<NoteSearchRecord[]>(
        query.mode === 'fts'
          ? `SELECT n.id, n.title,
               snippet(notes_fts, 2, '', '', '…', 24) AS excerpt,
               n.updated_at
             FROM notes_fts
             JOIN notes n ON n.id = notes_fts.note_id
             WHERE notes_fts MATCH $1
             ORDER BY bm25(notes_fts, 0.0, 8.0, 1.0), n.updated_at DESC
             LIMIT $2`
          : `SELECT id, title, substr(plain_text, 1, 320) AS excerpt, updated_at
             FROM notes
             WHERE title LIKE $1 ESCAPE '\\' COLLATE NOCASE
                OR plain_text LIKE $1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY updated_at DESC, id ASC
             LIMIT $2`,
        [query.binding, limit],
      );
      return rows.map(mapNoteSearchRecord);
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchAnnotations(
    value: string,
    valueLimit = 20,
  ): Promise<AnnotationSearchResult[]> {
    const query = createSearchQuery(value);
    const limit = resultLimitSchema.parse(valueLimit);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<AnnotationSearchRecord[]>(
        query.mode === 'fts'
          ? `SELECT a.id, a.book_id, b.title AS book_title, a.text,
               a.chapter_href, a.locator_json, a.created_at
             FROM annotations_fts
             JOIN annotations a ON a.id = annotations_fts.annotation_id
             JOIN books b ON b.id = a.book_id
             WHERE annotations_fts MATCH $1
             ORDER BY bm25(annotations_fts, 0.0, 1.0), a.created_at DESC
             LIMIT $2`
          : `SELECT a.id, a.book_id, b.title AS book_title, a.text,
               a.chapter_href, a.locator_json, a.created_at
             FROM annotations a
             JOIN books b ON b.id = a.book_id
             WHERE a.text LIKE $1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY a.created_at DESC, a.id ASC
             LIMIT $2`,
        [query.binding, limit],
      );
      return rows.map(mapAnnotationSearchRecord);
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async searchBookContent(
    value: string,
    valueLimit = 40,
  ): Promise<BookContentSearchResult[]> {
    const query = createSearchQuery(value);
    const limit = resultLimitSchema.parse(valueLimit);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookContentSearchRecord[]>(
        query.mode === 'fts'
          ? `SELECT book_content_index.book_id, b.title AS book_title,
               b.format AS book_format,
               book_content_index.chapter_href,
               book_content_index.chapter_title,
               snippet(book_content_index, 3, '', '', '…', 32) AS excerpt
             FROM book_content_index
             JOIN books b ON b.id = book_content_index.book_id
             WHERE book_content_index MATCH $1
             ORDER BY bm25(book_content_index, 0.0, 0.0, 2.0, 1.0)
             LIMIT $2`
          : `SELECT book_content_index.book_id, b.title AS book_title,
               b.format AS book_format,
               book_content_index.chapter_href,
               book_content_index.chapter_title,
               substr(book_content_index.text, 1, 400) AS excerpt
             FROM book_content_index
             JOIN books b ON b.id = book_content_index.book_id
             WHERE book_content_index.text LIKE $1 ESCAPE '\\' COLLATE NOCASE
                OR book_content_index.chapter_title LIKE $1 ESCAPE '\\' COLLATE NOCASE
             LIMIT $2`,
        [query.binding, limit],
      );
      return rows.map(mapBookContentSearchRecord);
    } catch (error) {
      throw new AppError('SEARCH_FAILED', { cause: error });
    }
  }

  async findIndexedBookIds(): Promise<string[]> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<{ book_id: string }[]>(
        'SELECT DISTINCT book_id FROM book_content_index',
      );
      return z
        .array(z.object({ book_id: z.string().min(1) }))
        .parse(rows)
        .map((row) => row.book_id);
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async replaceBookContent(
    valueBookId: string,
    values: BookContentChapter[],
  ): Promise<void> {
    const bookId = validId(valueBookId);
    const chapters = bookContentChapterSchema.array().parse(values);
    try {
      const database = await this.databaseProvider();
      await this.transaction(database, async () => {
        await database.execute(
          'DELETE FROM book_content_index WHERE book_id = $1',
          [bookId],
        );
        for (const chapter of chapters) {
          await database.execute(
            `INSERT INTO book_content_index (
               book_id, chapter_href, chapter_title, text
             ) VALUES ($1, $2, $3, $4)`,
            [bookId, chapter.chapterHref, chapter.chapterTitle, chapter.text],
          );
        }
      });
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async clearBookContent(): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute('DELETE FROM book_content_index');
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  async rebuildTextIndexes(): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await this.transaction(database, async () => {
        await database.execute('DELETE FROM notes_fts');
        await database.execute(
          `INSERT INTO notes_fts (note_id, title, content)
           SELECT id, title, plain_text FROM notes`,
        );
        await database.execute('DELETE FROM annotations_fts');
        await database.execute(
          `INSERT INTO annotations_fts (annotation_id, text)
           SELECT id, text FROM annotations`,
        );
      });
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }

  private async transaction(
    database: SqlDatabase,
    action: () => Promise<void>,
  ): Promise<void> {
    await database.execute('BEGIN IMMEDIATE');
    try {
      await action();
      await database.execute('COMMIT');
    } catch (error) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
}

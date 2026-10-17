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
import {
  searchIndexWrites,
  type AtomicSearchIndexWrites,
} from '../atomic-writes';
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
  private readonly atomicWrites: AtomicSearchIndexWrites;

  constructor(
    databaseProvider: DatabaseProvider = getDatabase,
    atomicWrites: AtomicSearchIndexWrites = searchIndexWrites,
  ) {
    this.databaseProvider = databaseProvider;
    this.atomicWrites = atomicWrites;
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
      // Loads the plugin pool the command writes through.
      await this.databaseProvider();
      await this.atomicWrites.replaceBookContent(bookId, chapters);
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
      await this.databaseProvider();
      await this.atomicWrites.rebuildTextIndexes();
    } catch (error) {
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    }
  }
}

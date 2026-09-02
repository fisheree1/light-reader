import {
  readingHistoryEntrySchema,
  readingSessionSchema,
  readingStatsSchema,
  type ReadingHistoryEntry,
  type ReadingSession,
  type ReadingStats,
} from '../../features/reader/domain/reading-activity';
import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import type { ReadingActivityRepository } from './reading-activity-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

interface SessionRecord {
  id: string;
  book_id: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number;
}

function mapSession(row: SessionRecord): ReadingSession {
  return readingSessionSchema.parse({
    id: row.id,
    bookId: row.book_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
  });
}

export class SqliteReadingActivityRepository implements ReadingActivityRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async startSession(value: ReadingSession): Promise<ReadingSession> {
    const session = readingSessionSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'INSERT INTO reading_sessions (id, book_id, started_at, ended_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)',
        [
          session.id,
          session.bookId,
          session.startedAt,
          session.endedAt,
          session.durationSeconds,
        ],
      );
      return session;
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }

  async finishSession(id: string, endedAt: number): Promise<ReadingSession> {
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'UPDATE reading_sessions SET ended_at = $1, duration_seconds = MAX(0, CAST(($1 - started_at) / 1000 AS INTEGER)) WHERE id = $2',
        [endedAt, id],
      );
      const rows = await database.select<SessionRecord[]>(
        'SELECT id, book_id, started_at, ended_at, duration_seconds FROM reading_sessions WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!rows[0]) throw new Error('Reading session not found');
      return mapSession(rows[0]);
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }

  async getStats(): Promise<ReadingStats> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<
        {
          total_seconds: number;
          session_count: number;
          books_read: number;
          last_read_at: number | null;
        }[]
      >(
        'SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds, COUNT(*) AS session_count, COUNT(DISTINCT book_id) AS books_read, MAX(started_at) AS last_read_at FROM reading_sessions',
      );
      const row = rows[0];
      return readingStatsSchema.parse({
        totalSeconds: row.total_seconds,
        sessionCount: row.session_count,
        booksRead: row.books_read,
        lastReadAt: row.last_read_at,
      });
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }

  async listRecent(limit = 20): Promise<ReadingHistoryEntry[]> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<
        {
          book_id: string;
          book_title: string;
          author: string | null;
          started_at: number;
          duration_seconds: number;
        }[]
      >(
        'SELECT s.book_id, b.title AS book_title, b.author, s.started_at, s.duration_seconds FROM reading_sessions s JOIN books b ON b.id = s.book_id ORDER BY s.started_at DESC LIMIT $1',
        [Math.max(1, Math.min(100, Math.trunc(limit)))],
      );
      return rows.map((row) =>
        readingHistoryEntrySchema.parse({
          bookId: row.book_id,
          bookTitle: row.book_title,
          author: row.author,
          startedAt: row.started_at,
          durationSeconds: row.duration_seconds,
        }),
      );
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }
}

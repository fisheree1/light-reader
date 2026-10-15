import type { BookRepository } from './book-repository';
import {
  readingSessionSchema,
  type BookReadingTotal,
  type ReadingHistoryEntry,
  type ReadingSession,
  type ReadingStats,
} from '../../features/reader/domain/reading-activity';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { parseRecords, withAppError } from '../web/web-repository-support';
import type { ReadingActivityRepository } from './reading-activity-repository';

export class WebReadingActivityRepository implements ReadingActivityRepository {
  private readonly bookRepository: BookRepository;
  private readonly database: WebDatabase;

  constructor(
    bookRepository: BookRepository,
    database: WebDatabase = getWebDatabase(),
  ) {
    this.bookRepository = bookRepository;
    this.database = database;
  }

  startSession(value: ReadingSession): Promise<ReadingSession> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const session = readingSessionSchema.parse(value);
      await this.database.write([
        { type: 'put', store: 'readingSessions', value: session },
      ]);
      return session;
    });
  }

  finishSession(id: string, endedAt: number): Promise<ReadingSession> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const stored = await this.database.get('readingSessions', id);
      if (stored === undefined) throw new Error('Reading session not found');
      const current = readingSessionSchema.parse(stored);
      const updated = readingSessionSchema.parse({
        ...current,
        endedAt,
        durationSeconds: Math.max(
          0,
          Math.trunc((endedAt - current.startedAt) / 1000),
        ),
      });
      await this.database.write([
        { type: 'put', store: 'readingSessions', value: updated },
      ]);
      return updated;
    });
  }

  getStats(): Promise<ReadingStats> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const sessions = await this.readAll();
      return {
        totalSeconds: sessions.reduce(
          (sum, session) => sum + session.durationSeconds,
          0,
        ),
        sessionCount: sessions.length,
        booksRead: new Set(sessions.map((session) => session.bookId)).size,
        lastReadAt: sessions.reduce<number | null>(
          (latest, session) =>
            latest === null || session.startedAt > latest
              ? session.startedAt
              : latest,
          null,
        ),
      };
    });
  }

  listRecent(limit = 20): Promise<ReadingHistoryEntry[]> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const sessions = (await this.readAll())
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
      const entries = await Promise.all(
        sessions.map(async (session) => {
          const book = await this.bookRepository.findById(session.bookId);
          return book
            ? {
                bookId: session.bookId,
                bookTitle: book.title,
                author: book.author,
                startedAt: session.startedAt,
                durationSeconds: session.durationSeconds,
              }
            : null;
        }),
      );
      return entries.filter(
        (entry): entry is ReadingHistoryEntry => entry !== null,
      );
    });
  }

  listSessionsSince(since: number): Promise<ReadingSession[]> {
    return withAppError('READING_ACTIVITY_FAILED', async () =>
      (await this.readAll())
        .filter((session) => session.startedAt >= since)
        .sort(
          (left, right) =>
            left.startedAt - right.startedAt || left.id.localeCompare(right.id),
        ),
    );
  }

  listBookTotals(limit = 20): Promise<BookReadingTotal[]> {
    return withAppError('READING_ACTIVITY_FAILED', async () => {
      const totals = new Map<
        string,
        { lastReadAt: number; sessionCount: number; totalSeconds: number }
      >();
      for (const session of await this.readAll()) {
        const current = totals.get(session.bookId) ?? {
          lastReadAt: 0,
          sessionCount: 0,
          totalSeconds: 0,
        };
        totals.set(session.bookId, {
          lastReadAt: Math.max(current.lastReadAt, session.startedAt),
          sessionCount: current.sessionCount + 1,
          totalSeconds: current.totalSeconds + session.durationSeconds,
        });
      }
      const entries = await Promise.all(
        [...totals].map(async ([bookId, total]) => {
          const book = await this.bookRepository.findById(bookId);
          return book && total.totalSeconds > 0
            ? { bookId, bookTitle: book.title, author: book.author, ...total }
            : null;
        }),
      );
      return entries
        .filter((entry): entry is BookReadingTotal => entry !== null)
        .sort(
          (left, right) =>
            right.totalSeconds - left.totalSeconds ||
            right.lastReadAt - left.lastReadAt,
        )
        .slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
    });
  }

  private async readAll(): Promise<ReadingSession[]> {
    return parseRecords(
      readingSessionSchema,
      await this.database.getAll('readingSessions'),
    );
  }
}

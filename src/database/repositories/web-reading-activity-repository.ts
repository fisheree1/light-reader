import type { BookRepository } from './book-repository';
import {
  readingSessionSchema,
  type ReadingHistoryEntry,
  type ReadingSession,
  type ReadingStats,
} from '../../features/reader/domain/reading-activity';
import { AppError } from '../../lib/app-error';
import type { ReadingActivityRepository } from './reading-activity-repository';

const storageKey = 'light-reader-web-reading-sessions';
export const WEB_READING_SESSIONS_KEY = storageKey;

export class WebReadingActivityRepository implements ReadingActivityRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository: BookRepository) {
    this.bookRepository = bookRepository;
  }

  startSession(value: ReadingSession): Promise<ReadingSession> {
    return this.run(() => {
      const session = readingSessionSchema.parse(value);
      this.write([
        session,
        ...this.read().filter((item) => item.id !== session.id),
      ]);
      return session;
    });
  }

  finishSession(id: string, endedAt: number): Promise<ReadingSession> {
    return this.run(() => {
      const sessions = this.read();
      const current = sessions.find((item) => item.id === id);
      if (!current) throw new Error('Reading session not found');
      const updated = readingSessionSchema.parse({
        ...current,
        endedAt,
        durationSeconds: Math.max(
          0,
          Math.trunc((endedAt - current.startedAt) / 1000),
        ),
      });
      this.write(sessions.map((item) => (item.id === id ? updated : item)));
      return updated;
    });
  }

  getStats(): Promise<ReadingStats> {
    return this.run(() => {
      const sessions = this.read();
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

  async listRecent(limit = 20): Promise<ReadingHistoryEntry[]> {
    try {
      const sessions = this.read()
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
    } catch (error) {
      throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
    }
  }

  private read(): ReadingSession[] {
    const value = localStorage.getItem(storageKey);
    return value ? readingSessionSchema.array().parse(JSON.parse(value)) : [];
  }

  private write(sessions: ReadingSession[]): void {
    localStorage.setItem(storageKey, JSON.stringify(sessions));
  }

  private run<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw new AppError('READING_ACTIVITY_FAILED', { cause: error });
      });
  }
}

import type { SqlDatabase } from '../client';
import { SqliteReadingActivityRepository } from './sqlite-reading-activity-repository';

interface SessionRow {
  id: string;
  book_id: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number;
}

class ActivityDatabase implements SqlDatabase {
  rows: SessionRow[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.startsWith('INSERT INTO reading_sessions')) {
      this.rows.push({
        id: String(values[0]),
        book_id: String(values[1]),
        started_at: Number(values[2]),
        ended_at: values[3] === null ? null : Number(values[3]),
        duration_seconds: Number(values[4]),
      });
    } else if (query.startsWith('UPDATE reading_sessions')) {
      this.rows = this.rows.map((row) =>
        row.id === values[1]
          ? {
              ...row,
              ended_at: Number(values[0]),
              duration_seconds: Math.trunc(
                (Number(values[0]) - row.started_at) / 1000,
              ),
            }
          : row,
      );
    }
    return Promise.resolve({});
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    if (query.includes('COALESCE(SUM')) {
      return Promise.resolve([
        {
          total_seconds: this.rows.reduce(
            (sum, row) => sum + row.duration_seconds,
            0,
          ),
          session_count: this.rows.length,
          books_read: new Set(this.rows.map((row) => row.book_id)).size,
          last_read_at: Math.max(...this.rows.map((row) => row.started_at)),
        },
      ] as T);
    }
    if (query.includes('JOIN books')) {
      return Promise.resolve(
        this.rows.map((row) => ({
          book_id: row.book_id,
          book_title: '统计测试书',
          author: '作者',
          started_at: row.started_at,
          duration_seconds: row.duration_seconds,
        })) as T,
      );
    }
    return Promise.resolve(
      this.rows.filter((row) => row.id === values[0]) as T,
    );
  }
}

describe('SqliteReadingActivityRepository', () => {
  it('finishes sessions and derives aggregate and recent reading data', async () => {
    const database = new ActivityDatabase();
    const repository = new SqliteReadingActivityRepository(() =>
      Promise.resolve(database),
    );
    await repository.startSession({
      id: 'session-1',
      bookId: 'book-1',
      startedAt: 1_000,
      endedAt: null,
      durationSeconds: 0,
    });

    await expect(
      repository.finishSession('session-1', 61_000),
    ).resolves.toEqual({
      id: 'session-1',
      bookId: 'book-1',
      startedAt: 1_000,
      endedAt: 61_000,
      durationSeconds: 60,
    });
    await expect(repository.getStats()).resolves.toEqual({
      totalSeconds: 60,
      sessionCount: 1,
      booksRead: 1,
      lastReadAt: 1_000,
    });
    await expect(repository.listRecent()).resolves.toMatchObject([
      { bookTitle: '统计测试书', durationSeconds: 60 },
    ]);
  });
});

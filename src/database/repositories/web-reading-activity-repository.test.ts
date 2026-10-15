import type { BookRepository } from './book-repository';
import { WebReadingActivityRepository } from './web-reading-activity-repository';
import type { Book } from '../../features/library/domain/book';
import { createTestWebDatabase } from '../../test/fixtures/web-records';

const book: Book = {
  id: 'book-1',
  title: '统计测试书',
  author: '作者',
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '统计测试书',
    creators: ['作者'],
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 1,
  createdAt: 1,
  updatedAt: 1,
};

const books: BookRepository = {
  create: (value) => Promise.resolve(value),
  findById: (id) => Promise.resolve(id === book.id ? book : null),
  findByHash: () => Promise.resolve(null),
  list: () => Promise.resolve([book]),
  delete: () => Promise.resolve(),
};

describe('WebReadingActivityRepository', () => {
  it('records finished sessions and derives stats and recent history', async () => {
    const repository = new WebReadingActivityRepository(
      books,
      createTestWebDatabase(),
    );
    await repository.startSession({
      id: 'session-1',
      bookId: book.id,
      startedAt: 1_000,
      endedAt: null,
      durationSeconds: 0,
    });
    await repository.finishSession('session-1', 121_000);

    await expect(repository.getStats()).resolves.toEqual({
      totalSeconds: 120,
      sessionCount: 1,
      booksRead: 1,
      lastReadAt: 1_000,
    });
    await expect(repository.listRecent()).resolves.toMatchObject([
      {
        bookId: book.id,
        bookTitle: book.title,
        durationSeconds: 120,
      },
    ]);
  });

  it('skips sessions of deleted books and reports unknown sessions', async () => {
    const repository = new WebReadingActivityRepository(
      books,
      createTestWebDatabase(),
    );
    await expect(repository.getStats()).resolves.toEqual({
      totalSeconds: 0,
      sessionCount: 0,
      booksRead: 0,
      lastReadAt: null,
    });
    await repository.startSession({
      id: 'orphan',
      bookId: 'deleted-book',
      startedAt: 1,
      endedAt: null,
      durationSeconds: 0,
    });

    await expect(repository.listRecent()).resolves.toEqual([]);
    await expect(repository.finishSession('missing', 2)).rejects.toMatchObject({
      code: 'READING_ACTIVITY_FAILED',
    });
  });

  it('lists sessions since a time and totals per existing book', async () => {
    const repository = new WebReadingActivityRepository(
      books,
      createTestWebDatabase(),
    );
    for (const [id, bookId, startedAt, durationSeconds] of [
      ['a', book.id, 1_000, 60],
      ['b', book.id, 5_000, 120],
      ['c', 'deleted-book', 3_000, 30],
      ['d', book.id, 500, 0],
    ] as const) {
      await repository.startSession({
        id,
        bookId,
        startedAt,
        endedAt: startedAt + durationSeconds * 1000,
        durationSeconds,
      });
    }

    await expect(repository.listSessionsSince(1_000)).resolves.toMatchObject([
      { id: 'a' },
      { id: 'c' },
      { id: 'b' },
    ]);
    await expect(repository.listBookTotals()).resolves.toEqual([
      {
        bookId: book.id,
        bookTitle: book.title,
        author: book.author,
        totalSeconds: 180,
        sessionCount: 3,
        lastReadAt: 5_000,
      },
    ]);
  });
});

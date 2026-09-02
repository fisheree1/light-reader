import type { BookRepository } from './book-repository';
import { WebReadingActivityRepository } from './web-reading-activity-repository';
import type { Book } from '../../features/library/domain/book';

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
  beforeEach(() => {
    localStorage.clear();
  });

  it('records finished sessions and derives stats and recent history', async () => {
    const repository = new WebReadingActivityRepository(books);
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
});

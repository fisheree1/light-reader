import type { Book } from '../../features/library/domain/book';
import { AppError } from '../../lib/app-error';
import type { SqlDatabase } from '../client';
import type { BookRecord } from '../schema/book-record';
import { SqliteBookRepository } from './sqlite-book-repository';

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'Repository book',
    author: 'Author',
    format: 'epub',
    filePath: 'light-reader/books/book-1/book.epub',
    fileHash: 'a'.repeat(64),
    coverPath: null,
    metadata: {
      title: 'Repository book',
      creators: ['Author'],
      language: null,
      publisher: null,
      description: null,
      identifier: null,
    },
    fileSize: 100,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

class FakeSqlDatabase implements SqlDatabase {
  records: BookRecord[] = [];

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.includes('INSERT INTO books')) {
      const fileHash = String(values[5]);
      if (this.records.some((record) => record.file_hash === fileHash)) {
        return Promise.reject(
          new Error('UNIQUE constraint failed: books.file_hash'),
        );
      }
      this.records.push({
        id: String(values[0]),
        title: String(values[1]),
        author: typeof values[2] === 'string' ? values[2] : null,
        format: 'epub',
        file_path: String(values[4]),
        file_hash: fileHash,
        cover_path: typeof values[6] === 'string' ? values[6] : null,
        metadata_json: String(values[7]),
        file_size: Number(values[8]),
        created_at: Number(values[9]),
        updated_at: Number(values[10]),
      });
    } else if (query.startsWith('DELETE FROM books')) {
      this.records = this.records.filter((record) => record.id !== values[0]);
    }
    return Promise.resolve({});
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    let records = [...this.records];
    if (query.includes('WHERE id =')) {
      records = records.filter((record) => record.id === values[0]);
    } else if (query.includes('WHERE file_hash =')) {
      records = records.filter((record) => record.file_hash === values[0]);
    } else {
      records.sort((left, right) => right.created_at - left.created_at);
    }
    return Promise.resolve(records as T);
  }
}

describe('SqliteBookRepository', () => {
  it('creates, finds, lists, and deletes books', async () => {
    const database = new FakeSqlDatabase();
    const repository = new SqliteBookRepository(() =>
      Promise.resolve(database),
    );
    const older = createBook();
    const newer = createBook({
      id: 'book-2',
      title: 'Newer book',
      filePath: 'light-reader/books/book-2/book.epub',
      fileHash: 'b'.repeat(64),
      createdAt: 20,
      updatedAt: 20,
    });

    await repository.create(older);
    await repository.create(newer);

    await expect(repository.findById('book-1')).resolves.toMatchObject({
      id: 'book-1',
    });
    await expect(repository.findByHash(newer.fileHash)).resolves.toMatchObject({
      id: 'book-2',
    });
    await expect(repository.list()).resolves.toEqual([newer, older]);

    await repository.delete('book-1');
    await expect(repository.findById('book-1')).resolves.toBeNull();
  });

  it('maps the unique hash constraint to DUPLICATE_BOOK', async () => {
    const database = new FakeSqlDatabase();
    const repository = new SqliteBookRepository(() =>
      Promise.resolve(database),
    );
    await repository.create(createBook());

    await expect(
      repository.create(
        createBook({
          id: 'duplicate',
          filePath: 'light-reader/books/duplicate/book.epub',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_BOOK',
    } satisfies Partial<AppError>);
  });

  it('reads existing records after repository reinitialization', async () => {
    const database = new FakeSqlDatabase();
    await new SqliteBookRepository(() => Promise.resolve(database)).create(
      createBook(),
    );

    const reopenedRepository = new SqliteBookRepository(() =>
      Promise.resolve(database),
    );
    await expect(reopenedRepository.list()).resolves.toHaveLength(1);
  });
});

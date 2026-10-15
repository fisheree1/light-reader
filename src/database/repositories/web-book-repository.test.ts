import {
  createTestAnnotation,
  createTestBook,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { WebBookRepository } from './web-book-repository';

describe('WebBookRepository', () => {
  it('creates, finds, lists, and survives reinitialization', async () => {
    const database = createTestWebDatabase();
    const repository = new WebBookRepository(database);
    const older = createTestBook({ id: 'old', title: 'B', createdAt: 1 });
    const newer = createTestBook({
      id: 'new',
      title: 'A',
      fileHash: 'b'.repeat(64),
      createdAt: 2,
    });
    await repository.create(older);
    await repository.create(newer);

    await expect(repository.findById('old')).resolves.toEqual(older);
    await expect(repository.findById('missing')).resolves.toBeNull();
    await expect(repository.findByHash('b'.repeat(64))).resolves.toEqual(newer);
    await expect(repository.findByHash('c'.repeat(64))).resolves.toBeNull();
    await expect(new WebBookRepository(database).list()).resolves.toMatchObject(
      [{ id: 'new' }, { id: 'old' }],
    );
  });

  it('maps the unique hash constraint to DUPLICATE_BOOK', async () => {
    const repository = new WebBookRepository(createTestWebDatabase());
    await repository.create(createTestBook());

    await expect(
      repository.create(createTestBook({ id: 'other' })),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOK' });
  });

  it('cascades deletion to every dependent store', async () => {
    const database = createTestWebDatabase();
    const repository = new WebBookRepository(database);
    await repository.create(createTestBook());
    await database.write([
      { type: 'put', store: 'annotations', value: createTestAnnotation() },
      {
        type: 'put',
        store: 'libraryMetadata',
        value: { bookId: 'book-1', favorite: true, tags: [] },
      },
      {
        type: 'put',
        store: 'readingSessions',
        value: { id: 's', bookId: 'book-1' },
      },
    ]);

    await repository.delete('book-1');

    await expect(repository.list()).resolves.toEqual([]);
    await expect(database.getAll('annotations')).resolves.toEqual([]);
    await expect(database.getAll('libraryMetadata')).resolves.toEqual([]);
    await expect(database.getAll('readingSessions')).resolves.toEqual([]);
  });

  it('maps corrupt records to a read error', async () => {
    const database = createTestWebDatabase();
    await database.write([
      { type: 'put', store: 'books', value: { id: 'bad', fileHash: 'x' } },
    ]);

    await expect(new WebBookRepository(database).list()).rejects.toMatchObject({
      code: 'DATABASE_READ_FAILED',
    });
  });
});

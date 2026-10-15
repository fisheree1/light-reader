import { IDBFactory } from 'fake-indexeddb';

import { defaultReaderSettings } from '../../features/reader/domain/reader-settings';
import {
  createTestAnnotation,
  createTestBook,
  createTestNote,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { legacyWebStorageKeys, webSettingKeys } from './web-records';

function legacyStorage(entries: Record<string, unknown>): Storage {
  const storage = window.localStorage;
  storage.clear();
  for (const [key, value] of Object.entries(entries)) {
    storage.setItem(
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  }
  return storage;
}

describe('IndexedDbWebDatabase', () => {
  it('applies a batch atomically and rolls back every operation on failure', async () => {
    const database = createTestWebDatabase();
    const book = createTestBook();
    await database.write([{ type: 'add', store: 'books', value: book }]);

    await expect(
      database.write([
        { type: 'put', store: 'notes', value: createTestNote() },
        { type: 'add', store: 'books', value: book },
      ]),
    ).rejects.toMatchObject({ name: 'ConstraintError' });

    await expect(database.getAll('notes')).resolves.toEqual([]);
    await expect(database.getAll('books')).resolves.toEqual([book]);
  });

  it('enforces unique book hashes like the SQLite schema', async () => {
    const database = createTestWebDatabase();
    await database.write([
      { type: 'add', store: 'books', value: createTestBook() },
    ]);

    await expect(
      database.write([
        {
          type: 'add',
          store: 'books',
          value: createTestBook({ id: 'book-2' }),
        },
      ]),
    ).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('deletes by book through indexes, compound keys, and primary keys', async () => {
    const database = createTestWebDatabase();
    await database.write([
      { type: 'put', store: 'annotations', value: createTestAnnotation() },
      {
        type: 'put',
        store: 'annotations',
        value: createTestAnnotation({ id: 'other', bookId: 'book-2' }),
      },
      {
        type: 'put',
        store: 'bookContent',
        value: {
          bookId: 'book-1',
          ordinal: 0,
          chapterHref: 'a',
          chapterTitle: 'A',
          text: 'x',
        },
      },
      {
        type: 'put',
        store: 'bookContent',
        value: {
          bookId: 'book-10',
          ordinal: 0,
          chapterHref: 'a',
          chapterTitle: 'A',
          text: 'x',
        },
      },
      {
        type: 'put',
        store: 'readingStates',
        value: { bookId: 'book-1', updatedAt: 1 },
      },
    ]);

    await database.write([
      { type: 'deleteByBook', store: 'annotations', bookId: 'book-1' },
      { type: 'deleteByBook', store: 'bookContent', bookId: 'book-1' },
      { type: 'deleteByBook', store: 'readingStates', bookId: 'book-1' },
    ]);

    await expect(database.getAll('annotations')).resolves.toMatchObject([
      { id: 'other' },
    ]);
    await expect(database.getAllKeys('bookContent')).resolves.toEqual([
      ['book-10', 0],
    ]);
    await expect(database.getAll('readingStates')).resolves.toEqual([]);
  });

  it('stops cursor iteration early and surfaces visitor errors', async () => {
    const database = createTestWebDatabase();
    await database.write(
      ['a', 'b', 'c'].map((id) => ({
        type: 'put' as const,
        store: 'notes' as const,
        value: createTestNote({ id }),
      })),
    );
    const visited: unknown[] = [];

    await database.iterate('notes', (value) => {
      visited.push(value);
      return visited.length < 2;
    });

    expect(visited).toHaveLength(2);
    await expect(
      database.iterate('notes', () => {
        throw new Error('corrupt record');
      }),
    ).rejects.toThrow('corrupt record');
    await expect(database.write([])).resolves.toBeUndefined();
  });

  it('reopens the same database after the connection is closed', async () => {
    const factory = new IDBFactory();
    const database = createTestWebDatabase(null, factory);
    await database.write([
      { type: 'put', store: 'settings', key: 'k', value: { ok: true } },
    ]);
    await database.close();

    await expect(database.get('settings', 'k')).resolves.toEqual({ ok: true });
    await expect(
      createTestWebDatabase(null, factory).get('settings', 'k'),
    ).resolves.toEqual({ ok: true });
  });
});

describe('legacy localStorage migration', () => {
  it('moves valid records into IndexedDB and removes migrated keys', async () => {
    const book = createTestBook();
    const storage = legacyStorage({
      [legacyWebStorageKeys.books]: [book],
      [legacyWebStorageKeys.libraryMetadata]: {
        [book.id]: { favorite: true, tags: ['历史'] },
      },
      [legacyWebStorageKeys.notes]: [createTestNote()],
      [legacyWebStorageKeys.annotations]: [createTestAnnotation()],
      [legacyWebStorageKeys.bookmarks]: [
        {
          id: 'bookmark-1',
          bookId: book.id,
          name: '书签',
          locator: { version: 1, format: 'epub', chapterHref: 'one.xhtml' },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [legacyWebStorageKeys.readingSessions]: [
        {
          id: 'session-1',
          bookId: book.id,
          startedAt: 1,
          endedAt: 2,
          durationSeconds: 1,
        },
      ],
      [legacyWebStorageKeys.readerSettings]: {
        global: { ...defaultReaderSettings, fontSize: 20 },
        bookOverrides: { [book.id]: { theme: 'dark' } },
        readingStates: {
          [book.id]: {
            bookId: book.id,
            locator: { version: 1, format: 'epub', chapterHref: 'one.xhtml' },
            updatedAt: 5,
          },
        },
      },
      [legacyWebStorageKeys.aiSettings]: {
        schemaVersion: 1,
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'deepseek-r1:8b',
      },
      [legacyWebStorageKeys.bookContent]: [{ derived: true }],
      [legacyWebStorageKeys.bookChunks]: [{ derived: true }],
    });
    const database = createTestWebDatabase(storage);

    await expect(database.getAll('books')).resolves.toEqual([book]);
    await expect(database.getAll('libraryMetadata')).resolves.toEqual([
      { bookId: book.id, favorite: true, tags: ['历史'] },
    ]);
    await expect(database.getAll('notes')).resolves.toHaveLength(1);
    await expect(database.getAll('annotations')).resolves.toHaveLength(1);
    await expect(database.getAll('bookmarks')).resolves.toHaveLength(1);
    await expect(database.getAll('readingSessions')).resolves.toHaveLength(1);
    await expect(
      database.get('settings', webSettingKeys.readerGlobal),
    ).resolves.toMatchObject({ fontSize: 20 });
    await expect(database.get('readerOverrides', book.id)).resolves.toEqual({
      bookId: book.id,
      settings: { theme: 'dark' },
    });
    await expect(database.get('readingStates', book.id)).resolves.toMatchObject(
      { updatedAt: 5 },
    );
    await expect(
      database.get('settings', webSettingKeys.ai),
    ).resolves.toMatchObject({ enabled: true });
    await expect(database.getAll('bookContent')).resolves.toEqual([]);
    expect(Object.keys(storage)).toEqual([]);
  });

  it('keeps legacy keys whose data could not be migrated completely', async () => {
    const book = createTestBook();
    const storage = legacyStorage({
      [legacyWebStorageKeys.books]: [
        book,
        createTestBook({ id: 'duplicate-hash' }),
      ],
      [legacyWebStorageKeys.notes]: [createTestNote(), { id: 'broken' }],
      [legacyWebStorageKeys.annotations]: '{not json',
      [legacyWebStorageKeys.readerSettings]: {
        global: { fontSize: 999 },
        bookOverrides: { [book.id]: { theme: 'neon' } },
        readingStates: { [book.id]: { bookId: book.id } },
      },
      [legacyWebStorageKeys.libraryMetadata]: {
        [book.id]: { favorite: 'yes', tags: [] },
      },
      [legacyWebStorageKeys.aiSettings]: { enabled: 'maybe' },
    });
    const database = createTestWebDatabase(storage);

    await expect(database.getAll('books')).resolves.toEqual([book]);
    await expect(database.getAll('notes')).resolves.toHaveLength(1);
    await expect(database.getAll('annotations')).resolves.toEqual([]);
    await expect(database.getAll('readerOverrides')).resolves.toEqual([]);
    expect(Object.keys(storage).sort()).toEqual(
      [
        legacyWebStorageKeys.aiSettings,
        legacyWebStorageKeys.annotations,
        legacyWebStorageKeys.books,
        legacyWebStorageKeys.libraryMetadata,
        legacyWebStorageKeys.notes,
        legacyWebStorageKeys.readerSettings,
      ].sort(),
    );
  });

  it('only migrates when the database is first created', async () => {
    const factory = new IDBFactory();
    const first = createTestWebDatabase(legacyStorage({}), factory);
    await first.getAll('books');
    await first.close();

    const storage = legacyStorage({
      [legacyWebStorageKeys.books]: [createTestBook()],
    });
    const second = createTestWebDatabase(storage, factory);

    await expect(second.getAll('books')).resolves.toEqual([]);
    expect(storage.getItem(legacyWebStorageKeys.books)).not.toBeNull();
  });
});

import {
  createTestBook,
  createTestNote,
  createTestWebDatabase,
} from '../../test/fixtures/web-records';
import { WebBookRepository } from './web-book-repository';
import { WebLibraryRepository } from './web-library-repository';
import { WebNoteRepository } from './web-note-repository';
import { WebReaderSettingsRepository } from './web-reader-settings-repository';

async function setup() {
  const database = createTestWebDatabase();
  const books = new WebBookRepository(database);
  const notes = new WebNoteRepository(database);
  const settings = new WebReaderSettingsRepository(database);
  await books.create(
    createTestBook({ id: 'zulu', title: 'Zulu', author: null, createdAt: 20 }),
  );
  await books.create(
    createTestBook({
      id: 'alpha',
      title: 'Alpha',
      author: '王小明',
      fileHash: 'b'.repeat(64),
      createdAt: 10,
    }),
  );
  await books.create(
    createTestBook({
      id: 'mid',
      title: 'Mid',
      fileHash: 'c'.repeat(64),
      createdAt: 15,
    }),
  );
  return {
    database,
    books,
    notes,
    settings,
    repository: new WebLibraryRepository(books, notes, settings, database),
  };
}

const options = { query: '', favoritesOnly: false } as const;

describe('WebLibraryRepository', () => {
  it('sorts by title, added time, and recent reading', async () => {
    const { repository, settings } = await setup();
    await settings.saveReadingState('alpha', {
      version: 1,
      format: 'epub',
      chapterHref: 'one.xhtml',
    });

    await expect(
      repository.list({ ...options, sort: 'title' }),
    ).resolves.toMatchObject([{ id: 'alpha' }, { id: 'mid' }, { id: 'zulu' }]);
    await expect(
      repository.list({ ...options, sort: 'added' }),
    ).resolves.toMatchObject([{ id: 'zulu' }, { id: 'mid' }, { id: 'alpha' }]);
    const recent = await repository.list({ ...options, sort: 'recent' });
    expect(recent.map((book) => book.id)).toEqual(['alpha', 'zulu', 'mid']);
    expect(recent[0]?.lastReadAt).toEqual(expect.any(Number));
  });

  it('persists favorites and normalized tags and filters by them', async () => {
    const { repository } = await setup();
    await expect(repository.setFavorite('zulu', true)).resolves.toMatchObject({
      favorite: true,
      tags: [],
    });
    await expect(
      repository.replaceTags('zulu', [' 历史 ', '历史', '小说']),
    ).resolves.toMatchObject({ favorite: true, tags: ['历史', '小说'] });

    await expect(
      repository.list({ ...options, sort: 'added', favoritesOnly: true }),
    ).resolves.toMatchObject([{ id: 'zulu' }]);
    await expect(
      repository.list({ ...options, sort: 'added', query: '小说' }),
    ).resolves.toMatchObject([{ id: 'zulu' }]);
    await expect(
      repository.list({ ...options, sort: 'added', query: '王小明' }),
    ).resolves.toMatchObject([{ id: 'alpha' }]);
    await expect(repository.setFavorite('missing', true)).rejects.toMatchObject(
      { code: 'BOOK_NOT_FOUND' },
    );
  });

  it('deletes the book with note snapshots and its metadata', async () => {
    const { repository, notes, database } = await setup();
    await notes.create(createTestNote());
    await repository.setFavorite('zulu', true);

    await repository.deleteBook('zulu', [
      { id: 'note-1', title: '快照', document: createTestNote().document },
    ]);

    await expect(
      repository.list({ ...options, sort: 'added' }),
    ).resolves.toHaveLength(2);
    await expect(notes.findById('note-1')).resolves.toMatchObject({
      title: '快照',
    });
    await expect(database.getAll('libraryMetadata')).resolves.toEqual([]);
  });

  it('restores note snapshots when deletion fails', async () => {
    const { database, books, notes, settings } = await setup();
    await notes.create(createTestNote());
    const failingBooks = Object.assign(
      Object.create(books) as WebBookRepository,
      {
        delete: () => Promise.reject(new Error('disk full')),
      },
    );
    const repository = new WebLibraryRepository(
      failingBooks,
      notes,
      settings,
      database,
    );

    await expect(
      repository.deleteBook('zulu', [
        { id: 'note-1', title: '快照', document: createTestNote().document },
      ]),
    ).rejects.toMatchObject({ code: 'BOOK_DELETE_FAILED' });
    await expect(notes.findById('note-1')).resolves.toMatchObject({
      title: '读书笔记',
    });
    await expect(books.findById('zulu')).resolves.not.toBeNull();
  });

  it('maps storage failures to typed errors', async () => {
    const { repository, database } = await setup();
    await database.write([
      {
        type: 'put',
        store: 'libraryMetadata',
        value: { bookId: 'zulu', favorite: 'yes' },
      },
    ]);

    await expect(
      repository.list({ ...options, sort: 'added' }),
    ).rejects.toMatchObject({ code: 'DATABASE_READ_FAILED' });
    await expect(repository.setFavorite('zulu', true)).rejects.toMatchObject({
      code: 'BOOK_UPDATE_FAILED',
    });
  });
});

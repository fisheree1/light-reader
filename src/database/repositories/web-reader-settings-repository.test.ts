import { defaultReaderSettings } from '../../features/reader/domain/reader-settings';
import { createTestWebDatabase } from '../../test/fixtures/web-records';
import { WebReaderSettingsRepository } from './web-reader-settings-repository';

describe('WebReaderSettingsRepository', () => {
  it('persists global and per-book display settings', async () => {
    const database = createTestWebDatabase();
    const repository = new WebReaderSettingsRepository(database);
    await expect(repository.getGlobal()).resolves.toEqual(
      defaultReaderSettings,
    );
    await repository.saveGlobal({ ...defaultReaderSettings, fontSize: 22 });
    await expect(
      new WebReaderSettingsRepository(database).getGlobal(),
    ).resolves.toMatchObject({ fontSize: 22 });

    await expect(repository.getBookOverride('book-1')).resolves.toBeNull();
    await repository.saveBookOverride('book-1', { theme: 'dark' });
    await expect(repository.getBookOverride('book-1')).resolves.toEqual({
      theme: 'dark',
    });
    await repository.deleteBookOverride('book-1');
    await expect(repository.getBookOverride('book-1')).resolves.toBeNull();
  });

  it('reads a versioned position after reinitialization', async () => {
    const database = createTestWebDatabase();
    await expect(
      new WebReaderSettingsRepository(database).getReadingState('book-1'),
    ).resolves.toBeNull();
    await new WebReaderSettingsRepository(database).saveReadingState('book-1', {
      version: 1,
      format: 'pdf',
      pageIndex: 3,
    });

    await expect(
      new WebReaderSettingsRepository(database).getReadingState('book-1'),
    ).resolves.toMatchObject({ bookId: 'book-1', locator: { pageIndex: 3 } });
  });

  it('falls back to defaults for partial globals and maps failures', async () => {
    const database = createTestWebDatabase();
    const repository = new WebReaderSettingsRepository(database);
    await database.write([
      { type: 'put', store: 'settings', key: 'reader-global', value: 'bad' },
      {
        type: 'put',
        store: 'readerOverrides',
        value: { bookId: 'book-1', settings: { theme: 'neon' } },
      },
    ]);

    await expect(repository.getGlobal()).resolves.toEqual(
      defaultReaderSettings,
    );
    await expect(repository.getBookOverride('book-1')).rejects.toMatchObject({
      code: 'READER_SETTINGS_READ_FAILED',
    });
    await expect(
      repository.saveGlobal({ ...defaultReaderSettings, fontSize: 99 }),
    ).rejects.toMatchObject({ code: 'READER_SETTINGS_WRITE_FAILED' });
    await expect(
      repository.saveReadingState('', {
        version: 1,
        format: 'pdf',
        pageIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'READING_STATE_WRITE_FAILED' });
  });
});

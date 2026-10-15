import { createTestWebDatabase } from '../../test/fixtures/web-records';
import { WebBookmarkRepository } from './web-bookmark-repository';

describe('WebBookmarkRepository', () => {
  it('creates, searches, renames, and deletes versioned locators', async () => {
    const repository = new WebBookmarkRepository(createTestWebDatabase());
    await repository.create({
      id: 'bookmark-1',
      bookId: 'book-1',
      name: '关键位置',
      locator: {
        version: 1,
        format: 'epub',
        chapterHref: 'one.xhtml',
        cfi: 'epubcfi(/6/2)',
      },
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      repository.listByBook('book-1', '关键'),
    ).resolves.toMatchObject([{ id: 'bookmark-1', locator: { version: 1 } }]);
    await expect(
      repository.rename('bookmark-1', '重命名书签'),
    ).resolves.toMatchObject({ name: '重命名书签' });
    await repository.delete('bookmark-1');
    await expect(repository.listByBook('book-1')).resolves.toEqual([]);
  });

  it('maps missing and corrupt bookmarks to typed errors', async () => {
    const database = createTestWebDatabase();
    const repository = new WebBookmarkRepository(database);

    await expect(repository.rename('missing', '名称')).rejects.toMatchObject({
      code: 'BOOKMARK_NOT_FOUND',
    });
    await database.write([
      { type: 'put', store: 'bookmarks', value: { id: 'x', bookId: 'b' } },
    ]);
    await expect(repository.listByBook('b')).rejects.toMatchObject({
      code: 'BOOKMARK_READ_FAILED',
    });
  });
});

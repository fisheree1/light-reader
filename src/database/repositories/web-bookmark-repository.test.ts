import { WebBookmarkRepository } from './web-bookmark-repository';

describe('WebBookmarkRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates, searches, renames, and deletes versioned locators', async () => {
    const repository = new WebBookmarkRepository();
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
});

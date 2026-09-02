import {
  createBookDeletionPaths,
  createBookStoragePaths,
  fallbackTitleFromFileName,
  fileNameFromPath,
} from './book-paths';

describe('book path helpers', () => {
  it('generates managed paths from an application ID', () => {
    expect(createBookStoragePaths('safe-id-1', 'png')).toEqual({
      stagingDirectory: 'light-reader/tmp/safe-id-1',
      stagingBookPath: 'light-reader/tmp/safe-id-1/book.epub',
      stagingCoverPath: 'light-reader/tmp/safe-id-1/cover.png',
      finalDirectory: 'light-reader/books/safe-id-1',
      finalBookPath: 'light-reader/books/safe-id-1/book.epub',
      finalCoverPath: 'light-reader/covers/safe-id-1.png',
    });
  });

  it('rejects path traversal characters in generated IDs', () => {
    expect(() => createBookStoragePaths('../escape', null)).toThrow();
    expect(() => createBookStoragePaths('folder/book', null)).toThrow();
  });

  it('generates and accepts managed PDF paths', () => {
    expect(createBookStoragePaths('pdf-1', null, 'pdf')).toMatchObject({
      stagingBookPath: 'light-reader/tmp/pdf-1/book.pdf',
      finalBookPath: 'light-reader/books/pdf-1/book.pdf',
    });
    expect(() =>
      createBookDeletionPaths(
        'pdf-1',
        'light-reader/books/pdf-1/book.pdf',
        null,
        'delete-pdf-1',
      ),
    ).not.toThrow();
    expect(fallbackTitleFromFileName('Reference.pdf')).toBe('Reference');
  });

  it('normalizes source display names without using them as target paths', () => {
    expect(fileNameFromPath('C:\\Books\\Example.epub')).toBe('Example.epub');
    expect(fallbackTitleFromFileName(' Example.epub ')).toBe('Example');
  });

  it('stages deletion only inside application-managed paths', () => {
    expect(
      createBookDeletionPaths(
        'book-1',
        'light-reader/books/book-1/book.epub',
        'light-reader/covers/book-1.webp',
        'delete-1',
      ),
    ).toEqual({
      bookId: 'book-1',
      journalPath: 'light-reader/trash/delete-1/deletion.json',
      originalBookDirectory: 'light-reader/books/book-1',
      originalCoverPath: 'light-reader/covers/book-1.webp',
      quarantineBookDirectory: 'light-reader/trash/delete-1/book',
      quarantineCoverPath: 'light-reader/trash/delete-1/cover.webp',
      quarantineDirectory: 'light-reader/trash/delete-1',
    });
  });

  it('rejects external or mismatched paths during deletion', () => {
    expect(() =>
      createBookDeletionPaths(
        'book-1',
        '/Users/example/book.epub',
        null,
        'delete-1',
      ),
    ).toThrow('managed directory');
    expect(() =>
      createBookDeletionPaths(
        'book-1',
        'light-reader/books/book-1/book.epub',
        'light-reader/covers/book-2.webp',
        'delete-1',
      ),
    ).toThrow('managed directory');
    expect(() =>
      createBookDeletionPaths(
        'book-1',
        'light-reader/books/book-1/book.epub',
        null,
        '../trash',
      ),
    ).toThrow('unsafe path');
  });
});

import {
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

  it('normalizes source display names without using them as target paths', () => {
    expect(fileNameFromPath('C:\\Books\\Example.epub')).toBe('Example.epub');
    expect(fallbackTitleFromFileName(' Example.epub ')).toBe('Example');
  });
});

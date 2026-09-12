import { describe, expect, it } from 'vitest';

import { WebReaderBookSource } from './web-reader-book-source';

describe('WebReaderBookSource', () => {
  it('reads the persisted browser binary', async () => {
    const source = new WebReaderBookSource({
      readManagedBook: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    });

    await expect(
      source.read('light-reader/books/book-1/book.pdf'),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('reports a missing browser binary instead of substituting another book', async () => {
    const source = new WebReaderBookSource({
      readManagedBook: () => Promise.reject(new Error('missing')),
    });

    await expect(
      source.read('light-reader/books/missing/book.epub'),
    ).rejects.toMatchObject({ code: 'READER_OPEN_FAILED' });
  });
});

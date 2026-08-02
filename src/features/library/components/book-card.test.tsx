import { render, waitFor } from '@testing-library/react';

import type { BookRepository } from '../../../database/repositories/book-repository';
import type { LibraryBook } from '../domain/library';
import type { LibraryServices } from '../services/library-services';
import { BookCard } from './book-card';

const book: LibraryBook = {
  id: 'book-1',
  title: '封面回收测试',
  author: null,
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: 'light-reader/covers/book-1.webp',
  metadata: {
    title: '封面回收测试',
    creators: [],
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 10,
  createdAt: 1,
  updatedAt: 1,
  favorite: false,
  tags: [],
  lastReadAt: null,
};

function createServices(
  loadCoverUrl: (path: string) => Promise<string | null>,
  releaseCoverUrl: (url: string) => void,
): LibraryServices {
  const repository: BookRepository = {
    create: (value) => Promise.resolve(value),
    findById: () => Promise.resolve(book),
    findByHash: () => Promise.resolve(null),
    list: () => Promise.resolve([book]),
    delete: () => Promise.resolve(),
  };
  return {
    repository,
    importer: { importEpub: () => Promise.resolve({ status: 'cancelled' }) },
    management: {
      deleteBook: () =>
        Promise.resolve({ cleanupPending: false, removedReferences: 0 }),
      list: () => Promise.resolve([book]),
      replaceTags: () => Promise.resolve(book),
      setFavorite: () => Promise.resolve(book),
    },
    loadCoverUrl,
    releaseCoverUrl,
  };
}

describe('BookCard', () => {
  it('releases a cover URL that resolves after the card unmounts', async () => {
    let finishLoad: ((url: string) => void) | undefined;
    const release = vi.fn<(url: string) => void>();
    const services = createServices(
      () =>
        new Promise((resolve) => {
          finishLoad = (url) => {
            resolve(url);
          };
        }),
      release,
    );
    const rendered = render(
      <BookCard
        book={book}
        onManage={() => undefined}
        onOpen={() => undefined}
        onToggleFavorite={() => undefined}
        services={services}
      />,
    );

    rendered.unmount();
    finishLoad?.('blob:late-cover');

    await waitFor(() => {
      expect(release).toHaveBeenCalledWith('blob:late-cover');
    });
  });
});

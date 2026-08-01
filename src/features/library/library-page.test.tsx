import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { BookRepository } from '../../database/repositories/book-repository';
import { AppError } from '../../lib/app-error';
import type { Book } from './domain/book';
import { LibraryPage } from './library-page';
import type { ImportBookResult } from './services/book-import-service';
import type { LibraryServices } from './services/library-services';

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: '一本很长但可以正确截断的测试图书名称',
    author: null,
    format: 'epub',
    filePath: 'light-reader/books/book-1/book.epub',
    fileHash: 'a'.repeat(64),
    coverPath: null,
    metadata: {
      title: '一本很长但可以正确截断的测试图书名称',
      creators: [],
      language: null,
      publisher: null,
      description: null,
      identifier: null,
    },
    fileSize: 20,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

function createServices(
  options: {
    importEpub?: () => Promise<ImportBookResult>;
    list?: () => Promise<Book[]>;
  } = {},
): LibraryServices {
  const books: Book[] = [];
  const repository: BookRepository = {
    create(book) {
      books.push(book);
      return Promise.resolve(book);
    },
    findById(id) {
      return Promise.resolve(books.find((book) => book.id === id) ?? null);
    },
    findByHash(hash) {
      return Promise.resolve(
        books.find((book) => book.fileHash === hash) ?? null,
      );
    },
    list: options.list ?? (() => Promise.resolve(books)),
    delete(id) {
      const index = books.findIndex((book) => book.id === id);
      if (index >= 0) books.splice(index, 1);
      return Promise.resolve();
    },
  };

  return {
    repository,
    importer: {
      importEpub:
        options.importEpub ??
        (() => Promise.resolve({ status: 'created', book: createBook() })),
    },
    loadCoverUrl: () => Promise.resolve(null),
    releaseCoverUrl: () => undefined,
  };
}

describe('LibraryPage', () => {
  it('shows the empty shelf', async () => {
    render(<LibraryPage services={createServices()} />);

    expect(
      await screen.findByRole('heading', { name: '书架还是空的' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入 EPUB' })).toBeEnabled();
  });

  it('shows a loading state while books are loading', () => {
    const neverResolves = new Promise<Book[]>(() => undefined);
    render(
      <LibraryPage services={createServices({ list: () => neverResolves })} />,
    );

    expect(screen.getByText('正在加载书架…')).toBeInTheDocument();
  });

  it('renders persisted book cards and fallback author/cover', async () => {
    render(
      <LibraryPage
        services={createServices({
          list: () => Promise.resolve([createBook()]),
        })}
      />,
    );

    expect(
      await screen.findByRole('button', { name: /一本很长/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('未知作者')).toBeInTheDocument();
    expect(screen.getByText('未开始 · 0%')).toBeInTheDocument();
  });

  it('disables the import button while an import is pending', async () => {
    const user = userEvent.setup();
    const pending = new Promise<ImportBookResult>(() => undefined);
    render(
      <LibraryPage services={createServices({ importEpub: () => pending })} />,
    );
    await screen.findByRole('heading', { name: '书架还是空的' });

    await user.click(screen.getByRole('button', { name: '导入 EPUB' }));
    expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled();
  });

  it('adds a successfully imported book immediately', async () => {
    const user = userEvent.setup();
    render(<LibraryPage services={createServices()} />);
    await screen.findByRole('heading', { name: '书架还是空的' });

    await user.click(screen.getByRole('button', { name: '导入 EPUB' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已导入书架');
    expect(
      screen.getByRole('button', { name: /一本很长/ }),
    ).toBeInTheDocument();
  });

  it('shows duplicate feedback without adding another card', async () => {
    const user = userEvent.setup();
    const duplicate = createBook();
    render(
      <LibraryPage
        services={createServices({
          list: () => Promise.resolve([duplicate]),
          importEpub: () =>
            Promise.resolve({ status: 'duplicate', book: duplicate }),
        })}
      />,
    );
    await screen.findByRole('button', { name: /一本很长/ });

    await user.click(screen.getByRole('button', { name: '导入 EPUB' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已经在书架');
    expect(screen.getAllByRole('button', { name: /一本很长/ })).toHaveLength(1);
  });

  it('shows a friendly import error and allows retry', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const book = createBook();
    render(
      <LibraryPage
        services={createServices({
          importEpub: () => {
            attempts += 1;
            if (attempts === 1) {
              return Promise.reject(new AppError('INVALID_EPUB'));
            }
            return Promise.resolve({ status: 'created', book });
          },
        })}
      />,
    );
    await screen.findByRole('heading', { name: '书架还是空的' });

    await user.click(screen.getByRole('button', { name: '导入 EPUB' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '不是有效的 EPUB',
    );

    await user.click(screen.getByRole('button', { name: '导入 EPUB' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已导入书架');
    });
  });
});

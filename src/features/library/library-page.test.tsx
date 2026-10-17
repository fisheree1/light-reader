import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import { AppError } from '../../lib/app-error';
import { type BookListOptions, type LibraryBook } from './domain/library';
import { LibraryPage } from './library-page';
import type { ImportBookResult } from './services/book-import-service';
import type { LibraryServices } from './services/library-services';

function createBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
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
    favorite: false,
    tags: [],
    lastReadAt: null,
    ...overrides,
  };
}

function createServices(
  configuration: {
    importEpub?: () => Promise<ImportBookResult>;
    initialBooks?: LibraryBook[];
    list?: () => Promise<LibraryBook[]>;
  } = {},
): LibraryServices {
  let books: LibraryBook[] = [...(configuration.initialBooks ?? [])];
  const repository: BookRepository = {
    create(book) {
      books.push({
        ...book,
        favorite: false,
        tags: [],
        lastReadAt: null,
      });
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
    list: configuration.list ?? (() => Promise.resolve(books)),
    delete(id) {
      const index = books.findIndex((book) => book.id === id);
      if (index >= 0) books.splice(index, 1);
      return Promise.resolve();
    },
  };

  return {
    repository,
    management: {
      async list(options: BookListOptions) {
        const source = configuration.list ? await configuration.list() : books;
        const query = options.query.toLocaleLowerCase();
        return source
          .filter(
            (book) =>
              (!options.favoritesOnly || book.favorite) &&
              (!query ||
                book.title.toLocaleLowerCase().includes(query) ||
                (book.author ?? '').toLocaleLowerCase().includes(query) ||
                book.tags.some((tag) =>
                  tag.toLocaleLowerCase().includes(query),
                )),
          )
          .sort((left, right) => {
            if (options.sort === 'title') {
              return left.title.localeCompare(right.title);
            }
            if (options.sort === 'added') {
              return right.createdAt - left.createdAt;
            }
            return (right.lastReadAt ?? -1) - (left.lastReadAt ?? -1);
          });
      },
      setFavorite(id, favorite) {
        const book = books.find((item) => item.id === id);
        if (!book) return Promise.reject(new AppError('BOOK_NOT_FOUND'));
        const updated = { ...book, favorite };
        books = books.map((item) => (item.id === id ? updated : item));
        return Promise.resolve(updated);
      },
      replaceTags(id, tags) {
        const book = books.find((item) => item.id === id);
        if (!book) return Promise.reject(new AppError('BOOK_NOT_FOUND'));
        const updated = { ...book, tags };
        books = books.map((item) => (item.id === id ? updated : item));
        return Promise.resolve(updated);
      },
      updateDetails(id, details) {
        const book = books.find((item) => item.id === id);
        if (!book) return Promise.reject(new AppError('BOOK_NOT_FOUND'));
        const updated = {
          ...book,
          title: details.title,
          author: details.author,
          metadata: { ...book.metadata, series: details.series },
        };
        books = books.map((item) => (item.id === id ? updated : item));
        return Promise.resolve(updated);
      },
      deleteBook(id) {
        books = books.filter((book) => book.id !== id);
        return Promise.resolve({
          cleanupPending: false,
          removedReferences: 0,
        });
      },
    },
    importer: {
      importEpub:
        configuration.importEpub ??
        (() => {
          const created = createBook();
          books.push(created);
          return Promise.resolve({ status: 'created', book: created });
        }),
    },
    loadCoverUrl: () => Promise.resolve(null),
    releaseCoverUrl: () => undefined,
  };
}

function renderLibrary(services: LibraryServices) {
  return render(
    <MemoryRouter>
      <LibraryPage services={services} />
    </MemoryRouter>,
  );
}

describe('LibraryPage', () => {
  it('shows the empty shelf', async () => {
    renderLibrary(createServices());

    expect(
      await screen.findByRole('heading', { name: '导入第一本书' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入电子书' })).toBeEnabled();
    expect(
      screen.queryByRole('region', { name: '书架筛选' }),
    ).not.toBeInTheDocument();
  });

  it('shows a loading state while books are loading', () => {
    const neverResolves = new Promise<LibraryBook[]>(() => undefined);
    renderLibrary(createServices({ list: () => neverResolves }));

    expect(screen.getByText('正在加载书架…')).toBeInTheDocument();
  });

  it('renders persisted book cards and fallback author/cover', async () => {
    renderLibrary(
      createServices({ list: () => Promise.resolve([createBook()]) }),
    );

    expect(
      await screen.findByRole('button', { name: /打开《一本很长/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('未知作者')).toBeInTheDocument();
    expect(screen.getByText('未开始 · 0%')).toBeInTheDocument();
  });

  it('disables the import button while an import is pending', async () => {
    const user = userEvent.setup();
    const pending = new Promise<ImportBookResult>(() => undefined);
    renderLibrary(createServices({ importEpub: () => pending }));
    await screen.findByRole('heading', { name: '导入第一本书' });

    await user.click(screen.getByRole('button', { name: '导入电子书' }));
    expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled();
  });

  it('adds a successfully imported book immediately', async () => {
    const user = userEvent.setup();
    renderLibrary(createServices());
    await screen.findByRole('heading', { name: '导入第一本书' });

    await user.click(screen.getByRole('button', { name: '导入电子书' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已导入书架');
    expect(
      screen.getByRole('button', { name: /打开《一本很长/ }),
    ).toBeInTheDocument();
  });

  it('shows duplicate feedback without adding another card', async () => {
    const user = userEvent.setup();
    const duplicate = createBook();
    renderLibrary(
      createServices({
        list: () => Promise.resolve([duplicate]),
        importEpub: () =>
          Promise.resolve({ status: 'duplicate', book: duplicate }),
      }),
    );
    await screen.findByRole('button', { name: /打开《一本很长/ });

    await user.click(screen.getByRole('button', { name: '导入电子书' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已经在书架');
    expect(
      screen.getAllByRole('button', { name: /打开《一本很长/ }),
    ).toHaveLength(1);
  });

  it('shows a friendly import error and allows retry', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const book = createBook();
    renderLibrary(
      createServices({
        importEpub: () => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.reject(new AppError('INVALID_EPUB'));
          }
          return Promise.resolve({ status: 'created', book });
        },
      }),
    );
    await screen.findByRole('heading', { name: '导入第一本书' });

    await user.click(screen.getByRole('button', { name: '导入电子书' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '不是有效的 EPUB',
    );

    await user.click(screen.getByRole('button', { name: '导入电子书' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已导入书架');
    });
  });

  it('searches tags, sorts titles, and filters favorites', async () => {
    const user = userEvent.setup();
    renderLibrary(
      createServices({
        initialBooks: [
          createBook({
            id: 'book-z',
            title: 'Zulu',
            filePath: 'light-reader/books/book-z/book.epub',
            fileHash: 'z'.repeat(64),
            tags: ['技术'],
            createdAt: 20,
          }),
          createBook({
            id: 'book-a',
            title: 'Alpha',
            filePath: 'light-reader/books/book-a/book.epub',
            fileHash: 'b'.repeat(64),
            tags: ['小说'],
            createdAt: 10,
          }),
        ],
      }),
    );
    await screen.findByRole('button', { name: '打开《Zulu》' });

    await user.selectOptions(screen.getByLabelText('书架排序'), 'title');
    await waitFor(() => {
      const openButtons = within(
        screen.getByRole('region', { name: '书籍' }),
      ).getAllByRole('button', { name: /^打开/ });
      expect(
        openButtons.map((button) => button.getAttribute('aria-label')),
      ).toEqual(['打开《Alpha》', '打开《Zulu》']);
    });

    await user.click(screen.getByRole('button', { name: '收藏《Zulu》' }));
    expect(
      await screen.findByRole('button', { name: '取消收藏《Zulu》' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByLabelText('仅显示收藏'));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '打开《Zulu》' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: '打开《Alpha》' }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('仅显示收藏'));
    await user.type(
      screen.getByRole('searchbox', { name: '搜索书架' }),
      '小说',
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '打开《Alpha》' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: '打开《Zulu》' }),
      ).not.toBeInTheDocument();
    });
  });

  it('edits tags and requires a second confirmation before deletion', async () => {
    const user = userEvent.setup();
    renderLibrary(
      createServices({ initialBooks: [createBook({ title: '受控删除' })] }),
    );
    await screen.findByRole('button', { name: '打开《受控删除》' });

    await user.click(screen.getByRole('button', { name: '管理《受控删除》' }));
    await user.type(await screen.findByLabelText('标签'), '技术, 待读');
    await user.click(screen.getByRole('button', { name: '保存标签' }));
    await user.click(screen.getByRole('button', { name: '关闭书籍管理' }));
    expect(await screen.findByRole('status')).toHaveTextContent('标签已保存');
    expect(screen.getByText('技术')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '管理《受控删除》' }));
    await user.click(
      screen.getByRole('button', { name: /删除文件但保留笔记引用/ }),
    );
    expect(
      screen.getByRole('heading', { name: /确认删除《受控删除》/ }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '打开《受控删除》' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('笔记引用快照已保留');
  });
});

describe('LibraryPage series', () => {
  const volume = (
    id: string,
    title: string,
    index: number,
    lastReadAt: number | null,
  ) =>
    createBook({
      id,
      title,
      filePath: `light-reader/books/${id}/book.epub`,
      lastReadAt,
      metadata: {
        ...createBook().metadata,
        title,
        series: { title: '测试系列', index },
      },
    });

  it('collapses a series and continues its most recently read volume', async () => {
    const user = userEvent.setup();
    renderLibrary(
      createServices({
        initialBooks: [
          volume('v2', '测试系列 第二卷', 2, 50),
          createBook({
            id: 'solo',
            title: '独立作品',
            filePath: 'light-reader/books/solo/book.epub',
          }),
          volume('v1', '测试系列 第一卷', 1, 20),
        ],
      }),
    );

    const series = await screen.findByRole('region', {
      name: '系列《测试系列》',
    });
    expect(within(series).getByText('2 卷 · 已开始 2 卷')).toBeVisible();
    expect(
      within(series).queryByRole('button', { name: '打开《测试系列 第一卷》' }),
    ).not.toBeInTheDocument();
    expect(
      within(series).getByRole('button', { name: '继续阅读：测试系列 第二卷' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '打开《独立作品》' }),
    ).toBeVisible();

    await user.click(
      within(series).getByRole('button', { name: '展开系列《测试系列》' }),
    );
    expect(
      within(series)
        .getAllByRole('button', { name: /^打开《/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['打开《测试系列 第一卷》', '打开《测试系列 第二卷》']);

    await user.click(screen.getByRole('checkbox', { name: '按系列分组' }));
    expect(
      screen.queryByRole('region', { name: /系列《/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^打开《/ })).toHaveLength(3);
  });

  it('edits title, author and series from book management', async () => {
    const user = userEvent.setup();
    renderLibrary(
      createServices({
        initialBooks: [
          volume('v1', '测试系列 第一卷', 1, null),
          createBook({
            id: 'v2',
            title: '旧书名',
            filePath: 'light-reader/books/v2/book.epub',
          }),
        ],
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: '管理《旧书名》' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('书名'));
    await user.type(within(dialog).getByLabelText('书名'), '测试系列 第二卷');
    await user.type(within(dialog).getByLabelText('作者'), '作者甲');
    await user.type(within(dialog).getByLabelText('系列名'), '测试系列');
    await user.type(within(dialog).getByLabelText('系列顺序'), 'x');
    expect(within(dialog).getByText(/请输入 0–100000/)).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: '保存书籍信息' }),
    ).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('系列顺序'));
    await user.type(within(dialog).getByLabelText('系列顺序'), '2');
    await user.click(
      within(dialog).getByRole('button', { name: '保存书籍信息' }),
    );

    expect(await screen.findByText('书籍信息已保存。')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('region', { name: '系列《测试系列》' }),
    ).toBeVisible();
    expect(screen.getByText('2 卷 · 已开始 0 卷')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '开始阅读：测试系列 第一卷' }),
    ).toBeVisible();
  });
});

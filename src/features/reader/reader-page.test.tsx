import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import type {
  BookLocator,
  EbookReader,
  ReaderTocItem,
  RelocationListener,
} from '../../reader-engines/types';
import type { Book } from '../library/domain/book';
import { ReaderPage } from './reader-page';
import type { ReaderServices } from './services/reader-services';

const BOOK: Book = {
  id: 'book-1',
  title: '可阅读的测试图书',
  author: 'LightReader',
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '可阅读的测试图书',
    creators: ['LightReader'],
    language: 'zh-CN',
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 100,
  createdAt: 1,
  updatedAt: 1,
};

class FakeReader implements EbookReader {
  readonly close = vi.fn(() => Promise.resolve());
  readonly goTo = vi.fn(() => Promise.resolve());
  readonly nextPage = vi.fn(() => Promise.resolve());
  readonly previousPage = vi.fn(() => Promise.resolve());
  private listener: RelocationListener | null = null;

  mount(host: HTMLElement): void {
    const content = document.createElement('p');
    content.textContent = '渲染后的 EPUB 正文';
    host.replaceChildren(content);
  }

  open(): Promise<void> {
    return Promise.resolve();
  }

  getTableOfContents(): ReaderTocItem[] {
    return [
      { href: 'one.xhtml', label: '第一章', subitems: [] },
      { href: 'two.xhtml', label: '第二章', subitems: [] },
    ];
  }

  getCurrentLocator(): Promise<BookLocator> {
    return Promise.resolve({ version: 1, format: 'epub', progression: 0 });
  }

  subscribeToRelocation(listener: RelocationListener): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(locator: BookLocator) {
    this.listener?.(locator);
  }
}

function createRepository(book: Book | null = BOOK): BookRepository {
  return {
    create: (value) => Promise.resolve(value),
    findById: () => Promise.resolve(book),
    findByHash: () => Promise.resolve(null),
    list: () => Promise.resolve(book ? [book] : []),
    delete: () => Promise.resolve(),
  };
}

function renderReader(services: ReaderServices) {
  return render(
    <MemoryRouter initialEntries={['/reader/book-1']}>
      <Routes>
        <Route
          element={<ReaderPage services={services} />}
          path="/reader/:bookId"
        />
        <Route element={<div>书架页面</div>} path="/library" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReaderPage', () => {
  it('shows loading while the managed EPUB is being read', async () => {
    const reader = new FakeReader();
    renderReader({
      repository: createRepository(),
      source: { read: () => new Promise(() => undefined) },
      createReader: () => reader,
    });

    expect(screen.getAllByText('正在打开 EPUB…')).not.toHaveLength(0);
    expect(await screen.findByText(BOOK.title)).toBeInTheDocument();
  });

  it('renders the TOC, navigates, paginates, and reports relocation', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    renderReader({
      repository: createRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });

    expect(await screen.findByRole('button', { name: '第二章' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '第二章' }));
    expect(reader.goTo).toHaveBeenCalledWith({
      version: 1,
      format: 'epub',
      chapterHref: 'two.xhtml',
    });

    await user.click(screen.getByRole('button', { name: '下一页' }));
    await user.click(screen.getByRole('button', { name: '上一页' }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(reader.nextPage).toHaveBeenCalledTimes(2);
    expect(reader.previousPage).toHaveBeenCalledTimes(2);

    reader.emit({
      version: 1,
      format: 'epub',
      chapterHref: 'two.xhtml',
      progression: 0.48,
    });
    expect(await screen.findByLabelText('阅读进度 48%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第二章' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('shows a friendly error and retries', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    renderReader({
      repository: createRepository(),
      source: {
        read: () => {
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new Error('missing file'))
            : Promise.resolve(new ArrayBuffer(1));
        },
      },
      createReader: () => new FakeReader(),
    });

    expect(
      await screen.findByRole('heading', { name: '无法打开图书' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: '第一章' })).toBeVisible();
  });

  it('closes the engine when leaving the reader', async () => {
    const reader = new FakeReader();
    const rendered = renderReader({
      repository: createRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });
    await screen.findByRole('button', { name: '第一章' });

    rendered.unmount();
    await waitFor(() => {
      expect(reader.close).toHaveBeenCalledOnce();
    });
  });
});

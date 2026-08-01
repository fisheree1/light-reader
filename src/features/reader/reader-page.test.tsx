import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import type { ReaderSettingsRepository } from '../../database/repositories/reader-settings-repository';
import { defaultReaderSettings } from './domain/reader-settings';
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
  readonly applyDisplaySettings = vi.fn();
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

function createSettingsRepository(): ReaderSettingsRepository {
  return {
    getGlobal: () => Promise.resolve(defaultReaderSettings),
    saveGlobal: (settings) => Promise.resolve(settings),
    getBookOverride: () => Promise.resolve(null),
    saveBookOverride: (_bookId, settings) => Promise.resolve(settings),
    deleteBookOverride: () => Promise.resolve(),
    getReadingState: () => Promise.resolve(null),
    saveReadingState: (bookId, locator) =>
      Promise.resolve({ bookId, locator, updatedAt: 1 }),
  };
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
      settingsRepository: createSettingsRepository(),
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
      settingsRepository: createSettingsRepository(),
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
      settingsRepository: createSettingsRepository(),
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
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });
    await screen.findByRole('button', { name: '第一章' });

    rendered.unmount();
    await waitFor(() => {
      expect(reader.close).toHaveBeenCalledOnce();
    });
  });

  it('restores and debounces persistence of the reading position', async () => {
    const reader = new FakeReader();
    const settingsRepository = createSettingsRepository();
    vi.spyOn(settingsRepository, 'getReadingState').mockResolvedValue({
      bookId: BOOK.id,
      locator: { version: 1, format: 'epub', progression: 0.31 },
      updatedAt: 1,
    });
    const saveReadingState = vi.spyOn(settingsRepository, 'saveReadingState');
    renderReader({
      repository: createRepository(),
      settingsRepository,
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });

    await screen.findByRole('button', { name: '第一章' });
    expect(reader.goTo).toHaveBeenCalledWith({
      version: 1,
      format: 'epub',
      progression: 0.31,
    });
    reader.emit({ version: 1, format: 'epub', progression: 0.63 });
    reader.emit({ version: 1, format: 'epub', progression: 0.64 });

    await waitFor(
      () => {
        expect(saveReadingState).toHaveBeenCalledTimes(1);
        expect(saveReadingState).toHaveBeenCalledWith(BOOK.id, {
          version: 1,
          format: 'epub',
          progression: 0.64,
        });
      },
      { timeout: 1200 },
    );
  });

  it('saves a per-book reading override and applies it to the engine', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    const settingsRepository = createSettingsRepository();
    const saveBookOverride = vi.spyOn(settingsRepository, 'saveBookOverride');
    renderReader({
      repository: createRepository(),
      settingsRepository,
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });

    await screen.findByRole('button', { name: '第一章' });
    await user.click(screen.getByRole('button', { name: '阅读设置' }));
    await user.click(screen.getByLabelText('为本书使用单独设置'));
    await user.selectOptions(screen.getByLabelText('阅读主题'), 'dark');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(saveBookOverride).toHaveBeenCalledWith(BOOK.id, {
        ...defaultReaderSettings,
        theme: 'dark',
      });
      expect(reader.applyDisplaySettings).toHaveBeenLastCalledWith({
        ...defaultReaderSettings,
        theme: 'dark',
      });
    });
  });
});

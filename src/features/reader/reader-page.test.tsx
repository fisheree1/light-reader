import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from 'react-router-dom';

import type { BookRepository } from '../../database/repositories/book-repository';
import type { AnnotationRepository } from '../../database/repositories/annotation-repository';
import type { ReaderSettingsRepository } from '../../database/repositories/reader-settings-repository';
import type { NoteRepository } from '../../database/repositories/note-repository';
import { defaultReaderSettings } from './domain/reader-settings';
import type { Annotation } from '../annotations/domain/annotation';
import type {
  BookLocator,
  EbookReader,
  ReaderTocItem,
  RelocationListener,
  SelectionListener,
  HighlightActivationListener,
  ReaderTextSelection,
  ReaderHighlight,
  HighlightRestoreResult,
} from '../../reader-engines/types';
import type { Book } from '../library/domain/book';
import type { Note } from '../notes/domain/note';
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

const ANNOTATION: Annotation = {
  id: 'annotation-1',
  bookId: BOOK.id,
  text: '渲染后的 EPUB 正文',
  textBefore: null,
  textAfter: null,
  chapterHref: 'one.xhtml',
  locator: {
    version: 1,
    format: 'epub',
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
  },
  color: 'yellow',
  noteText: null,
  createdAt: 1,
  updatedAt: 1,
};

class FakeReader implements EbookReader {
  readonly applyDisplaySettings = vi.fn();
  readonly close = vi.fn(() => Promise.resolve());
  readonly goTo = vi.fn(() => Promise.resolve());
  readonly nextPage = vi.fn(() => Promise.resolve());
  readonly previousPage = vi.fn(() => Promise.resolve());
  readonly createHighlight = vi.fn(() => Promise.resolve());
  readonly removeHighlight = vi.fn(() => Promise.resolve());
  readonly restoreHighlights = vi.fn<
    (highlights: ReaderHighlight[]) => Promise<HighlightRestoreResult[]>
  >((highlights) =>
    Promise.resolve(
      highlights.map((highlight) => ({
        id: highlight.id,
        status: 'restored',
      })),
    ),
  );
  readonly showHighlight = vi.fn(() => Promise.resolve());
  private listener: RelocationListener | null = null;
  private selectionListener: SelectionListener | null = null;
  private highlightActivationListener: HighlightActivationListener | null =
    null;
  private selection: ReaderTextSelection | null = null;

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

  getSelection(): ReaderTextSelection | null {
    return this.selection;
  }

  subscribeToSelection(listener: SelectionListener): () => void {
    this.selectionListener = listener;
    return () => {
      this.selectionListener = null;
    };
  }

  subscribeToHighlightActivation(
    listener: HighlightActivationListener,
  ): () => void {
    this.highlightActivationListener = listener;
    return () => {
      this.highlightActivationListener = null;
    };
  }

  emit(locator: BookLocator) {
    this.listener?.(locator);
  }

  emitSelection(selection: ReaderTextSelection | null) {
    this.selection = selection;
    this.selectionListener?.(selection);
  }

  activateHighlight(id: string) {
    this.highlightActivationListener?.(id);
  }
}

function createAnnotationRepository(): AnnotationRepository {
  return {
    create: (annotation) => Promise.resolve(annotation),
    findByBookId: () => Promise.resolve([]),
    findById: () => Promise.resolve(null),
    updateColor: () => Promise.reject(new Error('not used')),
    updateNote: () => Promise.reject(new Error('not used')),
    delete: () => Promise.resolve(),
  };
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

function createNoteRepository(): NoteRepository {
  const notes: Note[] = [];
  return {
    create: (note) => {
      notes.push(note);
      return Promise.resolve(note);
    },
    findById: (id) =>
      Promise.resolve(notes.find((note) => note.id === id) ?? null),
    list: () => Promise.resolve(notes),
    update: () => Promise.reject(new Error('not used')),
    delete: () => Promise.resolve(),
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
        <Route element={<div>笔记页面</div>} path="/notes" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReaderPage', () => {
  it('shows loading while the managed EPUB is being read', async () => {
    const reader = new FakeReader();
    renderReader({
      annotationRepository: createAnnotationRepository(),
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => new Promise(() => undefined) },
      createReader: () => reader,
    });

    expect(screen.getAllByText('正在打开电子书…')).not.toHaveLength(0);
    expect(await screen.findByText(BOOK.title)).toBeInTheDocument();
  });

  it('renders the TOC, navigates, paginates, and reports relocation', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    renderReader({
      annotationRepository: createAnnotationRepository(),
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

  it('uses one accessible right sidebar and restores focus after closing AI', async () => {
    const user = userEvent.setup();
    renderReader({
      annotationRepository: createAnnotationRepository(),
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => new FakeReader(),
    });
    await screen.findByRole('button', { name: '第一章' });

    const trigger = screen.getByRole('button', { name: '显示 AI 助手' });
    await user.click(trigger);
    expect(
      await screen.findByRole('complementary', {
        name: '本地 AI 阅读助手',
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText('高亮与批注')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭 AI 阅读助手' }));
    expect(
      screen.queryByRole('complementary', {
        name: '本地 AI 阅读助手',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示 AI 助手' })).toHaveFocus();
  });

  it('shows a friendly error and retries', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    renderReader({
      annotationRepository: createAnnotationRepository(),
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
      annotationRepository: createAnnotationRepository(),
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

  it('keeps the newest session mounted when books switch rapidly', async () => {
    const secondBook: Book = {
      ...BOOK,
      id: 'book-2',
      title: '快速切换后的图书',
      filePath: 'light-reader/books/book-2/book.epub',
      fileHash: 'b'.repeat(64),
    };
    let finishFirstRead: ((source: ArrayBuffer) => void) | undefined;
    const firstReader = new FakeReader();
    const secondReader = new FakeReader();
    const repository: BookRepository = {
      ...createRepository(),
      findById: (id) =>
        Promise.resolve(
          id === BOOK.id ? BOOK : id === secondBook.id ? secondBook : null,
        ),
    };
    const services: ReaderServices = {
      annotationRepository: createAnnotationRepository(),
      repository,
      settingsRepository: createSettingsRepository(),
      source: {
        read: (path) =>
          path.includes('book-1')
            ? new Promise((resolve) => {
                finishFirstRead = resolve;
              })
            : Promise.resolve(new ArrayBuffer(1)),
      },
      createReader: vi
        .fn<() => EbookReader>()
        .mockReturnValueOnce(firstReader)
        .mockReturnValueOnce(secondReader),
    };
    const router = createMemoryRouter(
      [
        {
          path: '/reader/:bookId',
          element: <ReaderPage services={services} />,
        },
      ],
      { initialEntries: ['/reader/book-1'] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(BOOK.title)).toBeVisible();
    await router.navigate('/reader/book-2');
    expect(
      await screen.findByRole('heading', { name: secondBook.title }),
    ).toBeVisible();
    expect(await screen.findByRole('button', { name: '第一章' })).toBeVisible();
    finishFirstRead?.(new ArrayBuffer(1));

    await waitFor(() => {
      expect(firstReader.close).toHaveBeenCalledOnce();
    });
    expect(secondReader.close).not.toHaveBeenCalled();
    expect(screen.getByLabelText('EPUB 正文')).toHaveTextContent(
      '渲染后的 EPUB 正文',
    );
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
      annotationRepository: createAnnotationRepository(),
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

  it('keeps the EPUB open when a saved locator can no longer resolve', async () => {
    const reader = new FakeReader();
    reader.goTo.mockRejectedValue(new Error('stale CFI'));
    const settingsRepository = createSettingsRepository();
    vi.spyOn(settingsRepository, 'getReadingState').mockResolvedValue({
      bookId: BOOK.id,
      locator: {
        version: 1,
        format: 'epub',
        cfi: 'epubcfi(/stale)',
        progression: 0.4,
      },
      updatedAt: 1,
    });
    renderReader({
      annotationRepository: createAnnotationRepository(),
      repository: createRepository(),
      settingsRepository,
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });

    expect(await screen.findByRole('button', { name: '第一章' })).toBeVisible();
    expect(screen.getByText('无法跳转到指定阅读位置。')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: '无法打开图书' }),
    ).not.toBeInTheDocument();
    expect(reader.goTo).toHaveBeenNthCalledWith(2, {
      version: 1,
      format: 'epub',
      progression: 0.4,
    });
  });

  it('saves a per-book reading override and applies it to the engine', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    const settingsRepository = createSettingsRepository();
    const saveBookOverride = vi.spyOn(settingsRepository, 'saveBookOverride');
    renderReader({
      annotationRepository: createAnnotationRepository(),
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

  it('creates a colored highlight from the current text selection', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    const annotationRepository = createAnnotationRepository();
    const create = vi.spyOn(annotationRepository, 'create');
    renderReader({
      annotationRepository,
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });
    await screen.findByRole('button', { name: '第一章' });

    act(() => {
      reader.emitSelection({
        text: '渲染后的 EPUB 正文',
        textBefore: null,
        textAfter: null,
        locator: ANNOTATION.locator,
      });
    });
    await user.click(await screen.findByRole('button', { name: '绿色高亮' }));
    await user.click(screen.getByRole('button', { name: '添加高亮' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookId: BOOK.id,
          text: '渲染后的 EPUB 正文',
          color: 'green',
          locator: ANNOTATION.locator,
        }),
      );
      expect(reader.createHighlight).toHaveBeenCalled();
    });
    expect(screen.getByLabelText('高亮与批注')).toHaveTextContent(
      '渲染后的 EPUB 正文',
    );
  });

  it('opens an activated highlight, saves a note, and deletes it', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    const updateNote = vi.fn((_id: string, noteText: string | null) =>
      Promise.resolve({ ...ANNOTATION, noteText, updatedAt: 2 }),
    );
    const remove = vi.fn(() => Promise.resolve());
    const annotationRepository: AnnotationRepository = {
      ...createAnnotationRepository(),
      findByBookId: () => Promise.resolve([ANNOTATION]),
      updateNote,
      delete: remove,
    };
    renderReader({
      annotationRepository,
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });
    await screen.findByText(ANNOTATION.text);

    reader.activateHighlight(ANNOTATION.id);
    const input = await screen.findByLabelText('批注内容');
    await user.type(input, '我的批注');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(updateNote).toHaveBeenCalledWith(ANNOTATION.id, '我的批注');
    });

    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(ANNOTATION.id);
    });
    expect(screen.queryByLabelText('批注内容')).not.toBeInTheDocument();
  });

  it('keeps a stale restored highlight and marks it as unresolved', async () => {
    const reader = new FakeReader();
    reader.restoreHighlights.mockResolvedValue([
      { id: ANNOTATION.id, status: 'unresolved' },
    ]);
    const annotationRepository: AnnotationRepository = {
      ...createAnnotationRepository(),
      findByBookId: () => Promise.resolve([ANNOTATION]),
    };
    renderReader({
      annotationRepository,
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });

    expect(await screen.findByText('无法定位原文')).toBeInTheDocument();
    expect(screen.getByLabelText('高亮与批注')).toHaveTextContent(
      ANNOTATION.text,
    );
  });

  it('creates a quote note from an activated highlight', async () => {
    const user = userEvent.setup();
    const reader = new FakeReader();
    const annotationRepository: AnnotationRepository = {
      ...createAnnotationRepository(),
      findByBookId: () => Promise.resolve([ANNOTATION]),
    };
    const noteRepository = createNoteRepository();
    const create = vi.spyOn(noteRepository, 'create');
    renderReader({
      annotationRepository,
      noteRepository,
      repository: createRepository(),
      settingsRepository: createSettingsRepository(),
      source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
      createReader: () => reader,
    });
    await screen.findByText(ANNOTATION.text);

    reader.activateHighlight(ANNOTATION.id);
    await user.click(await screen.findByRole('button', { name: '插入笔记' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
      const created = create.mock.calls.at(0)?.[0];
      expect(created?.title).toBe(`关于《${BOOK.title}》的笔记`);
      expect(created?.document.schemaVersion).toBe(1);
    });
    expect(await screen.findByText('笔记页面')).toBeVisible();
  });

  it('opens a quote locator even when its source annotation was deleted', async () => {
    const reader = new FakeReader();
    const target = {
      annotationId: 'deleted-annotation',
      locator: {
        version: 1 as const,
        format: 'epub' as const,
        chapterHref: 'one.xhtml',
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
      },
    };
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/reader/book-1',
            state: { readerNavigation: target },
          },
        ]}
      >
        <Routes>
          <Route
            element={
              <ReaderPage
                services={{
                  annotationRepository: createAnnotationRepository(),
                  repository: createRepository(),
                  settingsRepository: createSettingsRepository(),
                  source: { read: () => Promise.resolve(new ArrayBuffer(1)) },
                  createReader: () => reader,
                }}
              />
            }
            path="/reader/:bookId"
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '第一章' });
    expect(reader.goTo).toHaveBeenCalledWith(target.locator);
  });
});

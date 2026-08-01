import { AppError } from '../lib/app-error';
import { FoliateEbookReader } from './foliate-ebook-reader';

interface FakeFoliateView extends HTMLElement {
  book: {
    destroy: () => void;
    sections: { unload: () => void }[];
    toc: unknown;
  };
  close: () => void;
  goTo: (target: string | { fraction: number }) => Promise<unknown>;
  init: (options: { showTextStart: boolean }) => Promise<void>;
  next: () => Promise<void>;
  open: (source: Blob) => Promise<void>;
  prev: () => Promise<void>;
  renderer: {
    setAttribute: ReturnType<
      typeof vi.fn<(name: string, value: string) => void>
    >;
    setStyles: ReturnType<typeof vi.fn<(styles: string) => void>>;
  };
}

function createFakeView(): FakeFoliateView {
  const element = document.createElement('div') as unknown as FakeFoliateView;
  element.book = {
    destroy: vi.fn(),
    sections: [{ unload: vi.fn() }],
    toc: [
      {
        href: 'one.xhtml',
        label: '第一章',
        subitems: [{ href: 'one.xhtml#part', label: { zh: '第一节' } }],
      },
    ],
  };
  element.close = vi.fn();
  element.goTo = vi.fn(() => Promise.resolve());
  element.init = vi.fn(() => Promise.resolve());
  element.next = vi.fn(() => Promise.resolve());
  element.open = vi.fn(() => Promise.resolve());
  element.prev = vi.fn(() => Promise.resolve());
  element.renderer = {
    setAttribute: vi.fn<(name: string, value: string) => void>(),
    setStyles: vi.fn<(styles: string) => void>(),
  };
  return element;
}

function createReader(view = createFakeView()) {
  const reader = new FoliateEbookReader(
    () => Promise.resolve(),
    () => view,
  );
  const host = document.createElement('div');
  reader.mount(host);
  return { host, reader, view };
}

describe('FoliateEbookReader', () => {
  it('opens, exposes a safe TOC, relocates, and navigates', async () => {
    const { host, reader, view } = createReader();
    const listener = vi.fn();
    reader.subscribeToRelocation(listener);

    await reader.open(new Uint8Array([1, 2, 3]).buffer);
    expect(host.firstElementChild).toBe(view);
    expect(view.open).toHaveBeenCalledWith(expect.any(File));
    expect(view.init).toHaveBeenCalledWith({ showTextStart: true });
    reader.applyDisplaySettings({
      theme: 'sepia',
      fontSize: 20,
      lineHeight: 1.8,
      contentWidth: 680,
      margin: 40,
    });
    expect(view.renderer.setAttribute).toHaveBeenCalledWith(
      'max-inline-size',
      '680px',
    );
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('margin', '40px');
    expect(view.renderer.setStyles).toHaveBeenCalledWith(
      expect.stringContaining('background: #f4ecd8'),
    );
    expect(reader.getTableOfContents()).toEqual([
      {
        href: 'one.xhtml',
        label: '第一章',
        subitems: [{ href: 'one.xhtml#part', label: '第一节', subitems: [] }],
      },
    ]);

    view.dispatchEvent(
      new CustomEvent('relocate', {
        detail: {
          cfi: 'epubcfi(/6/2)',
          fraction: 1.5,
          tocItem: { href: 'one.xhtml' },
        },
      }),
    );
    await expect(reader.getCurrentLocator()).resolves.toEqual({
      version: 1,
      format: 'epub',
      chapterHref: 'one.xhtml',
      cfi: 'epubcfi(/6/2)',
      progression: 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    await reader.goTo({
      version: 1,
      format: 'epub',
      chapterHref: 'one.xhtml',
    });
    await reader.previousPage();
    await reader.nextPage();
    expect(view.goTo).toHaveBeenCalledWith('one.xhtml');
    expect(view.prev).toHaveBeenCalledOnce();
    expect(view.next).toHaveBeenCalledOnce();
  });

  it('blocks external links and cleans up idempotently', async () => {
    const { host, reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));

    const allowed = view.dispatchEvent(
      new CustomEvent('external-link', { cancelable: true }),
    );
    expect(allowed).toBe(false);

    await reader.close();
    await reader.close();
    expect(view.book.sections[0]?.unload).toHaveBeenCalledOnce();
    expect(view.book.destroy).toHaveBeenCalledOnce();
    expect(view.close).toHaveBeenCalledOnce();
    expect(host).toBeEmptyDOMElement();
  });

  it('maps an upstream open failure and removes the partial view', async () => {
    const view = createFakeView();
    view.open = vi.fn(() => Promise.reject(new Error('corrupt EPUB')));
    const { host, reader } = createReader(view);

    await expect(reader.open(new ArrayBuffer(1))).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    } satisfies Partial<AppError>);
    expect(host).toBeEmptyDOMElement();
    expect(view.close).toHaveBeenCalledOnce();
  });
});

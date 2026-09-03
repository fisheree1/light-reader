import { AppError } from '../lib/app-error';
import { FoliateEbookReader } from './foliate-ebook-reader';

interface FakeFoliateView extends HTMLElement {
  book: {
    destroy: () => void;
    sections: { id: string; unload: () => void }[];
    toc: unknown;
  };
  close: () => void;
  goTo: (target: string | { fraction: number }) => Promise<unknown>;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (annotation: {
    color: string;
    value: string;
  }) => Promise<unknown>;
  deleteAnnotation: (annotation: {
    color: string;
    value: string;
  }) => Promise<unknown>;
  showAnnotation: (annotation: {
    color: string;
    value: string;
  }) => Promise<unknown>;
  init: (options: { showTextStart: boolean }) => Promise<void>;
  next: () => Promise<void>;
  open: (source: Blob) => Promise<void>;
  prev: () => Promise<void>;
  search: (options: { index: number; query: string }) => AsyncIterable<
    | string
    | {
        cfi?: string;
        excerpt?: { match: string; post: string; pre: string };
      }
  >;
  clearSearch: () => void;
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
    sections: [{ id: 'one.xhtml', unload: vi.fn() }],
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
  element.getCFI = vi.fn(() => 'epubcfi(/6/2!/4/2,/1:0,/1:4)');
  element.addAnnotation = vi.fn(() => Promise.resolve());
  element.deleteAnnotation = vi.fn(() => Promise.resolve());
  element.showAnnotation = vi.fn(() => Promise.resolve());
  element.init = vi.fn(() => Promise.resolve());
  element.next = vi.fn(() => Promise.resolve());
  element.open = vi.fn(() => Promise.resolve());
  element.prev = vi.fn(() => Promise.resolve());
  element.search = vi.fn(async function* () {
    await Promise.resolve();
    yield {
      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      excerpt: { pre: '前文', match: '关键词', post: '后文' },
    };
    yield 'done';
  });
  element.clearSearch = vi.fn();
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

function touchPointerEvent(
  type: 'pointerdown' | 'pointerup',
  x: number,
  y: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: 'touch' },
  });
  return event;
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
      fontFamily: 'sans-serif',
      fontWeight: 600,
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
    expect(view.renderer.setStyles).toHaveBeenCalledWith(
      expect.stringContaining('font-weight: 600'),
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

  it('searches the current chapter and clears renderer highlights', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    view.dispatchEvent(
      new CustomEvent('relocate', {
        detail: {
          index: 0,
          tocItem: { href: 'one.xhtml' },
        },
      }),
    );

    await expect(reader.searchCurrentChapter('关键词')).resolves.toEqual([
      {
        excerpt: { pre: '前文', match: '关键词', post: '后文' },
        locator: {
          version: 1,
          format: 'epub',
          chapterHref: 'one.xhtml',
          cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
        },
      },
    ]);
    expect(view.search).toHaveBeenCalledWith({ index: 0, query: '关键词' });
    reader.clearSearch();
    expect(view.clearSearch).toHaveBeenCalledOnce();
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

  it('continues renderer cleanup when one section unload throws', async () => {
    const view = createFakeView();
    view.book.sections[0] = {
      id: 'one.xhtml',
      unload: vi.fn(() => {
        throw new Error('section already detached');
      }),
    };
    const { host, reader } = createReader(view);
    await reader.open(new ArrayBuffer(1));

    await expect(reader.close()).resolves.toBeUndefined();
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

  it('cancels an obsolete open before it can mount a delayed Foliate view', async () => {
    let finishModuleLoad: (() => void) | undefined;
    const view = createFakeView();
    const viewFactory = vi.fn(() => view);
    const reader = new FoliateEbookReader(
      () =>
        new Promise((resolve) => {
          finishModuleLoad = () => {
            resolve(undefined);
          };
        }),
      viewFactory,
    );
    const host = document.createElement('div');
    reader.mount(host);

    const opening = reader.open(new ArrayBuffer(1));
    await vi.waitFor(() => {
      expect(finishModuleLoad).toBeDefined();
    });
    await reader.close();
    finishModuleLoad?.();

    await expect(opening).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    } satisfies Partial<AppError>);
    expect(viewFactory).not.toHaveBeenCalled();
    expect(host).toBeEmptyDOMElement();
  });

  it('maps document selection into text, context, and a range CFI', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    const doc = document;
    const paragraph = doc.createElement('p');
    paragraph.textContent = 'before selected text after';
    doc.body.append(paragraph);
    const textNode = paragraph.firstChild;
    if (!textNode) throw new Error('fixture text node missing');
    const range = doc.createRange();
    range.setStart(textNode, 7);
    range.setEnd(textNode, 20);
    doc.getSelection()?.addRange(range);
    const listener = vi.fn();
    reader.subscribeToSelection(listener);

    view.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 0 } }));
    doc.dispatchEvent(new Event('selectionchange'));

    expect(reader.getSelection()).toEqual({
      text: 'selected text',
      textBefore: 'before',
      textAfter: 'after',
      locator: {
        version: 1,
        format: 'epub',
        chapterHref: 'one.xhtml',
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      },
    });
    expect(listener).toHaveBeenCalledOnce();
    paragraph.remove();
  });

  it('turns EPUB wheel input into throttled page navigation', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    view.dispatchEvent(
      new CustomEvent('load', { detail: { doc: document, index: 0 } }),
    );

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    document.dispatchEvent(wheel);
    document.dispatchEvent(
      new WheelEvent('wheel', { cancelable: true, deltaY: 120 }),
    );

    expect(wheel.defaultPrevented).toBe(true);
    expect(view.next).toHaveBeenCalledOnce();
    await reader.close();
  });

  it('supports horizontal touch swipes without hijacking interactive controls', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    document.getSelection()?.removeAllRanges();
    view.dispatchEvent(
      new CustomEvent('load', { detail: { doc: document, index: 0 } }),
    );

    document.dispatchEvent(touchPointerEvent('pointerdown', 260, 120));
    const swipeLeft = touchPointerEvent('pointerup', 120, 125);
    document.dispatchEvent(swipeLeft);

    expect(swipeLeft.defaultPrevented).toBe(true);
    expect(view.next).toHaveBeenCalledOnce();

    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(touchPointerEvent('pointerdown', 120, 120));
    input.dispatchEvent(touchPointerEvent('pointerup', 260, 120));
    expect(view.prev).not.toHaveBeenCalled();
    input.remove();
    await reader.close();
  });

  it('draws, restores, activates, navigates to, and removes highlights', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    const highlight = {
      id: 'annotation-1',
      color: 'green' as const,
      locator: {
        version: 1 as const,
        format: 'epub' as const,
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      },
    };

    await reader.createHighlight(highlight);
    expect(view.addAnnotation).toHaveBeenCalledWith({
      value: highlight.locator.cfi,
      color: '#4ade80',
    });

    const draw = vi.fn();
    view.dispatchEvent(
      new CustomEvent('draw-annotation', {
        detail: { draw, annotation: { color: '#4ade80' } },
      }),
    );
    expect(draw).toHaveBeenCalledWith(expect.any(Function), {
      color: '#4ade80',
    });

    const activation = vi.fn();
    reader.subscribeToHighlightActivation(activation);
    view.dispatchEvent(
      new CustomEvent('show-annotation', {
        detail: { value: highlight.locator.cfi },
      }),
    );
    expect(activation).toHaveBeenCalledWith(highlight.id);

    await reader.showHighlight(highlight.id);
    expect(view.showAnnotation).toHaveBeenCalledWith({
      value: highlight.locator.cfi,
      color: '#4ade80',
    });
    await reader.removeHighlight(highlight.id);
    expect(view.deleteAnnotation).toHaveBeenCalledWith({
      value: highlight.locator.cfi,
      color: '',
    });
  });

  it('reports a failed highlight restore without mutating persistence', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    view.addAnnotation = vi.fn(() => Promise.reject(new Error('invalid CFI')));

    await expect(
      reader.restoreHighlights([
        {
          id: 'stale',
          color: 'yellow',
          locator: {
            version: 1,
            format: 'epub',
            cfi: 'epubcfi(/invalid)',
          },
        },
      ]),
    ).resolves.toEqual([{ id: 'stale', status: 'unresolved' }]);
  });

  it('keeps restored highlights drawable and interactive', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    const highlight = {
      id: 'restored-highlight',
      color: 'blue' as const,
      locator: {
        version: 1 as const,
        format: 'epub' as const,
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      },
    };

    await expect(reader.restoreHighlights([highlight])).resolves.toEqual([
      { id: highlight.id, status: 'restored' },
    ]);
    const activation = vi.fn();
    reader.subscribeToHighlightActivation(activation);
    let renderedGroup: SVGGElement | undefined;
    const draw = vi.fn((method: (rects: DOMRect[]) => SVGGElement) => {
      renderedGroup = method([]);
    });
    view.dispatchEvent(
      new CustomEvent('draw-annotation', {
        detail: {
          draw,
          annotation: { color: '#60a5fa', value: highlight.locator.cfi },
        },
      }),
    );

    expect(draw).toHaveBeenCalledWith(expect.any(Function), {
      color: '#60a5fa',
    });
    renderedGroup?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(activation).toHaveBeenCalledWith(highlight.id);
  });

  it('restores 2000 highlights without losing locator identity', async () => {
    const { reader, view } = createReader();
    await reader.open(new ArrayBuffer(1));
    const highlights = Array.from({ length: 2_000 }, (_, index) => ({
      id: `highlight-${String(index)}`,
      color: 'yellow' as const,
      locator: {
        version: 1 as const,
        format: 'epub' as const,
        cfi: `epubcfi(/6/2!/4/2,/1:${String(index)},/1:${String(index + 1)})`,
      },
    }));

    const result = await reader.restoreHighlights(highlights);

    expect(result).toHaveLength(2_000);
    expect(result.every(({ status }) => status === 'restored')).toBe(true);
    expect(view.addAnnotation).toHaveBeenCalledTimes(2_000);
    const activation = vi.fn();
    reader.subscribeToHighlightActivation(activation);
    view.dispatchEvent(
      new CustomEvent('show-annotation', {
        detail: { value: highlights.at(-1)?.locator.cfi },
      }),
    );
    expect(activation).toHaveBeenCalledWith('highlight-1999');
  });

  it('reopens with a fresh view and closes repeatedly without leaking resources', async () => {
    const firstView = createFakeView();
    const secondView = createFakeView();
    const viewFactory = vi
      .fn<() => FakeFoliateView>()
      .mockReturnValueOnce(firstView)
      .mockReturnValueOnce(secondView);
    const reader = new FoliateEbookReader(() => Promise.resolve(), viewFactory);
    const host = document.createElement('div');
    reader.mount(host);

    await reader.open(new ArrayBuffer(1));
    await reader.open(new ArrayBuffer(2));

    expect(firstView.book.destroy).toHaveBeenCalledOnce();
    expect(firstView.close).toHaveBeenCalledOnce();
    expect(host.firstElementChild).toBe(secondView);
    await reader.close();
    await reader.close();
    expect(secondView.book.destroy).toHaveBeenCalledOnce();
    expect(secondView.close).toHaveBeenCalledOnce();
    expect(host).toBeEmptyDOMElement();
  });
});

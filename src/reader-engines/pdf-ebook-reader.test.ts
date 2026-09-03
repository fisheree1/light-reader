import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextContent } from 'pdfjs-dist/types/src/display/api.js';

import { AppError } from '../lib/app-error';
import { normalizedPageText, PdfEbookReader } from './pdf-ebook-reader';

function createTextContent(text: string): TextContent {
  return {
    items: [
      {
        str: text,
        dir: 'ltr',
        transform: [1, 0, 0, 1, 0, 0],
        width: text.length * 8,
        height: 16,
        fontName: 'sans',
        hasEOL: false,
      },
    ],
    styles: {},
    lang: 'zh-CN',
  };
}

function createPdfRuntime(
  pageCount = 3,
  pageText: (pageIndex: number) => string = (pageIndex) =>
    `第 ${String(pageIndex + 1)} 页包含关键词和可选择文本`,
) {
  const cleanup = vi.fn(() => true);
  const cancelRender = vi.fn();
  const cancelTextLayer = vi.fn();
  const destroyLoadingTask = vi.fn(() => Promise.resolve());
  const getPage = vi.fn((pageNumber: number) => {
    const textContent = createTextContent(pageText(pageNumber - 1));
    return Promise.resolve({
      cleanup,
      getViewport: ({ scale }: { scale: number }) => ({
        height: 800 * scale,
        scale,
        width: 600 * scale,
      }),
      render: () => ({ cancel: cancelRender, promise: Promise.resolve() }),
      streamTextContent: () =>
        new ReadableStream<TextContent>({
          start(controller) {
            controller.enqueue(textContent);
            controller.close();
          },
        }),
    });
  });
  const document = {
    cleanup: vi.fn(() => Promise.resolve()),
    getPage,
    numPages: pageCount,
  };
  const loadingTask = {
    destroy: destroyLoadingTask,
    promise: Promise.resolve(document),
  };
  class FakeTextLayer {
    private readonly container: HTMLElement;
    private readonly content: TextContent;

    constructor({
      container,
      textContentSource,
    }: {
      container: HTMLElement;
      textContentSource: TextContent;
    }) {
      this.container = container;
      this.content = textContentSource;
    }

    cancel = cancelTextLayer;

    render() {
      for (const item of this.content.items) {
        if (!('str' in item)) continue;
        const span = this.container.ownerDocument.createElement('span');
        span.textContent = item.str;
        this.container.append(span);
      }
      return Promise.resolve();
    }
  }
  const runtime = {
    GlobalWorkerOptions: { workerPort: null, workerSrc: '' },
    TextLayer: FakeTextLayer,
    getDocument: vi.fn(() => loadingTask),
  };

  return {
    cancelRender,
    cancelTextLayer,
    cleanup,
    destroyLoadingTask,
    document,
    getPage,
    loadingTask,
    runtime,
  };
}

function createReader(runtime = createPdfRuntime()) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 900 });
  document.body.append(host);
  const reader = new PdfEbookReader(
    () => Promise.resolve(runtime.runtime) as never,
  );
  reader.mount(host);
  return { host, reader, runtime };
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 30,
      height: 20,
      left: 10,
      right: 90,
      top: 10,
      width: 80,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [
      {
        bottom: 30,
        height: 20,
        left: 10,
        right: 90,
        top: 10,
        width: 80,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      },
    ],
  });
});

describe('PdfEbookReader', () => {
  it('normalizes PDF text items and explicit line endings', () => {
    const content = createTextContent('first');
    content.items.push(
      { type: 'beginMarkedContent', id: 'tag' },
      {
        str: 'second',
        dir: 'ltr',
        transform: [1, 0, 0, 1, 0, 0],
        width: 48,
        height: 16,
        fontName: 'sans',
        hasEOL: true,
      },
    );
    expect(normalizedPageText(content)).toBe('firstsecond\n');
  });

  it('requires a mount, non-empty source, and at least one page', async () => {
    const reader = new PdfEbookReader();
    await expect(reader.open(new ArrayBuffer(1))).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    });
    const host = document.createElement('div');
    reader.mount(host);
    await expect(reader.open(new ArrayBuffer(0))).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    });

    const empty = createReader(createPdfRuntime(0)).reader;
    await expect(empty.open(new ArrayBuffer(1))).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    });
  });

  it('opens a 2000-page PDF with bounded page parsing and canvas rendering', async () => {
    const runtime = createPdfRuntime(2_000);
    const { host, reader } = createReader(runtime);
    const startedAt = performance.now();

    await reader.open(new Uint8Array([37, 80, 68, 70]).buffer);

    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(host.querySelectorAll('.pdf-page')).toHaveLength(2_000);
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(3);
    expect(runtime.getPage.mock.calls.length).toBeLessThanOrEqual(4);
    await reader.close();
  });

  it('uses the bundled worker URL and tolerant parsing for WebView compatibility', async () => {
    const runtime = createPdfRuntime(1);
    const { reader } = createReader(runtime);

    await expect(
      reader.open(new Uint8Array([37, 80, 68, 70]).buffer),
    ).resolves.toBeUndefined();

    expect(runtime.runtime.GlobalWorkerOptions.workerSrc).toContain(
      'pdf.worker.min',
    );
    expect(runtime.runtime.getDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stopAtErrors: false,
      }),
    );
    await reader.close();
  });

  it('uses page locators for navigation and searches the complete document', async () => {
    const { reader } = createReader(
      createPdfRuntime(3, (pageIndex) =>
        pageIndex === 1 ? '前文 LightReader 后文 LightReader 结尾' : '普通页面',
      ),
    );
    const relocations = vi.fn();
    reader.subscribeToRelocation(relocations);
    await reader.open(new Uint8Array([1]).buffer);

    await reader.goTo({ version: 1, format: 'pdf', pageIndex: 1 });
    const results = await reader.search('LightReader');

    expect(await reader.getCurrentLocator()).toMatchObject({
      version: 1,
      format: 'pdf',
      pageIndex: 1,
      progression: 0.5,
    });
    expect(relocations).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pdf', pageIndex: 1 }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.locator).toMatchObject({
      format: 'pdf',
      pageIndex: 1,
      textRange: { start: 3, end: 14 },
    });
    await reader.nextPage();
    await reader.nextPage();
    expect(await reader.getCurrentLocator()).toMatchObject({ pageIndex: 2 });
    await reader.previousPage();
    expect(await reader.getCurrentLocator()).toMatchObject({ pageIndex: 1 });
    await expect(
      reader.goTo({ version: 1, format: 'pdf', pageIndex: 99 }),
    ).rejects.toMatchObject({ code: 'READER_NAVIGATION_FAILED' });
    await expect(reader.search('   ')).resolves.toEqual([]);
    await reader.close();
  });

  it('applies PDF width and theme settings and keeps the TOC empty', async () => {
    const { host, reader, runtime } = createReader();
    reader.applyDisplaySettings({
      contentWidth: 840,
      fontFamily: 'publisher',
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 1.6,
      margin: 40,
      theme: 'sepia',
    });
    await reader.open(new ArrayBuffer(1));
    reader.applyDisplaySettings({
      contentWidth: 840,
      fontFamily: 'publisher',
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 1.6,
      margin: 40,
      theme: 'dark',
    });

    expect(reader.getTableOfContents()).toEqual([]);
    expect(
      host.querySelector<HTMLElement>('.pdf-reader')?.style.background,
    ).toBe('rgb(23, 23, 23)');
    expect(host.querySelector<HTMLElement>('.pdf-page')?.style.maxWidth).toBe(
      '840px',
    );
    await vi.waitFor(() => {
      expect(runtime.getPage.mock.calls.length).toBeGreaterThan(3);
    });
    await reader.close();
  });

  it('maps text-layer selection to stable offsets and renders an interactive highlight', async () => {
    const { host, reader } = createReader(
      createPdfRuntime(1, () => 'before selected text after'),
    );
    await reader.open(new Uint8Array([1]).buffer);
    const textNode = host.querySelector('.textLayer span')?.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    const range = document.createRange();
    range.setStart(textNode as Text, 7);
    range.setEnd(textNode as Text, 20);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(reader.getSelection()).toMatchObject({
      text: 'selected text',
      locator: {
        format: 'pdf',
        pageIndex: 0,
        textRange: { start: 7, end: 20 },
      },
    });
    const activation = vi.fn();
    reader.subscribeToHighlightActivation(activation);
    await reader.createHighlight({
      id: 'highlight-1',
      color: 'yellow',
      locator: {
        version: 1,
        format: 'pdf',
        pageIndex: 0,
        textRange: { start: 7, end: 20 },
      },
    });
    const highlight = host.querySelector<HTMLButtonElement>(
      '.pdf-highlight-interactive',
    );
    expect(highlight).toHaveAccessibleName('打开高亮批注');
    highlight?.click();
    expect(activation).toHaveBeenCalledWith('highlight-1');
    await reader.removeHighlight('highlight-1');
    expect(
      host.querySelector('.pdf-highlight-interactive'),
    ).not.toBeInTheDocument();
    await reader.removeHighlight('missing-highlight');
    await reader.close();
  });

  it('restores, navigates, and rejects unresolved PDF highlights', async () => {
    const { reader } = createReader(createPdfRuntime(4));
    await reader.open(new ArrayBuffer(1));
    const valid = {
      id: 'valid',
      color: 'blue' as const,
      locator: {
        version: 1 as const,
        format: 'pdf' as const,
        pageIndex: 3,
        textRange: { start: 0, end: 2 },
      },
    };
    await expect(
      reader.restoreHighlights([
        valid,
        {
          ...valid,
          id: 'outside',
          locator: { ...valid.locator, pageIndex: 10 },
        },
        {
          id: 'epub',
          color: 'green',
          locator: { version: 1, format: 'epub', cfi: 'epubcfi(/6/2)' },
        },
      ]),
    ).resolves.toEqual([
      { id: 'valid', status: 'restored' },
      { id: 'outside', status: 'unresolved' },
      { id: 'epub', status: 'unresolved' },
    ]);
    await reader.showHighlight('valid');
    expect(await reader.getCurrentLocator()).toMatchObject({ pageIndex: 3 });
    await expect(reader.showHighlight('missing')).rejects.toMatchObject({
      code: 'ANNOTATION_NOT_FOUND',
    });
    await expect(
      reader.createHighlight({
        id: 'no-range',
        color: 'red',
        locator: { version: 1, format: 'pdf', pageIndex: 0 },
      }),
    ).rejects.toBeTruthy();
    await reader.close();
  });

  it('updates the page locator from virtualized scrolling', async () => {
    const { host, reader } = createReader(createPdfRuntime(6));
    await reader.open(new ArrayBuffer(1));
    const scroller = host.querySelector<HTMLElement>('.pdf-reader');
    const pages = host.querySelectorAll<HTMLElement>('.pdf-page');
    for (const [index, page] of [...pages].entries()) {
      Object.defineProperty(page, 'offsetTop', { value: index * 900 });
      Object.defineProperty(page, 'offsetHeight', { value: 800 });
    }
    if (!scroller) throw new Error('missing PDF scroller');
    scroller.scrollTop = 4 * 900 + 200;
    scroller.dispatchEvent(new Event('scroll'));

    await vi.waitFor(async () => {
      expect(await reader.getCurrentLocator()).toMatchObject({
        pageIndex: 4,
        withinPageProgression: 0.25,
      });
    });
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(5);
    await reader.close();
  });

  it('normalizes text extraction and canvas failures', async () => {
    const searchFailureRuntime = createPdfRuntime(3);
    const { reader } = createReader(searchFailureRuntime);
    await reader.open(new ArrayBuffer(1));
    searchFailureRuntime.getPage.mockImplementation((pageNumber: number) => {
      if (pageNumber === 3) return Promise.reject(new Error('text failed'));
      return Promise.resolve({
        cleanup: vi.fn(() => true),
        getViewport: ({ scale }: { scale: number }) => ({
          height: 800 * scale,
          scale,
          width: 600 * scale,
        }),
        render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
        streamTextContent: () =>
          new ReadableStream<TextContent>({
            start(controller) {
              controller.enqueue(createTextContent('plain'));
              controller.close();
            },
          }),
      });
    });
    await expect(reader.search('missing')).rejects.toMatchObject({
      code: 'READER_NAVIGATION_FAILED',
    });
    await reader.close();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(
      null,
    );
    const brokenCanvas = createReader().reader;
    await expect(brokenCanvas.open(new ArrayBuffer(1))).rejects.toMatchObject({
      code: 'READER_OPEN_FAILED',
    });
  });

  it('cancels page resources and destroys the worker-owning loading task on close', async () => {
    const { host, reader, runtime } = createReader();
    await reader.open(new Uint8Array([1]).buffer);

    await reader.close();

    expect(runtime.cancelTextLayer).toHaveBeenCalled();
    expect(runtime.cleanup).toHaveBeenCalled();
    expect(runtime.document.cleanup).toHaveBeenCalled();
    expect(runtime.destroyLoadingTask).toHaveBeenCalled();
    expect(host).toBeEmptyDOMElement();
  });

  it('normalizes corrupt loading failures and rejects non-PDF locators', async () => {
    const runtime = createPdfRuntime();
    runtime.loadingTask.promise = Promise.reject(new Error('corrupt xref'));
    const { reader } = createReader(runtime);

    await expect(reader.open(new Uint8Array([1]).buffer)).rejects.toMatchObject(
      {
        code: 'READER_OPEN_FAILED',
      } satisfies Partial<AppError>,
    );

    const healthy = createReader().reader;
    await healthy.open(new Uint8Array([1]).buffer);
    await expect(
      healthy.goTo({ version: 1, format: 'epub', progression: 0.5 }),
    ).rejects.toBeTruthy();
    await healthy.close();
  });
});

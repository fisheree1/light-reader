import { describe, expect, it, vi } from 'vitest';

import {
  PdfBookTextParser,
  normalizePdfTextContent,
} from './pdf-book-text-parser';

describe('PdfBookTextParser', () => {
  it('normalizes text-layer items without losing line boundaries', () => {
    expect(
      normalizePdfTextContent({
        items: [
          { str: '第一行 ', hasEOL: true },
          { str: ' 第二行', hasEOL: false },
        ],
        styles: {},
        lang: null,
      } as never),
    ).toBe('第一行\n第二行');
  });

  it('extracts page text and tears down the PDF.js task', async () => {
    const pageCleanup = vi.fn();
    const documentCleanup = vi.fn(() => Promise.resolve());
    const destroy = vi.fn(() => Promise.resolve());
    const document = {
      numPages: 2,
      getPage: vi.fn((pageNumber: number) =>
        Promise.resolve({
          cleanup: pageCleanup,
          getTextContent: () =>
            Promise.resolve({
              items: [
                {
                  str: pageNumber === 1 ? '第一页文字' : '第二页文字',
                  hasEOL: false,
                },
              ],
              styles: {},
              lang: null,
            }),
        }),
      ),
      cleanup: documentCleanup,
    };
    const parser = new PdfBookTextParser(() =>
      Promise.resolve({
        GlobalWorkerOptions: { workerSrc: '' },
        getDocument: () => ({ promise: Promise.resolve(document), destroy }),
      } as never),
    );

    await expect(
      parser.parse(new Uint8Array([1, 2, 3]).buffer),
    ).resolves.toEqual([
      { pageIndex: 0, text: '第一页文字' },
      { pageIndex: 1, text: '第二页文字' },
    ]);
    expect(pageCleanup).toHaveBeenCalledTimes(2);
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('reports a text-unavailable state for scanned PDFs', async () => {
    const parser = new PdfBookTextParser(() =>
      Promise.resolve({
        GlobalWorkerOptions: { workerSrc: '' },
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () =>
              Promise.resolve({
                cleanup: () => undefined,
                getTextContent: () =>
                  Promise.resolve({ items: [], styles: {}, lang: null }),
              }),
            cleanup: () => Promise.resolve(),
          }),
          destroy: () => Promise.resolve(),
        }),
      } as never),
    );

    await expect(
      parser.parse(new Uint8Array([1]).buffer),
    ).rejects.toMatchObject({ code: 'TEXT_UNAVAILABLE' });
  });

  it('在页面之间取消解析，仍清理文档和 worker 任务', async () => {
    const controller = new AbortController();
    const progress = vi.fn((completedPages: number) => {
      if (completedPages === 1) controller.abort();
    });
    const pageCleanup = vi.fn();
    const documentCleanup = vi.fn(() => Promise.resolve());
    const destroy = vi.fn(() => Promise.resolve());
    const getPage = vi.fn(() =>
      Promise.resolve({
        cleanup: pageCleanup,
        getTextContent: () =>
          Promise.resolve({
            items: [{ str: '正文', hasEOL: false }],
            styles: {},
            lang: null,
          }),
      }),
    );
    const parser = new PdfBookTextParser(() =>
      Promise.resolve({
        GlobalWorkerOptions: { workerSrc: '' },
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage,
            cleanup: documentCleanup,
          }),
          destroy,
        }),
      } as never),
    );

    await expect(
      parser.parse(new Uint8Array([1]).buffer, {
        signal: controller.signal,
        onProgress: progress,
      }),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });

    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(getPage).toHaveBeenCalledOnce();
    expect(pageCleanup).toHaveBeenCalledOnce();
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

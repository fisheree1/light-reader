import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api.js';

import { AppError } from '../lib/app-error';

type PdfJsRuntime = Pick<
  typeof import('pdfjs-dist'),
  'GlobalWorkerOptions' | 'getDocument'
>;
type PdfJsRuntimeLoader = () => Promise<PdfJsRuntime>;

export interface PdfTextPage {
  pageIndex: number;
  text: string;
}

const maxPages = 50_000;
const maxTotalTextChars = 20_000_000;

async function loadPdfJsRuntime(): Promise<PdfJsRuntime> {
  return import('pdfjs-dist');
}

export function normalizePdfTextContent(content: TextContent): string {
  return content.items
    .flatMap((item) =>
      'str' in item ? [item.str, ...(item.hasEOL ? ['\n'] : [])] : [],
    )
    .join('')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

async function readPage(page: PDFPageProxy): Promise<string> {
  try {
    return normalizePdfTextContent(await page.getTextContent());
  } finally {
    page.cleanup();
  }
}

export class PdfBookTextParser {
  private readonly loadRuntime: PdfJsRuntimeLoader;

  constructor(loadRuntime: PdfJsRuntimeLoader = loadPdfJsRuntime) {
    this.loadRuntime = loadRuntime;
  }

  async parse(source: ArrayBuffer): Promise<PdfTextPage[]> {
    if (source.byteLength === 0) throw new AppError('INVALID_PDF');
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let document: PDFDocumentProxy | null = null;
    try {
      const runtime = await this.loadRuntime();
      runtime.GlobalWorkerOptions.workerSrc = new URL(
        pdfWorkerUrl,
        window.location.href,
      ).href;
      loadingTask = runtime.getDocument({
        data: Uint8Array.from(new Uint8Array(source)),
        stopAtErrors: false,
      });
      document = await loadingTask.promise;
      if (document.numPages < 1 || document.numPages > maxPages) {
        throw new AppError('TEXT_UNAVAILABLE');
      }
      const pages: PdfTextPage[] = [];
      let totalChars = 0;
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
        const page = await document.getPage(pageIndex + 1);
        const text = await readPage(page);
        if (!text) continue;
        totalChars += text.length;
        if (totalChars > maxTotalTextChars) {
          throw new AppError('SEARCH_INDEX_FAILED', {
            message: 'PDF 正文过大，无法建立本地 AI 索引。',
          });
        }
        pages.push({ pageIndex, text });
      }
      if (pages.length === 0) throw new AppError('TEXT_UNAVAILABLE');
      return pages;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('SEARCH_INDEX_FAILED', { cause: error });
    } finally {
      await document?.cleanup().catch(() => undefined);
      await loadingTask?.destroy().catch(() => undefined);
    }
  }
}

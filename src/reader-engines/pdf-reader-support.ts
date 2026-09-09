import type { PDFPageProxy, TextLayer } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api.js';

import type { ReaderHighlight, ReaderTextSelection } from './types';

export type PdfJsRuntime = Pick<
  typeof import('pdfjs-dist'),
  'GlobalWorkerOptions' | 'TextLayer' | 'getDocument'
>;
export type PdfJsRuntimeLoader = () => Promise<PdfJsRuntime>;

export interface RenderedPage {
  page: PDFPageProxy;
  renderTask: ReturnType<PDFPageProxy['render']> | null;
  textLayer: TextLayer | null;
}

export const pdfRenderLimits = {
  activePages: 5,
  canvasDimension: 8_192,
  canvasPixels: 16_777_216,
  searchResults: 500,
  textCachePages: 32,
} as const;

export const pdfHighlightColors = {
  yellow: '#facc15',
  blue: '#60a5fa',
  green: '#4ade80',
  red: '#f87171',
} as const;

export async function loadPdfJsRuntime(): Promise<PdfJsRuntime> {
  return import('pdfjs-dist');
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizedPageText(content: TextContent): string {
  return content.items
    .flatMap((item) =>
      'str' in item ? [item.str, ...(item.hasEOL ? ['\n'] : [])] : [],
    )
    .join('');
}

export async function readPageTextContent(
  page: PDFPageProxy,
): Promise<TextContent> {
  const stream = page.streamTextContent() as ReadableStream<TextContent>;
  const reader = stream.getReader();
  const content: TextContent = {
    items: [],
    styles: Object.create(null) as TextContent['styles'],
    lang: null,
  };
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      content.lang ??= chunk.value.lang;
      Object.assign(content.styles, chunk.value.styles);
      content.items.push(...chunk.value.items);
      chunk = await reader.read();
    }
    return content;
  } finally {
    reader.releaseLock();
  }
}

export function findTextOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  if (!root.contains(node)) return null;
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

export function createTextRange(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let candidate = walker.nextNode();
  while (candidate) {
    const textNode = candidate as Text;
    const next = cursor + textNode.data.length;
    if (!startNode && start <= next) {
      startNode = textNode;
      startOffset = clamp(start - cursor, 0, textNode.data.length);
    }
    if (end <= next) {
      endNode = textNode;
      endOffset = clamp(end - cursor, 0, textNode.data.length);
      break;
    }
    cursor = next;
    candidate = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export function selectionContext(text: string, start: number, end: number) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  return {
    textBefore: normalize(text.slice(Math.max(0, start - 160), start)) || null,
    textAfter: normalize(text.slice(end, end + 160)) || null,
  };
}

export async function createPdfPageShells(
  host: HTMLElement,
  document: Pick<import('pdfjs-dist').PDFDocumentProxy, 'getPage' | 'numPages'>,
  contentWidth: number,
) {
  const firstPage = await document.getPage(1);
  const firstViewport = firstPage.getViewport({ scale: 1 });
  firstPage.cleanup();
  const aspectRatio = firstViewport.width / firstViewport.height;
  const scroller = host.ownerDocument.createElement('div');
  scroller.className = 'pdf-reader';
  scroller.setAttribute('aria-label', 'PDF 文档');
  scroller.tabIndex = 0;
  const pageShells = Array.from(
    { length: document.numPages },
    (_, pageIndex) => {
      const shell = host.ownerDocument.createElement('section');
      shell.className = 'pdf-page';
      shell.dataset.pdfPageIndex = String(pageIndex);
      shell.setAttribute('aria-label', `第 ${String(pageIndex + 1)} 页`);
      shell.style.aspectRatio = String(aspectRatio);
      shell.style.maxWidth = `${String(contentWidth)}px`;
      scroller.append(shell);
      return shell;
    },
  );
  host.replaceChildren(scroller);
  return { pageShells, scroller };
}

export function readPdfSelection(
  host: HTMLElement,
  textCache: ReadonlyMap<number, string>,
  pageCount: number,
): ReaderTextSelection | null {
  const selection = host.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const shell =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer.closest<HTMLElement>('.pdf-page')
      : range.commonAncestorContainer.parentElement?.closest<HTMLElement>(
          '.pdf-page',
        );
  const textLayer = shell?.querySelector<HTMLElement>('.textLayer');
  const pageIndex = Number(shell?.dataset.pdfPageIndex);
  if (!shell || !textLayer || !Number.isInteger(pageIndex)) return null;
  const start = findTextOffset(
    textLayer,
    range.startContainer,
    range.startOffset,
  );
  const end = findTextOffset(textLayer, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  const pageText = textCache.get(pageIndex) ?? textLayer.textContent;
  const text = pageText.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const shellRect = shell.getBoundingClientRect();
  const selectionRect = range.getBoundingClientRect();
  const withinPageProgression = clamp(
    (selectionRect.top - shellRect.top) / Math.max(1, shellRect.height),
    0,
    1,
  );
  return {
    text,
    ...selectionContext(pageText, start, end),
    locator: {
      version: 1,
      format: 'pdf',
      pageIndex,
      withinPageProgression,
      textRange: { start, end },
      progression: pageCount === 1 ? 1 : pageIndex / (pageCount - 1),
    },
  };
}

export function drawPdfPageOverlays({
  highlights,
  onActivate,
  pageIndex,
  searchRanges,
  shell,
}: {
  highlights: Iterable<ReaderHighlight>;
  onActivate: (highlightId: string) => void;
  pageIndex: number;
  searchRanges: { start: number; end: number }[];
  shell: HTMLElement;
}): void {
  const textLayer = shell.querySelector<HTMLElement>('.textLayer');
  const overlay = shell.querySelector<HTMLElement>('.pdf-page-overlay');
  if (!textLayer || !overlay) return;
  overlay.replaceChildren();
  for (const range of searchRanges) {
    drawTextRange(
      shell,
      textLayer,
      overlay,
      range,
      '#fde047',
      null,
      onActivate,
    );
  }
  for (const highlight of highlights) {
    if (highlight.locator.format !== 'pdf') continue;
    if (highlight.locator.pageIndex !== pageIndex) continue;
    const range = highlight.locator.textRange;
    if (!range) continue;
    drawTextRange(
      shell,
      textLayer,
      overlay,
      range,
      pdfHighlightColors[highlight.color],
      highlight.id,
      onActivate,
    );
  }
}

function drawTextRange(
  shell: HTMLElement,
  textLayer: HTMLElement,
  overlay: HTMLElement,
  textRange: { start: number; end: number },
  color: string,
  highlightId: string | null,
  onActivate: (highlightId: string) => void,
): void {
  const range = createTextRange(textLayer, textRange.start, textRange.end);
  if (!range || typeof range.getClientRects !== 'function') return;
  const shellRect = shell.getBoundingClientRect();
  for (const rect of range.getClientRects()) {
    const element = shell.ownerDocument.createElement(
      highlightId ? 'button' : 'span',
    );
    element.className = highlightId
      ? 'pdf-highlight pdf-highlight-interactive'
      : 'pdf-search-highlight';
    element.style.left = `${String(rect.left - shellRect.left)}px`;
    element.style.top = `${String(rect.top - shellRect.top)}px`;
    element.style.width = `${String(rect.width)}px`;
    element.style.height = `${String(rect.height)}px`;
    element.style.background = color;
    if (highlightId) {
      element.setAttribute('aria-label', '打开高亮批注');
      element.addEventListener('click', () => {
        onActivate(highlightId);
      });
    }
    overlay.append(element);
  }
}

import { strFromU8, unzipSync } from 'fflate';

import type { BookContentChapter } from '../domain/search';
import {
  readEpubPackage,
  resolveArchiveHref,
} from '../../library/services/epub-metadata-parser';
import { AppError, isAppError } from '../../../lib/app-error';

export interface EpubContentParser {
  parse(data: Uint8Array): Promise<BookContentChapter[]>;
}

interface SpineEntry {
  archivePath: string;
  chapterHref: string;
}

const maxTotalTextLength = 20_000_000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractBodyText(document: Document): string {
  const body = document.body;
  const walker = document.createTreeWalker(body, 4);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue) parts.push(node.nodeValue);
    node = walker.nextNode();
  }
  return normalizeText(parts.join(' '));
}

function fallbackChapterTitle(href: string, index: number): string {
  const fileName = href.split('/').at(-1)?.split(/[?#]/, 1)[0] ?? '';
  let decoded = fileName;
  try {
    decoded = decodeURIComponent(fileName);
  } catch {
    // Keep the safe archive href when an EPUB contains invalid escaping.
  }
  const withoutExtension = decoded.replace(/\.[^.]+$/, '').trim();
  return withoutExtension || `第 ${String(index + 1)} 章`;
}

function extractChapter(
  data: Uint8Array,
  entry: SpineEntry,
  index: number,
): BookContentChapter | null {
  const document = new DOMParser().parseFromString(
    strFromU8(data),
    'text/html',
  );
  document.querySelectorAll('script, style, noscript, svg').forEach((node) => {
    node.remove();
  });
  const text = extractBodyText(document);
  if (!text) return null;
  const title = normalizeText(
    document.querySelector('h1, h2, title')?.textContent ?? '',
  );
  return {
    chapterHref: entry.chapterHref,
    chapterTitle: title || fallbackChapterTitle(entry.chapterHref, index),
    text,
  };
}

export class FflateEpubContentParser implements EpubContentParser {
  parse(data: Uint8Array): Promise<BookContentChapter[]> {
    try {
      const { opf, opfPath } = readEpubPackage(data);
      const manifest = new Map(
        Array.from(opf.getElementsByTagNameNS('*', 'item')).flatMap((item) => {
          const id = item.getAttribute('id');
          const href = item.getAttribute('href');
          const mediaType = item.getAttribute('media-type') ?? '';
          if (!id || !href || !/html|xhtml/i.test(mediaType)) return [];
          return [[id, href] as const];
        }),
      );
      const seen = new Set<string>();
      const spineEntries = Array.from(
        opf.getElementsByTagNameNS('*', 'itemref'),
      ).flatMap((itemref): SpineEntry[] => {
        const href = manifest.get(itemref.getAttribute('idref') ?? '');
        if (!href) return [];
        const archivePath = resolveArchiveHref(opfPath, href);
        if (!archivePath || seen.has(archivePath)) return [];
        seen.add(archivePath);
        return [{ archivePath, chapterHref: archivePath }];
      });

      const requestedPaths = new Set(
        spineEntries.map((entry) => entry.archivePath),
      );
      const entries: Partial<Record<string, Uint8Array>> = unzipSync(data, {
        filter: ({ name }) => requestedPaths.has(name),
      });

      const chapters: BookContentChapter[] = [];
      let totalTextLength = 0;
      spineEntries.forEach((entry, index) => {
        const chapterData = entries[entry.archivePath];
        if (!chapterData) return;
        const chapter = extractChapter(chapterData, entry, index);
        if (!chapter) return;
        totalTextLength += chapter.text.length;
        if (totalTextLength > maxTotalTextLength) {
          throw new AppError('SEARCH_INDEX_FAILED', {
            message: 'EPUB 正文过大，无法建立本地搜索索引。',
          });
        }
        chapters.push(chapter);
      });
      return Promise.resolve(chapters);
    } catch (error) {
      if (isAppError(error)) return Promise.reject(error);
      return Promise.reject(
        new AppError('SEARCH_INDEX_FAILED', { cause: error }),
      );
    }
  }
}

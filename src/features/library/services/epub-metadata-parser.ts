import { strFromU8, unzipSync } from 'fflate';

import type { EpubMetadata } from '../domain/book';
import { AppError, isAppError } from '../../../lib/app-error';
import { fallbackTitleFromFileName } from '../../../storage/book-paths';
import type { ExtractedCover } from '../../../storage/book-file-storage';
import {
  assertEpubFileSize,
  createLimitedEpubZipFilter,
  MAX_EPUB_CONTAINER_SIZE,
  MAX_EPUB_COVER_SIZE,
  MAX_EPUB_PACKAGE_SIZE,
} from './epub-limits';

export interface ParsedEpub {
  cover: ExtractedCover | null;
  metadata: EpubMetadata;
}

export interface EpubMetadataParser {
  parse(data: Uint8Array, sourceFileName: string): Promise<ParsedEpub>;
}

export function parseXml(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new AppError('INVALID_EPUB', {
      cause: new Error(`Invalid ${label} XML.`),
    });
  }
  return document;
}

function firstText(document: Document, localName: string): string | null {
  const elements = document.getElementsByTagNameNS('*', localName);
  const element = elements.item(0);
  if (!element) return null;
  const text = element.textContent.trim();
  return text.length > 0 ? text : null;
}

function allText(document: Document, localName: string): string[] {
  return Array.from(document.getElementsByTagNameNS('*', localName))
    .map((element) => element.textContent.trim())
    .filter(Boolean);
}

export function normalizeArchivePath(path: string): string | null {
  if (/^[a-z]+:/i.test(path) || path.startsWith('/') || path.includes('\\')) {
    return null;
  }

  const normalized: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!normalized.length) return null;
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return normalized.join('/');
}

export function resolveArchiveHref(
  opfPath: string,
  href: string,
): string | null {
  const withoutFragment = href.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return null;
  }
  const directory = opfPath.includes('/')
    ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
    : '';
  return normalizeArchivePath(`${directory}${decoded}`);
}

export interface EpubPackage {
  opf: Document;
  opfPath: string;
}

export function readEpubPackage(data: Uint8Array): EpubPackage {
  assertEpubFileSize(data.byteLength);
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new AppError('INVALID_EPUB');
  }

  const bootstrapEntries: Partial<Record<string, Uint8Array>> = unzipSync(
    data,
    {
      filter: createLimitedEpubZipFilter({
        include: (name) =>
          name === 'mimetype' || name === 'META-INF/container.xml',
        maxEntrySize: (name) =>
          name === 'mimetype' ? 256 : MAX_EPUB_CONTAINER_SIZE,
        maxSelectedBytes: MAX_EPUB_CONTAINER_SIZE + 256,
      }),
    },
  );
  const mimetype = bootstrapEntries.mimetype;
  const container = bootstrapEntries['META-INF/container.xml'];
  if (
    !mimetype ||
    strFromU8(mimetype).trim() !== 'application/epub+zip' ||
    !container
  ) {
    throw new AppError('INVALID_EPUB');
  }

  const containerDocument = parseXml(strFromU8(container), 'container');
  const rootfile = containerDocument
    .getElementsByTagNameNS('*', 'rootfile')
    .item(0);
  const opfPathValue = rootfile?.getAttribute('full-path');
  const opfPath = opfPathValue ? normalizeArchivePath(opfPathValue) : null;
  if (!opfPath) throw new AppError('INVALID_EPUB');

  const opfEntries: Partial<Record<string, Uint8Array>> = unzipSync(data, {
    filter: createLimitedEpubZipFilter({
      include: (name) => name === opfPath,
      maxEntrySize: () => MAX_EPUB_PACKAGE_SIZE,
      maxSelectedBytes: MAX_EPUB_PACKAGE_SIZE,
    }),
  });
  const opfData = opfEntries[opfPath];
  if (!opfData) throw new AppError('INVALID_EPUB');

  const opf = parseXml(strFromU8(opfData), 'package');
  if (!opf.getElementsByTagNameNS('*', 'package').length) {
    throw new AppError('INVALID_EPUB');
  }
  return { opf, opfPath };
}

function coverExtension(mediaType: string): ExtractedCover['extension'] | null {
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return null;
  }
}

function findCoverItem(opf: Document): Element | null {
  const items = Array.from(opf.getElementsByTagNameNS('*', 'item'));
  const epub3Cover = items.find((item) =>
    (item.getAttribute('properties') ?? '')
      .split(/\s+/)
      .includes('cover-image'),
  );
  if (epub3Cover) return epub3Cover;

  const coverMeta = Array.from(opf.getElementsByTagNameNS('*', 'meta')).find(
    (meta) => meta.getAttribute('name')?.toLowerCase() === 'cover',
  );
  const coverId = coverMeta?.getAttribute('content');
  return coverId
    ? (items.find((item) => item.getAttribute('id') === coverId) ?? null)
    : null;
}

function extractCover(
  archive: Uint8Array,
  opf: Document,
  opfPath: string,
): ExtractedCover | null {
  const item = findCoverItem(opf);
  const href = item?.getAttribute('href');
  const mediaType = item?.getAttribute('media-type');
  if (!href || !mediaType) return null;

  const extension = coverExtension(mediaType);
  const coverPath = resolveArchiveHref(opfPath, href);
  if (!extension || !coverPath) return null;

  try {
    const coverEntries: Partial<Record<string, Uint8Array>> = unzipSync(
      archive,
      {
        filter: createLimitedEpubZipFilter({
          include: (name) => name === coverPath,
          maxEntrySize: () => MAX_EPUB_COVER_SIZE,
          maxSelectedBytes: MAX_EPUB_COVER_SIZE,
        }),
      },
    );
    const data = coverEntries[coverPath];
    return data ? { data, extension, mediaType } : null;
  } catch {
    return null;
  }
}

export class FflateEpubMetadataParser implements EpubMetadataParser {
  parse(data: Uint8Array, sourceFileName: string): Promise<ParsedEpub> {
    try {
      const { opf, opfPath } = readEpubPackage(data);

      const metadata: EpubMetadata = {
        title:
          firstText(opf, 'title') ?? fallbackTitleFromFileName(sourceFileName),
        creators: allText(opf, 'creator'),
        language: firstText(opf, 'language'),
        publisher: firstText(opf, 'publisher'),
        description: firstText(opf, 'description'),
        identifier: firstText(opf, 'identifier'),
      };

      return Promise.resolve({
        metadata,
        cover: extractCover(data, opf, opfPath),
      });
    } catch (error) {
      if (isAppError(error)) return Promise.reject(error);
      if (error instanceof Error && /invalid zip data/i.test(error.message)) {
        return Promise.reject(new AppError('INVALID_EPUB', { cause: error }));
      }
      return Promise.reject(
        new AppError('METADATA_PARSE_FAILED', { cause: error }),
      );
    }
  }
}

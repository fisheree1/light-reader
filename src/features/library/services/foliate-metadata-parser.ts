import { unzipSync } from 'fflate';

import { AppError } from '../../../lib/app-error';
import {
  openFoliateBook,
  type FoliateBook,
} from '../../../reader-engines/foliate-book-loader';
import type { ExtractedCover } from '../../../storage/book-file-storage';
import {
  fallbackTitleFromFileName,
  type CoverExtension,
} from '../../../storage/book-paths';
import {
  bookMetadataSchema,
  type BookFormat,
  type FoliateBookFormat,
} from '../domain/book';
import type { ParsedEpub } from './epub-metadata-parser';
import { MAX_EPUB_COVER_SIZE } from './epub-limits';

type BookOpener = (
  source: Uint8Array,
  format: FoliateBookFormat,
) => Promise<FoliateBook>;

const comicImagePattern = /\.(avif|bmp|gif|jpe?g|jxl|png|svg|webp)$/i;

function readAscii(source: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...source.subarray(start, end));
}

function isZip(source: Uint8Array): boolean {
  return (
    source[0] === 0x50 &&
    source[1] === 0x4b &&
    source[2] === 0x03 &&
    source[3] === 0x04
  );
}

/**
 * Cheap structural checks before handing bytes to a parser. They reject files
 * whose extension does not match their content with a clear error.
 */
export function assertFoliateBookSignature(
  source: Uint8Array,
  format: FoliateBookFormat,
): void {
  let valid = false;
  if (format === 'mobi' || format === 'azw3') {
    valid = readAscii(source, 60, 68) === 'BOOKMOBI';
  } else if (format === 'fb2') {
    const head = new TextDecoder().decode(source.subarray(0, 4096));
    valid = head.includes('<FictionBook');
  } else if (format === 'cbz') {
    if (isZip(source)) {
      try {
        let images = 0;
        unzipSync(source, {
          filter: (file) => {
            if (comicImagePattern.test(file.name)) images += 1;
            return false;
          },
        });
        valid = images > 0;
      } catch {
        valid = false;
      }
    }
  } else {
    valid = isZip(source);
  }
  if (!valid) throw new AppError('INVALID_EBOOK');
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('name' in record) return text(record.name);
    return text(Object.values(record)[0]);
  }
  return null;
}

function creators(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => text(item) ?? []);
}

function sniffCover(data: Uint8Array): Omit<ExtractedCover, 'data'> | null {
  const signatures: [CoverExtension, string, number[]][] = [
    ['jpeg', 'image/jpeg', [0xff, 0xd8, 0xff]],
    ['png', 'image/png', [0x89, 0x50, 0x4e, 0x47]],
    ['gif', 'image/gif', [0x47, 0x49, 0x46, 0x38]],
  ];
  for (const [extension, mediaType, bytes] of signatures) {
    if (bytes.every((byte, index) => data[index] === byte)) {
      return { extension, mediaType };
    }
  }
  if (readAscii(data, 0, 4) === 'RIFF' && readAscii(data, 8, 12) === 'WEBP') {
    return { extension: 'webp', mediaType: 'image/webp' };
  }
  return null;
}

async function readCover(book: FoliateBook): Promise<ExtractedCover | null> {
  try {
    const blob = await book.getCover?.();
    if (!blob || blob.size === 0 || blob.size > MAX_EPUB_COVER_SIZE) {
      return null;
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    const type = sniffCover(data);
    return type ? { ...type, data } : null;
  } catch {
    // A broken cover must not block importing the book itself.
    return null;
  }
}

/** Reads title, authors, and cover of MOBI, AZW3, FB2, and CBZ books. */
export class FoliateBookMetadataParser {
  private readonly open: BookOpener;

  constructor(open: BookOpener = openFoliateBook) {
    this.open = open;
  }

  async parse(
    source: Uint8Array,
    fileName: string,
    format: FoliateBookFormat,
  ): Promise<ParsedEpub> {
    assertFoliateBookSignature(source, format);
    let book: FoliateBook;
    try {
      book = await this.open(source, format);
    } catch (error) {
      throw new AppError('INVALID_EBOOK', { cause: error });
    }
    try {
      const metadata = book.metadata ?? {};
      const fallbackTitle = fallbackTitleFromFileName(fileName);
      const title = text(metadata.title);
      return {
        metadata: bookMetadataSchema.parse({
          // Comic books report the synthetic file name as their title.
          title: title && title !== `book.${format}` ? title : fallbackTitle,
          creators: creators(metadata.author),
          language: text(metadata.language),
          publisher: text(metadata.publisher),
          description: text(metadata.description),
          identifier: text(metadata.identifier),
        }),
        cover: await readCover(book),
      };
    } finally {
      book.destroy?.();
    }
  }
}

export function isFoliateMetadataFormat(
  format: BookFormat,
): format is Exclude<FoliateBookFormat, 'epub'> {
  return format !== 'epub' && format !== 'pdf';
}

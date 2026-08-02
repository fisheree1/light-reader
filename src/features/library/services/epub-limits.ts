import { AppError } from '../../../lib/app-error';

export const MAX_EPUB_FILE_SIZE = 256 * 1024 * 1024;
export const MAX_EPUB_ARCHIVE_ENTRIES = 20_000;
export const MAX_EPUB_COMPRESSION_RATIO = 200;
export const MAX_EPUB_CONTAINER_SIZE = 1024 * 1024;
export const MAX_EPUB_PACKAGE_SIZE = 4 * 1024 * 1024;
export const MAX_EPUB_COVER_SIZE = 20 * 1024 * 1024;
export const MAX_EPUB_CHAPTER_SIZE = 8 * 1024 * 1024;
export const MAX_EPUB_SELECTED_CHAPTER_BYTES = 128 * 1024 * 1024;

const compressionRatioMinimumSize = 1024 * 1024;

interface ZipEntryInfo {
  name: string;
  originalSize: number;
  size: number;
}

interface LimitedZipFilterOptions {
  include: (name: string) => boolean;
  maxEntrySize: (name: string) => number;
  maxSelectedBytes: number;
}

export function assertEpubFileSize(
  size: number,
  maximum = MAX_EPUB_FILE_SIZE,
): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximum) {
    throw new AppError('EPUB_TOO_LARGE');
  }
}

function assertSafeZipEntry(entry: ZipEntryInfo, maximum: number): void {
  if (
    !Number.isSafeInteger(entry.size) ||
    !Number.isSafeInteger(entry.originalSize) ||
    entry.size < 0 ||
    entry.originalSize < 0 ||
    entry.originalSize > maximum
  ) {
    throw new AppError('EPUB_TOO_LARGE');
  }
  if (
    entry.originalSize >= compressionRatioMinimumSize &&
    entry.originalSize / Math.max(entry.size, 1) > MAX_EPUB_COMPRESSION_RATIO
  ) {
    throw new AppError('EPUB_TOO_LARGE');
  }
}

export function createLimitedEpubZipFilter({
  include,
  maxEntrySize,
  maxSelectedBytes,
}: LimitedZipFilterOptions): (entry: ZipEntryInfo) => boolean {
  let entryCount = 0;
  let selectedBytes = 0;
  return (entry) => {
    entryCount += 1;
    if (entryCount > MAX_EPUB_ARCHIVE_ENTRIES) {
      throw new AppError('EPUB_TOO_LARGE');
    }
    if (!include(entry.name)) return false;
    assertSafeZipEntry(entry, maxEntrySize(entry.name));
    selectedBytes += entry.originalSize;
    if (selectedBytes > maxSelectedBytes) {
      throw new AppError('EPUB_TOO_LARGE');
    }
    return true;
  };
}

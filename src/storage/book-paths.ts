export type CoverExtension = 'gif' | 'jpeg' | 'png' | 'webp';

export interface BookStoragePaths {
  finalBookPath: string;
  finalCoverPath: string | null;
  finalDirectory: string;
  stagingBookPath: string;
  stagingCoverPath: string | null;
  stagingDirectory: string;
}

const safeGeneratedId = /^[a-zA-Z0-9-]+$/;

export function createBookStoragePaths(
  bookId: string,
  coverExtension: CoverExtension | null,
): BookStoragePaths {
  if (!safeGeneratedId.test(bookId)) {
    throw new Error('Book ID contains unsafe path characters.');
  }

  const stagingDirectory = `light-reader/tmp/${bookId}`;
  const finalDirectory = `light-reader/books/${bookId}`;

  return {
    stagingDirectory,
    stagingBookPath: `${stagingDirectory}/book.epub`,
    stagingCoverPath: coverExtension
      ? `${stagingDirectory}/cover.${coverExtension}`
      : null,
    finalDirectory,
    finalBookPath: `${finalDirectory}/book.epub`,
    finalCoverPath: coverExtension
      ? `light-reader/covers/${bookId}.${coverExtension}`
      : null,
  };
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

export function fallbackTitleFromFileName(fileName: string): string {
  const title = fileName
    .trim()
    .replace(/\.epub$/i, '')
    .trim();
  return title || '未命名图书';
}

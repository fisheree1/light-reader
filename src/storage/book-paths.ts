export type CoverExtension = 'gif' | 'jpeg' | 'png' | 'webp';

export interface BookStoragePaths {
  finalBookPath: string;
  finalCoverPath: string | null;
  finalDirectory: string;
  stagingBookPath: string;
  stagingCoverPath: string | null;
  stagingDirectory: string;
}

export interface BookDeletionPaths {
  bookId: string;
  journalPath: string;
  originalBookDirectory: string;
  originalCoverPath: string | null;
  quarantineBookDirectory: string;
  quarantineCoverPath: string | null;
  quarantineDirectory: string;
}

const safeGeneratedId = /^[a-zA-Z0-9-]+$/;

function requireSafeGeneratedId(value: string, label: string): void {
  if (!safeGeneratedId.test(value)) {
    throw new Error(`${label} contains unsafe path characters.`);
  }
}

export function createBookStoragePaths(
  bookId: string,
  coverExtension: CoverExtension | null,
): BookStoragePaths {
  requireSafeGeneratedId(bookId, 'Book ID');

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

export function createBookDeletionPaths(
  bookId: string,
  bookPath: string,
  coverPath: string | null,
  deletionId: string,
): BookDeletionPaths {
  requireSafeGeneratedId(bookId, 'Book ID');
  requireSafeGeneratedId(deletionId, 'Deletion ID');
  const originalBookDirectory = `light-reader/books/${bookId}`;
  if (bookPath !== `${originalBookDirectory}/book.epub`) {
    throw new Error('Book file is outside its managed directory.');
  }

  let quarantineCoverPath: string | null = null;
  if (coverPath) {
    const match = new RegExp(
      `^light-reader/covers/${bookId}\\.(gif|jpeg|png|webp)$`,
    ).exec(coverPath);
    if (!match) throw new Error('Cover file is outside its managed directory.');
    quarantineCoverPath = `light-reader/trash/${deletionId}/cover.${match[1]}`;
  }

  const quarantineDirectory = `light-reader/trash/${deletionId}`;
  return {
    bookId,
    journalPath: `${quarantineDirectory}/deletion.json`,
    originalBookDirectory,
    originalCoverPath: coverPath,
    quarantineBookDirectory: `${quarantineDirectory}/book`,
    quarantineCoverPath,
    quarantineDirectory,
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

import { strToU8, unzip, zip } from 'fflate';

import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import {
  BACKUP_FORMAT_VERSION,
  CURRENT_DATABASE_SCHEMA_VERSION,
} from '../domain/backup';
import {
  backupArchivePaths,
  createBackupArchive,
  parseBackupArchive,
} from './backup-archive';

const hasher: ContentHasher = {
  sha256: (data) =>
    Promise.resolve(
      Array.from(data.slice(0, 32), (value) =>
        value.toString(16).padStart(2, '0'),
      )
        .join('')
        .padEnd(64, '0'),
    ),
};

const database = Uint8Array.from([
  ...new TextEncoder().encode('SQLite format 3\0'),
  ...new Uint8Array(128).fill(7),
]);

const summary = {
  schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
  counts: {
    annotations: 3,
    bookmarks: 0,
    books: 1,
    notes: 2,
    readingSessions: 0,
    readingStates: 1,
  },
};

function zipFiles(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function unzipFiles(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

describe('backup archive', () => {
  it('creates and validates a versioned backup', async () => {
    const archive = await createBackupArchive({
      appVersion: '0.1.0',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      database,
      hasher,
      summary,
    });

    await expect(parseBackupArchive(archive, hasher)).resolves.toMatchObject({
      manifest: {
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      },
      summary,
    });
  });

  it('round-trips hashed EPUB and cover assets in a full backup', async () => {
    const bookData = new TextEncoder().encode('epub-data');
    const coverData = new TextEncoder().encode('cover-data');
    const archive = await createBackupArchive({
      appVersion: '0.1.0',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      database,
      hasher,
      summary,
      mode: 'full',
      assets: [
        {
          bookId: 'book-1',
          data: bookData,
          kind: 'book',
          managedPath: 'light-reader/books/book-1/book.epub',
        },
        {
          bookId: 'book-1',
          data: coverData,
          kind: 'cover',
          managedPath: 'light-reader/covers/book-1.png',
        },
      ],
    });

    const parsed = await parseBackupArchive(archive, hasher);
    expect(parsed.manifest.contents.bookFiles).toBe(true);
    expect(parsed.assets).toHaveLength(2);
    expect(Array.from(parsed.assets[0]?.data ?? [])).toEqual(
      Array.from(bookData),
    );
    expect(parsed.assets[1]?.metadata.managedPath).toBe(
      'light-reader/covers/book-1.png',
    );
  });

  it('rejects a damaged database payload', async () => {
    const archive = await createBackupArchive({
      appVersion: '0.1.0',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      database,
      hasher,
      summary,
    });
    const files = await unzipFiles(archive);
    files[backupArchivePaths.database] = Uint8Array.from(database);
    files[backupArchivePaths.database][20] = 99;

    await expect(
      parseBackupArchive(await zipFiles(files), hasher),
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
  });

  it('rejects an unsupported format version before restore', async () => {
    const archive = await createBackupArchive({
      appVersion: '0.1.0',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      database,
      hasher,
      summary,
    });
    const files = await unzipFiles(archive);
    const manifest = JSON.parse(
      new TextDecoder().decode(files[backupArchivePaths.manifest]),
    ) as Record<string, unknown>;
    manifest.formatVersion = BACKUP_FORMAT_VERSION + 1;
    files[backupArchivePaths.manifest] = strToU8(JSON.stringify(manifest));

    await expect(
      parseBackupArchive(await zipFiles(files), hasher),
    ).rejects.toMatchObject({ code: 'BACKUP_VERSION_UNSUPPORTED' });
  });

  it('rejects unexpected archive entries', async () => {
    await expect(
      parseBackupArchive(
        await zipFiles({ '../outside': strToU8('not allowed') }),
        hasher,
      ),
    ).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
  });
});

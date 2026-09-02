import type {
  BackupPlatform,
  SelectedBackupFile,
} from '../../../platform/backup/backup-platform';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  type DatabaseBackupSummary,
  type DatabaseRestoreOutcome,
} from '../domain/backup';
import { BackupService } from './backup-service';
import type { BookRepository } from '../../../database/repositories/book-repository';
import type { Book } from '../../library/domain/book';

const database = Uint8Array.from([
  ...new TextEncoder().encode('SQLite format 3\0'),
  ...new Uint8Array(128).fill(9),
]);
const summary: DatabaseBackupSummary = {
  schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
  counts: {
    annotations: 2,
    bookmarks: 0,
    books: 1,
    notes: 3,
    readingSessions: 0,
    readingStates: 1,
  },
};
const hasher: ContentHasher = {
  sha256: () => Promise.resolve('a'.repeat(64)),
};

class FakeBackupPlatform implements BackupPlatform {
  readonly available = true;
  exportSelection: SelectedBackupFile | null = {
    fileName: 'backup.lightreader-backup',
    path: '/selected/backup.lightreader-backup',
  };
  importSelection: SelectedBackupFile | null = {
    fileName: 'backup.lightreader-backup',
    path: '/selected/backup.lightreader-backup',
  };
  archive: Uint8Array = new Uint8Array();
  stagedDatabase: Uint8Array = new Uint8Array();
  cleanupTokens: string[] = [];
  restoreFailure = false;
  restoreOutcome: DatabaseRestoreOutcome = {
    databaseState: 'ready',
    summary,
  };
  stagedAssetCount = 0;

  availableSpace(): Promise<number> {
    return Promise.resolve(1024 * 1024 * 1024);
  }

  countManagedConflicts(): Promise<number> {
    return Promise.resolve(1);
  }

  chooseExportPath(): Promise<SelectedBackupFile | null> {
    return Promise.resolve(this.exportSelection);
  }

  chooseImportPath(): Promise<SelectedBackupFile | null> {
    return Promise.resolve(this.importSelection);
  }

  cleanupSnapshot(snapshotId: string): Promise<void> {
    this.cleanupTokens.push(snapshotId);
    return Promise.resolve();
  }

  createSnapshot(): Promise<DatabaseBackupSummary> {
    return Promise.resolve(summary);
  }

  inspectSnapshot(): Promise<DatabaseBackupSummary> {
    return Promise.resolve(summary);
  }

  readExternal(): Promise<Uint8Array> {
    return Promise.resolve(this.archive);
  }

  readManaged(): Promise<Uint8Array> {
    return Promise.resolve(new TextEncoder().encode('managed epub'));
  }

  readSnapshot(): Promise<Uint8Array> {
    return Promise.resolve(database);
  }

  restoreSnapshot(): Promise<DatabaseRestoreOutcome> {
    return this.restoreFailure
      ? Promise.reject(new Error('restore failed'))
      : Promise.resolve(this.restoreOutcome);
  }

  stageSnapshot(
    _snapshotId: string,
    value: Uint8Array,
    assets: unknown[] = [],
  ): Promise<void> {
    this.stagedDatabase = value;
    this.stagedAssetCount = assets.length;
    return Promise.resolve();
  }

  writeExternal(_path: string, archive: Uint8Array): Promise<void> {
    this.archive = archive;
    return Promise.resolve();
  }
}

function createSubject(platform = new FakeBackupPlatform()) {
  return {
    platform,
    service: new BackupService(platform, hasher, {
      appVersion: '0.1.0',
      createId: () => 'snapshot-1',
      now: () => new Date('2026-08-01T10:00:00.000Z'),
    }),
  };
}

describe('BackupService', () => {
  it('exports a validated snapshot and always removes temporary files', async () => {
    const { platform, service } = createSubject();

    await expect(service.exportBackup()).resolves.toEqual({
      fileName: 'backup.lightreader-backup',
      status: 'exported',
    });
    expect(platform.archive.byteLength).toBeGreaterThan(0);
    expect(platform.cleanupTokens).toEqual(['snapshot-1']);
  });

  it('prevalidates an import before exposing restore confirmation', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    platform.cleanupTokens = [];

    await expect(service.prepareImport()).resolves.toEqual({
      status: 'prepared',
      backup: {
        counts: summary.counts,
        createdAt: '2026-08-01T10:00:00.000Z',
        schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
        token: 'snapshot-1',
      },
    });
    expect(platform.stagedDatabase).toEqual(database);
    expect(platform.cleanupTokens).toEqual([]);
  });

  it('preflights and stages managed files for a full migration backup', async () => {
    const platform = new FakeBackupPlatform();
    const book: Book = {
      id: 'book-1',
      title: '迁移测试书',
      author: null,
      format: 'epub',
      filePath: 'light-reader/books/book-1/book.epub',
      fileHash: 'a'.repeat(64),
      coverPath: null,
      metadata: {
        title: '迁移测试书',
        creators: [],
        language: null,
        publisher: null,
        description: null,
        identifier: null,
      },
      fileSize: 12,
      createdAt: 1,
      updatedAt: 1,
    };
    const bookRepository: BookRepository = {
      create: (value) => Promise.resolve(value),
      findById: () => Promise.resolve(book),
      findByHash: () => Promise.resolve(null),
      list: () => Promise.resolve([book]),
      delete: () => Promise.resolve(),
    };
    const service = new BackupService(platform, hasher, {
      appVersion: '0.1.0',
      bookRepository,
      createId: () => 'snapshot-1',
      now: () => new Date('2026-08-01T10:00:00.000Z'),
    });

    await service.exportBackup('full');
    const prepared = await service.prepareImport();

    expect(prepared).toMatchObject({
      status: 'prepared',
      backup: {
        mode: 'full',
        assetCount: 1,
        conflicts: 1,
      },
    });
    expect(platform.stagedAssetCount).toBe(1);
  });

  it('restores a prepared backup and cleans its staged database', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];

    await expect(service.restoreBackup(prepared.backup)).resolves.toEqual({
      status: 'restored',
    });
    expect(platform.cleanupTokens).toEqual(['snapshot-1']);
  });

  it('keeps the staged database when restore fails so the operation can be retried', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];
    platform.restoreFailure = true;

    await expect(service.restoreBackup(prepared.backup)).rejects.toMatchObject({
      code: 'BACKUP_RESTORE_FAILED',
    });
    expect(platform.cleanupTokens).toEqual([]);
  });

  it('reports a committed restore that needs an application restart', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];
    platform.restoreOutcome = {
      databaseState: 'reopen-required',
      summary,
    };

    await expect(service.restoreBackup(prepared.backup)).resolves.toEqual({
      status: 'restored-reopen-required',
    });
    expect(platform.cleanupTokens).toEqual([]);
  });

  it('reports a committed restore whose returned summary needs verification', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];
    platform.restoreOutcome = {
      databaseState: 'ready',
      summary: {
        ...summary,
        counts: { ...summary.counts, notes: summary.counts.notes + 1 },
      },
    };

    await expect(service.restoreBackup(prepared.backup)).resolves.toEqual({
      status: 'restored-verification-required',
    });
    expect(platform.cleanupTokens).toEqual([]);
  });

  it('returns quietly when a file dialog is cancelled', async () => {
    const { platform, service } = createSubject();
    platform.exportSelection = null;
    platform.importSelection = null;

    await expect(service.exportBackup()).resolves.toEqual({
      status: 'cancelled',
    });
    await expect(service.prepareImport()).resolves.toEqual({
      status: 'cancelled',
    });
  });
});

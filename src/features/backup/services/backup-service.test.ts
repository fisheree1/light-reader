import type {
  BackupPlatform,
  SelectedBackupFile,
} from '../../../platform/backup/backup-platform';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  type DatabaseBackupSummary,
} from '../domain/backup';
import { BackupService } from './backup-service';

const database = Uint8Array.from([
  ...new TextEncoder().encode('SQLite format 3\0'),
  ...new Uint8Array(128).fill(9),
]);
const summary: DatabaseBackupSummary = {
  schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
  counts: { annotations: 2, books: 1, notes: 3, readingStates: 1 },
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

  readSnapshot(): Promise<Uint8Array> {
    return Promise.resolve(database);
  }

  restoreSnapshot(): Promise<DatabaseBackupSummary> {
    return this.restoreFailure
      ? Promise.reject(new Error('restore failed'))
      : Promise.resolve(summary);
  }

  stageSnapshot(_snapshotId: string, value: Uint8Array): Promise<void> {
    this.stagedDatabase = value;
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

  it('restores a prepared backup and cleans its staged database', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];

    await expect(
      service.restoreBackup(prepared.backup),
    ).resolves.toBeUndefined();
    expect(platform.cleanupTokens).toEqual(['snapshot-1']);
  });

  it('maps restore failure without retaining temporary database files', async () => {
    const { platform, service } = createSubject();
    await service.exportBackup();
    const prepared = await service.prepareImport();
    if (prepared.status !== 'prepared') throw new Error('backup not prepared');
    platform.cleanupTokens = [];
    platform.restoreFailure = true;

    await expect(service.restoreBackup(prepared.backup)).rejects.toMatchObject({
      code: 'BACKUP_RESTORE_FAILED',
    });
    expect(platform.cleanupTokens).toEqual(['snapshot-1']);
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

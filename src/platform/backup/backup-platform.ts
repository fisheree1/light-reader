import { invoke } from '@tauri-apps/api/core';
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
} from '@tauri-apps/plugin-fs';
import { open, save } from '@tauri-apps/plugin-dialog';

import {
  closeDatabaseForMaintenance,
  getDatabase,
} from '../../database/client';
import {
  databaseBackupSummarySchema,
  type DatabaseBackupSummary,
  type DatabaseRestoreOutcome,
  type BackupAsset,
  type BackupMode,
} from '../../features/backup/domain/backup';
import { fileNameFromPath } from '../../storage/book-paths';

export interface SelectedBackupFile {
  fileName: string;
  path: string;
}

export interface BackupPlatform {
  readonly available: boolean;
  chooseExportPath(defaultFileName: string): Promise<SelectedBackupFile | null>;
  chooseImportPath(): Promise<SelectedBackupFile | null>;
  cleanupSnapshot(snapshotId: string): Promise<void>;
  createSnapshot(snapshotId: string): Promise<DatabaseBackupSummary>;
  inspectSnapshot(
    snapshotId: string,
    mode?: BackupMode,
  ): Promise<DatabaseBackupSummary>;
  availableSpace(): Promise<number>;
  countManagedConflicts(paths: string[]): Promise<number>;
  readExternal(path: string): Promise<Uint8Array>;
  readManaged(path: string): Promise<Uint8Array>;
  readSnapshot(snapshotId: string): Promise<Uint8Array>;
  restoreSnapshot(
    snapshotId: string,
    mode?: BackupMode,
  ): Promise<DatabaseRestoreOutcome>;
  stageSnapshot(
    snapshotId: string,
    database: Uint8Array,
    assets?: { metadata: BackupAsset; data: Uint8Array }[],
  ): Promise<void>;
  writeExternal(path: string, archive: Uint8Array): Promise<void>;
}

const safeId = /^[a-zA-Z0-9-]+$/;

function snapshotDirectory(snapshotId: string): string {
  if (!safeId.test(snapshotId)) throw new Error('Unsafe backup snapshot ID.');
  return `light-reader/backup/${snapshotId}`;
}

function snapshotPath(snapshotId: string): string {
  return `${snapshotDirectory(snapshotId)}/database.sqlite`;
}

async function invokeSummary(
  command: string,
  snapshotId: string,
): Promise<DatabaseBackupSummary> {
  return databaseBackupSummarySchema.parse(
    await invoke<unknown>(command, { snapshotId }),
  );
}

export class TauriBackupPlatform implements BackupPlatform {
  readonly available = true;
  private readonly closeDatabase: () => Promise<void>;
  private readonly reopenDatabase: () => Promise<unknown>;
  private readonly restoreNative: (
    snapshotId: string,
  ) => Promise<DatabaseBackupSummary>;

  constructor(
    dependencies: {
      closeDatabase?: () => Promise<void>;
      reopenDatabase?: () => Promise<unknown>;
      restoreNative?: (snapshotId: string) => Promise<DatabaseBackupSummary>;
    } = {},
  ) {
    this.closeDatabase =
      dependencies.closeDatabase ?? closeDatabaseForMaintenance;
    this.reopenDatabase = dependencies.reopenDatabase ?? getDatabase;
    this.restoreNative =
      dependencies.restoreNative ??
      ((snapshotId) => invokeSummary('restore_database_snapshot', snapshotId));
  }

  async chooseExportPath(
    defaultFileName: string,
  ): Promise<SelectedBackupFile | null> {
    const path = await save({
      defaultPath: defaultFileName,
      filters: [
        { name: 'LightReader 备份', extensions: ['lightreader-backup'] },
      ],
      title: '导出 LightReader 备份',
    });
    return path ? { fileName: fileNameFromPath(path), path } : null;
  }

  async chooseImportPath(): Promise<SelectedBackupFile | null> {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [
        { name: 'LightReader 备份', extensions: ['lightreader-backup'] },
      ],
      title: '导入 LightReader 备份',
    });
    return typeof path === 'string'
      ? { fileName: fileNameFromPath(path), path }
      : null;
  }

  cleanupSnapshot(snapshotId: string): Promise<void> {
    const directory = snapshotDirectory(snapshotId);
    return exists(directory, { baseDir: BaseDirectory.AppData }).then(
      async (present) => {
        if (present) {
          await remove(directory, {
            baseDir: BaseDirectory.AppData,
            recursive: true,
          });
        }
      },
    );
  }

  createSnapshot(snapshotId: string): Promise<DatabaseBackupSummary> {
    return invokeSummary('create_database_snapshot', snapshotId);
  }

  inspectSnapshot(
    snapshotId: string,
    mode: BackupMode = 'database',
  ): Promise<DatabaseBackupSummary> {
    return invokeSummary(
      mode === 'full'
        ? 'inspect_full_backup_snapshot'
        : 'inspect_database_snapshot',
      snapshotId,
    );
  }

  availableSpace(): Promise<number> {
    return invoke<number>('available_backup_space');
  }

  async countManagedConflicts(paths: string[]): Promise<number> {
    const conflicts = await Promise.all(
      paths.map((path) =>
        exists(path, { baseDir: BaseDirectory.AppData }).catch(() => false),
      ),
    );
    return conflicts.filter(Boolean).length;
  }

  readExternal(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  readManaged(path: string): Promise<Uint8Array> {
    return readFile(path, { baseDir: BaseDirectory.AppData });
  }

  readSnapshot(snapshotId: string): Promise<Uint8Array> {
    return readFile(snapshotPath(snapshotId), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async restoreSnapshot(
    snapshotId: string,
    mode: BackupMode = 'database',
  ): Promise<DatabaseRestoreOutcome> {
    await this.closeDatabase();
    let restored: DatabaseBackupSummary | undefined;
    let restoreError: unknown;
    try {
      restored =
        mode === 'full'
          ? await invokeSummary('restore_full_backup_snapshot', snapshotId)
          : await this.restoreNative(snapshotId);
    } catch (error) {
      restoreError = error;
    }

    try {
      await this.reopenDatabase();
    } catch (reopenError) {
      if (restored) {
        return { summary: restored, databaseState: 'reopen-required' };
      }
      throw new AggregateError(
        restoreError ? [restoreError, reopenError] : [reopenError],
        'Unable to reopen the LightReader database after restore.',
        { cause: reopenError },
      );
    }
    if (restoreError) {
      throw new Error('Native database restore failed.', {
        cause: restoreError,
      });
    }
    if (!restored) throw new Error('Restore completed without a summary.');
    return { summary: restored, databaseState: 'ready' };
  }

  async stageSnapshot(
    snapshotId: string,
    database: Uint8Array,
    assets: { metadata: BackupAsset; data: Uint8Array }[] = [],
  ): Promise<void> {
    const directory = snapshotDirectory(snapshotId);
    await this.cleanupSnapshot(snapshotId);
    await mkdir(directory, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    await writeFile(snapshotPath(snapshotId), database, {
      baseDir: BaseDirectory.AppData,
    });
    for (const asset of assets) {
      const path = `${directory}/${asset.metadata.archivePath}`;
      const parent = path.slice(0, path.lastIndexOf('/'));
      await mkdir(parent, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      await writeFile(path, asset.data, { baseDir: BaseDirectory.AppData });
    }
  }

  writeExternal(path: string, archive: Uint8Array): Promise<void> {
    return writeFile(path, archive);
  }
}

export class UnavailableBackupPlatform implements BackupPlatform {
  readonly available = false;

  private unavailable(): Promise<never> {
    return Promise.reject(new Error('Native backup is unavailable.'));
  }

  chooseExportPath(): Promise<SelectedBackupFile | null> {
    return this.unavailable();
  }

  chooseImportPath(): Promise<SelectedBackupFile | null> {
    return this.unavailable();
  }

  cleanupSnapshot(): Promise<void> {
    return Promise.resolve();
  }

  createSnapshot(): Promise<DatabaseBackupSummary> {
    return this.unavailable();
  }

  inspectSnapshot(): Promise<DatabaseBackupSummary> {
    return this.unavailable();
  }

  availableSpace(): Promise<number> {
    return this.unavailable();
  }

  countManagedConflicts(): Promise<number> {
    return this.unavailable();
  }

  readExternal(): Promise<Uint8Array> {
    return this.unavailable();
  }

  readManaged(): Promise<Uint8Array> {
    return this.unavailable();
  }

  readSnapshot(): Promise<Uint8Array> {
    return this.unavailable();
  }

  restoreSnapshot(): Promise<DatabaseRestoreOutcome> {
    return this.unavailable();
  }

  stageSnapshot(): Promise<void> {
    return this.unavailable();
  }

  writeExternal(): Promise<void> {
    return this.unavailable();
  }
}

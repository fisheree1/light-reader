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
  inspectSnapshot(snapshotId: string): Promise<DatabaseBackupSummary>;
  readExternal(path: string): Promise<Uint8Array>;
  readSnapshot(snapshotId: string): Promise<Uint8Array>;
  restoreSnapshot(snapshotId: string): Promise<DatabaseBackupSummary>;
  stageSnapshot(snapshotId: string, database: Uint8Array): Promise<void>;
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

  inspectSnapshot(snapshotId: string): Promise<DatabaseBackupSummary> {
    return invokeSummary('inspect_database_snapshot', snapshotId);
  }

  readExternal(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  readSnapshot(snapshotId: string): Promise<Uint8Array> {
    return readFile(snapshotPath(snapshotId), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async restoreSnapshot(snapshotId: string): Promise<DatabaseBackupSummary> {
    await closeDatabaseForMaintenance();
    let restored: DatabaseBackupSummary | undefined;
    let restoreError: unknown;
    try {
      restored = await invokeSummary('restore_database_snapshot', snapshotId);
    } catch (error) {
      restoreError = error;
    }

    try {
      await getDatabase();
    } catch (reopenError) {
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
    return restored;
  }

  async stageSnapshot(snapshotId: string, database: Uint8Array): Promise<void> {
    const directory = snapshotDirectory(snapshotId);
    await this.cleanupSnapshot(snapshotId);
    await mkdir(directory, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    await writeFile(snapshotPath(snapshotId), database, {
      baseDir: BaseDirectory.AppData,
    });
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

  readExternal(): Promise<Uint8Array> {
    return this.unavailable();
  }

  readSnapshot(): Promise<Uint8Array> {
    return this.unavailable();
  }

  restoreSnapshot(): Promise<DatabaseBackupSummary> {
    return this.unavailable();
  }

  stageSnapshot(): Promise<void> {
    return this.unavailable();
  }

  writeExternal(): Promise<void> {
    return this.unavailable();
  }
}

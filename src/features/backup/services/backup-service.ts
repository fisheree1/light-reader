import { AppError, isAppError } from '../../../lib/app-error';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type { BackupPlatform } from '../../../platform/backup/backup-platform';
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  createBackupFileName,
  preparedBackupSchema,
  type BackupExportResult,
  type BackupPrepareResult,
  type DatabaseBackupSummary,
  type PreparedBackup,
} from '../domain/backup';
import { createBackupArchive, parseBackupArchive } from './backup-archive';

export interface BackupManager {
  readonly available: boolean;
  discardPreparedBackup(backup: PreparedBackup): Promise<void>;
  exportBackup(): Promise<BackupExportResult>;
  prepareImport(): Promise<BackupPrepareResult>;
  restoreBackup(backup: PreparedBackup): Promise<void>;
}

interface BackupServiceOptions {
  appVersion?: string;
  createId?: () => string;
  now?: () => Date;
}

function summariesMatch(
  left: DatabaseBackupSummary,
  right: DatabaseBackupSummary,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.counts.annotations === right.counts.annotations &&
    left.counts.books === right.counts.books &&
    left.counts.notes === right.counts.notes &&
    left.counts.readingStates === right.counts.readingStates
  );
}

export class BackupService implements BackupManager {
  readonly available: boolean;
  private readonly appVersion: string;
  private readonly createId: () => string;
  private readonly hasher: ContentHasher;
  private readonly now: () => Date;
  private readonly platform: BackupPlatform;

  constructor(
    platform: BackupPlatform,
    hasher: ContentHasher,
    options: BackupServiceOptions = {},
  ) {
    this.platform = platform;
    this.hasher = hasher;
    this.available = platform.available;
    this.appVersion = options.appVersion ?? '0.1.0';
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  async exportBackup(): Promise<BackupExportResult> {
    const createdAt = this.now();
    const selected = await this.platform
      .chooseExportPath(createBackupFileName(createdAt))
      .catch((error: unknown) => {
        throw new AppError('BACKUP_EXPORT_FAILED', { cause: error });
      });
    if (!selected) return { status: 'cancelled' };

    const snapshotId = this.createId();
    try {
      const summary = await this.platform.createSnapshot(snapshotId);
      const database = await this.platform.readSnapshot(snapshotId);
      const archive = await createBackupArchive({
        appVersion: this.appVersion,
        createdAt,
        database,
        hasher: this.hasher,
        summary,
      });
      try {
        await this.platform.writeExternal(selected.path, archive);
      } catch (error) {
        throw new AppError('BACKUP_FILE_WRITE_FAILED', { cause: error });
      }
      return { fileName: selected.fileName, status: 'exported' };
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BACKUP_EXPORT_FAILED', { cause: error });
    } finally {
      await this.platform.cleanupSnapshot(snapshotId).catch(() => undefined);
    }
  }

  async prepareImport(): Promise<BackupPrepareResult> {
    const selected = await this.platform
      .chooseImportPath()
      .catch((error: unknown) => {
        throw new AppError('BACKUP_FILE_READ_FAILED', { cause: error });
      });
    if (!selected) return { status: 'cancelled' };

    let archive: Uint8Array;
    try {
      archive = await this.platform.readExternal(selected.path);
    } catch (error) {
      throw new AppError('BACKUP_FILE_READ_FAILED', { cause: error });
    }
    const parsed = await parseBackupArchive(archive, this.hasher);
    const snapshotId = this.createId();
    try {
      await this.platform.stageSnapshot(snapshotId, parsed.database);
      const inspected = await this.platform.inspectSnapshot(snapshotId);
      if (!summariesMatch(inspected, parsed.summary)) {
        throw new AppError('BACKUP_INVALID');
      }
      return {
        status: 'prepared',
        backup: preparedBackupSchema.parse({
          counts: inspected.counts,
          createdAt: parsed.manifest.createdAt,
          schemaVersion: inspected.schemaVersion,
          token: snapshotId,
        }),
      };
    } catch (error) {
      await this.platform.cleanupSnapshot(snapshotId).catch(() => undefined);
      if (isAppError(error)) throw error;
      throw new AppError('BACKUP_INVALID', { cause: error });
    }
  }

  async restoreBackup(value: PreparedBackup): Promise<void> {
    const backup = preparedBackupSchema.parse(value);
    if (backup.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new AppError('BACKUP_VERSION_UNSUPPORTED');
    }
    try {
      const restored = await this.platform.restoreSnapshot(backup.token);
      if (
        !summariesMatch(restored, {
          counts: backup.counts,
          schemaVersion: backup.schemaVersion,
        })
      ) {
        throw new AppError('BACKUP_RESTORE_FAILED');
      }
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BACKUP_RESTORE_FAILED', { cause: error });
    } finally {
      await this.platform.cleanupSnapshot(backup.token).catch(() => undefined);
    }
  }

  discardPreparedBackup(value: PreparedBackup): Promise<void> {
    const backup = preparedBackupSchema.parse(value);
    return this.platform.cleanupSnapshot(backup.token);
  }
}

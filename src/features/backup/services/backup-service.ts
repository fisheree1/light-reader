import { AppError, isAppError } from '../../../lib/app-error';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type { BackupPlatform } from '../../../platform/backup/backup-platform';
import type { BookRepository } from '../../../database/repositories/book-repository';
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  createBackupFileName,
  databaseBackupSummarySchema,
  preparedBackupSchema,
  type BackupExportResult,
  type BackupPrepareResult,
  type BackupRestoreResult,
  type DatabaseBackupSummary,
  type PreparedBackup,
  type BackupMode,
} from '../domain/backup';
import { createBackupArchive, parseBackupArchive } from './backup-archive';

export interface BackupManager {
  readonly available: boolean;
  discardPreparedBackup(backup: PreparedBackup): Promise<void>;
  exportBackup(mode?: BackupMode): Promise<BackupExportResult>;
  prepareImport(): Promise<BackupPrepareResult>;
  restoreBackup(backup: PreparedBackup): Promise<BackupRestoreResult>;
}

interface BackupServiceOptions {
  appVersion?: string;
  createId?: () => string;
  now?: () => Date;
  bookRepository?: BookRepository;
}

function summariesMatch(
  left: DatabaseBackupSummary,
  right: DatabaseBackupSummary,
): boolean {
  const normalizedLeft = databaseBackupSummarySchema.parse(left);
  const normalizedRight = databaseBackupSummarySchema.parse(right);
  return (
    normalizedLeft.schemaVersion === normalizedRight.schemaVersion &&
    normalizedLeft.counts.annotations === normalizedRight.counts.annotations &&
    normalizedLeft.counts.books === normalizedRight.counts.books &&
    normalizedLeft.counts.notes === normalizedRight.counts.notes &&
    normalizedLeft.counts.readingStates ===
      normalizedRight.counts.readingStates &&
    normalizedLeft.counts.bookmarks === normalizedRight.counts.bookmarks &&
    normalizedLeft.counts.readingSessions ===
      normalizedRight.counts.readingSessions
  );
}

export class BackupService implements BackupManager {
  readonly available: boolean;
  private readonly appVersion: string;
  private readonly createId: () => string;
  private readonly hasher: ContentHasher;
  private readonly now: () => Date;
  private readonly platform: BackupPlatform;
  private readonly bookRepository?: BookRepository;

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
    this.bookRepository = options.bookRepository;
  }

  async exportBackup(
    mode: BackupMode = 'database',
  ): Promise<BackupExportResult> {
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
      const assets = mode === 'full' ? await this.collectManagedAssets() : [];
      const archive = await createBackupArchive({
        appVersion: this.appVersion,
        createdAt,
        database,
        hasher: this.hasher,
        summary,
        mode,
        assets,
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
    const mode: BackupMode = parsed.manifest.contents.bookFiles
      ? 'full'
      : 'database';
    const assetBytes = parsed.assets.reduce(
      (sum, asset) => sum + asset.metadata.size,
      0,
    );
    if (mode === 'full') {
      const available = await this.platform
        .availableSpace()
        .catch((error: unknown) => {
          throw new AppError('BACKUP_CAPACITY_INSUFFICIENT', {
            cause: error,
          });
        });
      const required =
        assetBytes + parsed.database.byteLength + 64 * 1024 * 1024;
      if (available < required) {
        throw new AppError('BACKUP_CAPACITY_INSUFFICIENT');
      }
    }
    const snapshotId = this.createId();
    try {
      await this.platform.stageSnapshot(
        snapshotId,
        parsed.database,
        parsed.assets,
      );
      const inspected = await this.platform.inspectSnapshot(snapshotId, mode);
      if (!summariesMatch(inspected, parsed.summary)) {
        throw new AppError('BACKUP_INVALID');
      }
      return {
        status: 'prepared',
        backup: preparedBackupSchema.parse({
          counts: inspected.counts,
          createdAt: parsed.manifest.createdAt,
          ...(mode === 'full'
            ? {
                assetBytes,
                assetCount: parsed.assets.length,
                conflicts: await this.platform.countManagedConflicts(
                  parsed.assets.map((asset) => asset.metadata.managedPath),
                ),
                mode,
              }
            : {}),
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

  async restoreBackup(value: PreparedBackup): Promise<BackupRestoreResult> {
    const backup = preparedBackupSchema.parse(value);
    if (backup.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new AppError('BACKUP_VERSION_UNSUPPORTED');
    }
    try {
      const restored = await this.platform.restoreSnapshot(
        backup.token,
        backup.mode ?? 'database',
      );
      if (
        !summariesMatch(restored.summary, {
          counts: backup.counts,
          schemaVersion: backup.schemaVersion,
        })
      ) {
        return { status: 'restored-verification-required' };
      }
      if (restored.databaseState === 'reopen-required') {
        return { status: 'restored-reopen-required' };
      }
      await this.platform.cleanupSnapshot(backup.token).catch(() => undefined);
      return { status: 'restored' };
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('BACKUP_RESTORE_FAILED', { cause: error });
    }
  }

  discardPreparedBackup(value: PreparedBackup): Promise<void> {
    const backup = preparedBackupSchema.parse(value);
    return this.platform.cleanupSnapshot(backup.token);
  }

  private async collectManagedAssets() {
    if (!this.bookRepository) throw new AppError('BACKUP_EXPORT_FAILED');
    const books = await this.bookRepository.list();
    return Promise.all(
      books.flatMap((book) => [
        this.platform.readManaged(book.filePath).then((data) => ({
          bookId: book.id,
          data,
          kind: 'book' as const,
          managedPath: book.filePath,
        })),
        ...(() => {
          const coverPath = book.coverPath;
          return coverPath
            ? [
                this.platform.readManaged(coverPath).then((data) => ({
                  bookId: book.id,
                  data,
                  kind: 'cover' as const,
                  managedPath: coverPath,
                })),
              ]
            : [];
        })(),
      ]),
    );
  }
}

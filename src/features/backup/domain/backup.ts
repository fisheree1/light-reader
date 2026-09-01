import { z } from 'zod';

export const BACKUP_FORMAT = 'lightreader-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const CURRENT_DATABASE_SCHEMA_VERSION = 8;
export const BACKUP_FILE_EXTENSION = 'lightreader-backup';

export const backupCountsSchema = z
  .object({
    annotations: z.number().int().nonnegative(),
    books: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
    readingStates: z.number().int().nonnegative(),
  })
  .strict();

export type BackupCounts = z.infer<typeof backupCountsSchema>;

export const databaseBackupSummarySchema = z
  .object({
    counts: backupCountsSchema,
    schemaVersion: z.number().int().nonnegative(),
  })
  .strict();

export type DatabaseBackupSummary = z.infer<typeof databaseBackupSummarySchema>;

export interface DatabaseRestoreOutcome {
  databaseState: 'ready' | 'reopen-required';
  summary: DatabaseBackupSummary;
}

export type BackupRestoreResult =
  | { status: 'restored' }
  | { status: 'restored-reopen-required' }
  | { status: 'restored-verification-required' };

export const backupManifestSchema = z
  .object({
    appVersion: z.string().trim().min(1).max(100),
    contents: z
      .object({
        database: z.literal(true),
        bookFiles: z.literal(false),
      })
      .strict(),
    counts: backupCountsSchema,
    createdAt: z.iso.datetime({ offset: true }),
    database: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().positive(),
      })
      .strict(),
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.number().int().positive(),
    schemaVersion: z.number().int().nonnegative(),
  })
  .strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export const preparedBackupSchema = z
  .object({
    counts: backupCountsSchema,
    createdAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.number().int().nonnegative(),
    token: z.string().regex(/^[a-zA-Z0-9-]+$/),
  })
  .strict();

export type PreparedBackup = z.infer<typeof preparedBackupSchema>;

export type BackupExportResult =
  { status: 'cancelled' } | { fileName: string; status: 'exported' };

export type BackupPrepareResult =
  { status: 'cancelled' } | { backup: PreparedBackup; status: 'prepared' };

export function createBackupFileName(date: Date): string {
  const timestamp = date
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');
  return `LightReader-${timestamp}.${BACKUP_FILE_EXTENSION}`;
}

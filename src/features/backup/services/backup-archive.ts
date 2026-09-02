import { strFromU8, strToU8, unzip, zip, type Zippable } from 'fflate';

import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import { AppError, isAppError } from '../../../lib/app-error';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  CURRENT_DATABASE_SCHEMA_VERSION,
  backupManifestSchema,
  databaseBackupSummarySchema,
  type BackupManifest,
  type BackupAsset,
  type BackupMode,
  type DatabaseBackupSummary,
} from '../domain/backup';

const MANIFEST_PATH = 'manifest.json';
const DATABASE_PATH = 'database.sqlite';
const SUMMARY_PATH = 'metadata/summary.json';
const requiredEntries = new Set([MANIFEST_PATH, DATABASE_PATH, SUMMARY_PATH]);
const assetPathPattern =
  /^assets\/light-reader\/(?:books|covers)\/[a-zA-Z0-9._/-]+$/;
const maxArchiveSize = 4 * 1024 * 1024 * 1024;
const maxDatabaseSize = 512 * 1024 * 1024;
const maxAssetSize = 2 * 1024 * 1024 * 1024;
const maxMetadataSize = 128 * 1024;
const sqliteHeader = strToU8('SQLite format 3\0');

interface CreateBackupArchiveInput {
  appVersion: string;
  createdAt: Date;
  database: Uint8Array;
  hasher: ContentHasher;
  summary: DatabaseBackupSummary;
  mode?: BackupMode;
  assets?: {
    bookId: string;
    data: Uint8Array;
    kind: 'book' | 'cover';
    managedPath: string;
  }[];
}

export interface ParsedBackupArchive {
  assets: { metadata: BackupAsset; data: Uint8Array }[];
  database: Uint8Array;
  manifest: BackupManifest;
  summary: DatabaseBackupSummary;
}

function zipFiles(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function unzipArchive(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    try {
      unzip(
        data,
        {
          filter(file) {
            if (
              !requiredEntries.has(file.name) &&
              !assetPathPattern.test(file.name)
            ) {
              throw new AppError('BACKUP_INVALID');
            }
            const limit =
              file.name === DATABASE_PATH
                ? maxDatabaseSize
                : assetPathPattern.test(file.name)
                  ? maxAssetSize
                  : maxMetadataSize;
            if (file.originalSize <= 0 || file.originalSize > limit) {
              throw new AppError('BACKUP_INVALID');
            }
            return true;
          },
        },
        (error, files) => {
          if (error) reject(error);
          else resolve(files);
        },
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function parseJson(data: Uint8Array | undefined): unknown {
  if (!data) throw new AppError('BACKUP_INVALID');
  try {
    return JSON.parse(strFromU8(data)) as unknown;
  } catch (error) {
    throw new AppError('BACKUP_INVALID', { cause: error });
  }
}

function hasSqliteHeader(database: Uint8Array): boolean {
  return sqliteHeader.every((byte, index) => database[index] === byte);
}

export async function createBackupArchive({
  appVersion,
  createdAt,
  database,
  hasher,
  summary: valueSummary,
  assets: inputAssets = [],
  mode = 'database',
}: CreateBackupArchiveInput): Promise<Uint8Array> {
  const summary = databaseBackupSummarySchema.parse(valueSummary);
  if (
    summary.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION ||
    !hasSqliteHeader(database) ||
    database.byteLength > maxDatabaseSize
  ) {
    throw new AppError('BACKUP_EXPORT_FAILED');
  }

  const assets = await Promise.all(
    inputAssets.map(async (asset) => ({
      archivePath: `assets/${asset.managedPath}`,
      bookId: asset.bookId,
      kind: asset.kind,
      managedPath: asset.managedPath,
      sha256: await hasher.sha256(asset.data),
      size: asset.data.byteLength,
    })),
  );
  const manifest = backupManifestSchema.parse({
    appVersion,
    assets,
    contents: { database: true, bookFiles: mode === 'full' },
    counts: summary.counts,
    createdAt: createdAt.toISOString(),
    database: {
      sha256: await hasher.sha256(database),
      size: database.byteLength,
    },
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: summary.schemaVersion,
  });

  try {
    const files: Zippable = {
      [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
      [DATABASE_PATH]: database,
      [SUMMARY_PATH]: strToU8(JSON.stringify(summary, null, 2)),
    };
    for (const [index, metadata] of assets.entries()) {
      files[metadata.archivePath] = inputAssets[index].data;
    }
    return await zipFiles(files);
  } catch (error) {
    throw new AppError('BACKUP_EXPORT_FAILED', { cause: error });
  }
}

export async function parseBackupArchive(
  archive: Uint8Array,
  hasher: ContentHasher,
): Promise<ParsedBackupArchive> {
  if (archive.byteLength === 0 || archive.byteLength > maxArchiveSize) {
    throw new AppError('BACKUP_INVALID');
  }

  try {
    const files: Record<string, Uint8Array | undefined> =
      await unzipArchive(archive);
    if ([...requiredEntries].some((name) => !Object.hasOwn(files, name))) {
      throw new AppError('BACKUP_INVALID');
    }

    const manifest = backupManifestSchema.parse(
      parseJson(files[MANIFEST_PATH]),
    );
    if (
      manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
      manifest.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION
    ) {
      throw new AppError('BACKUP_VERSION_UNSUPPORTED');
    }

    const summary = databaseBackupSummarySchema.parse(
      parseJson(files[SUMMARY_PATH]),
    );
    const database = files[DATABASE_PATH];
    if (
      !database ||
      !hasSqliteHeader(database) ||
      database.byteLength !== manifest.database.size ||
      summary.schemaVersion !== manifest.schemaVersion ||
      JSON.stringify(summary.counts) !== JSON.stringify(manifest.counts)
    ) {
      throw new AppError('BACKUP_INVALID');
    }
    if ((await hasher.sha256(database)) !== manifest.database.sha256) {
      throw new AppError('BACKUP_INVALID');
    }
    const expectedEntries = new Set([
      ...requiredEntries,
      ...manifest.assets.map((asset) => asset.archivePath),
    ]);
    if (
      Object.keys(files).length !== expectedEntries.size ||
      Object.keys(files).some((name) => !expectedEntries.has(name)) ||
      (!manifest.contents.bookFiles && manifest.assets.length > 0)
    ) {
      throw new AppError('BACKUP_INVALID');
    }
    const assets = await Promise.all(
      manifest.assets.map(async (metadata) => {
        const data = files[metadata.archivePath];
        if (
          data?.byteLength !== metadata.size ||
          (await hasher.sha256(data)) !== metadata.sha256
        ) {
          throw new AppError('BACKUP_INVALID');
        }
        return { metadata, data };
      }),
    );

    return { assets, database, manifest, summary };
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError('BACKUP_INVALID', { cause: error });
  }
}

export const backupArchivePaths = {
  database: DATABASE_PATH,
  manifest: MANIFEST_PATH,
  summary: SUMMARY_PATH,
} as const;

import type { DatabaseBackupSummary } from '../../features/backup/domain/backup';
import { TauriBackupPlatform } from './backup-platform';

const summary: DatabaseBackupSummary = {
  schemaVersion: 8,
  counts: { annotations: 2, books: 1, notes: 3, readingStates: 1 },
};

describe('TauriBackupPlatform restore state machine', () => {
  it('returns a ready database after a committed restore reopens normally', async () => {
    const closeDatabase = vi.fn(() => Promise.resolve());
    const reopenDatabase = vi.fn(() => Promise.resolve());
    const restoreNative = vi.fn(() => Promise.resolve(summary));
    const platform = new TauriBackupPlatform({
      closeDatabase,
      reopenDatabase,
      restoreNative,
    });

    await expect(platform.restoreSnapshot('snapshot-1')).resolves.toEqual({
      databaseState: 'ready',
      summary,
    });
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(restoreNative).toHaveBeenCalledWith('snapshot-1');
    expect(reopenDatabase).toHaveBeenCalledOnce();
  });

  it('does not report rollback when native commit succeeded but reopening failed', async () => {
    const platform = new TauriBackupPlatform({
      closeDatabase: () => Promise.resolve(),
      reopenDatabase: () => Promise.reject(new Error('pool unavailable')),
      restoreNative: () => Promise.resolve(summary),
    });

    await expect(platform.restoreSnapshot('snapshot-1')).resolves.toEqual({
      databaseState: 'reopen-required',
      summary,
    });
  });

  it('keeps a failed native restore as an error after the existing database reopens', async () => {
    const platform = new TauriBackupPlatform({
      closeDatabase: () => Promise.resolve(),
      reopenDatabase: () => Promise.resolve(),
      restoreNative: () => Promise.reject(new Error('transaction rolled back')),
    });

    await expect(platform.restoreSnapshot('snapshot-1')).rejects.toThrow(
      'Native database restore failed',
    );
  });
});

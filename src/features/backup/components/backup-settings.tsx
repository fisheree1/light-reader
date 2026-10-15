import { ArchiveRestore, Download, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { asAppError } from '../../../lib/app-error';
import type { PreparedBackup } from '../domain/backup';
import type { BackupMode } from '../domain/backup';
import type { BackupManager } from '../services/backup-service';
import { useI18n } from '../../../i18n/use-i18n';

type BackupStatus =
  | 'error'
  | 'exported'
  | 'exporting'
  | 'idle'
  | 'preparing'
  | 'restored'
  | 'restored-reopen-required'
  | 'restored-verification-required'
  | 'restoring';

interface BackupSettingsProps {
  manager: BackupManager;
}

export function BackupSettings({ manager }: BackupSettingsProps) {
  const { formatDate, t } = useI18n();
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const preparedRef = useRef<PreparedBackup | null>(null);
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [message, setMessage] = useState('');
  const [exportMode, setExportMode] = useState<BackupMode>('database');

  useEffect(
    () => () => {
      if (preparedRef.current) {
        void manager.discardPreparedBackup(preparedRef.current);
      }
    },
    [manager],
  );

  function updatePrepared(value: PreparedBackup | null) {
    preparedRef.current = value;
    setPrepared(value);
  }

  async function handleExport() {
    setStatus('exporting');
    setMessage('');
    try {
      const result = await manager.exportBackup(exportMode);
      if (result.status === 'cancelled') {
        setStatus('idle');
        return;
      }
      setStatus('exported');
      setMessage(t('backup.savedAs', { fileName: result.fileName }));
    } catch (error) {
      setStatus('error');
      setMessage(asAppError(error, 'BACKUP_EXPORT_FAILED').userMessage);
    }
  }

  async function handlePrepareImport() {
    setStatus('preparing');
    setMessage('');
    try {
      const result = await manager.prepareImport();
      if (result.status === 'cancelled') {
        setStatus('idle');
        return;
      }
      updatePrepared(result.backup);
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setMessage(asAppError(error, 'BACKUP_INVALID').userMessage);
    }
  }

  async function handleRestore() {
    if (!prepared) return;
    setStatus('restoring');
    setMessage('');
    try {
      const result = await manager.restoreBackup(prepared);
      updatePrepared(null);
      setStatus(result.status);
      if (result.status === 'restored') {
        setMessage(t('backup.restored'));
      } else if (result.status === 'restored-reopen-required') {
        setMessage(t('backup.restoredReopen'));
      } else {
        setMessage(t('backup.restoredVerify'));
      }
    } catch (error) {
      setStatus('error');
      setMessage(asAppError(error, 'BACKUP_RESTORE_FAILED').userMessage);
    }
  }

  async function handleDiscard() {
    if (!prepared) return;
    await manager.discardPreparedBackup(prepared).catch(() => undefined);
    updatePrepared(null);
    setStatus('idle');
    setMessage('');
  }

  const busy =
    status === 'exporting' || status === 'preparing' || status === 'restoring';

  return (
    <section className="bg-surface mt-4 rounded-lg border p-5">
      <h2 className="font-medium">{t('backup.title')}</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        {t('backup.description')}
      </p>

      {!manager.available ? (
        <p className="text-muted-foreground mt-4 text-sm">
          {t('backup.desktopOnly')}
        </p>
      ) : prepared ? (
        <div className="border-primary/30 bg-muted mt-5 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="text-primary mt-0.5"
              size={20}
            />
            <div>
              <h3 className="text-sm font-semibold">{t('backup.verified')}</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('backup.summary', {
                  date: formatDate(Date.parse(prepared.createdAt)),
                  books: prepared.counts.books,
                  states: prepared.counts.readingStates,
                  annotations: prepared.counts.annotations,
                  notes: prepared.counts.notes,
                })}
              </p>
              {prepared.mode === 'full' ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('backup.fullSummary', {
                    files: prepared.assetCount ?? 0,
                    size: ((prepared.assetBytes ?? 0) / 1024 / 1024).toFixed(1),
                    conflicts: prepared.conflicts ?? 0,
                  })}
                </p>
              ) : (
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('backup.databaseOnly')}
                </p>
              )}
              <p className="text-destructive mt-3 text-sm">
                {t('backup.replaceWarning', {
                  assets:
                    prepared.mode === 'full' ? t('backup.replaceAssets') : '',
                })}
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => void handleDiscard()}
              variant="secondary"
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleRestore()}
              variant="destructive"
            >
              <ArchiveRestore aria-hidden="true" size={16} />
              {status === 'restoring'
                ? t('backup.restoring')
                : t('backup.confirmRestore')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="backup-export-mode">
            {t('backup.mode')}
          </label>
          <select
            className="bg-background h-10 rounded-md border px-3 text-sm"
            id="backup-export-mode"
            onChange={(event) => {
              setExportMode(event.currentTarget.value as BackupMode);
            }}
            value={exportMode}
          >
            <option value="database">{t('backup.modeDatabase')}</option>
            <option value="full">{t('backup.modeFull')}</option>
          </select>
          <Button disabled={busy} onClick={() => void handleExport()}>
            <Download aria-hidden="true" size={16} />
            {status === 'exporting'
              ? t('backup.exporting')
              : t('backup.export')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void handlePrepareImport()}
            variant="secondary"
          >
            <Upload aria-hidden="true" size={16} />
            {status === 'preparing'
              ? t('backup.verifying')
              : t('backup.import')}
          </Button>
        </div>
      )}

      <p
        aria-live="polite"
        className={
          status === 'error'
            ? 'text-destructive mt-4 text-sm'
            : status === 'restored-reopen-required' ||
                status === 'restored-verification-required'
              ? 'text-destructive mt-4 text-sm'
              : 'text-muted-foreground mt-4 text-sm'
        }
        role={
          status === 'error' ||
          status === 'restored-reopen-required' ||
          status === 'restored-verification-required'
            ? 'alert'
            : 'status'
        }
      >
        {message}
      </p>
    </section>
  );
}

import { ArchiveRestore, Download, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { asAppError } from '../../../lib/app-error';
import type { PreparedBackup } from '../domain/backup';
import type { BackupMode } from '../domain/backup';
import type { BackupManager } from '../services/backup-service';

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
      setMessage(`备份已保存为 ${result.fileName}`);
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
        setMessage('备份恢复完成。重新进入书架或笔记页即可查看恢复的数据。');
      } else if (result.status === 'restored-reopen-required') {
        setMessage('数据已经恢复，但数据库连接无法重开；请重新启动应用。');
      } else {
        setMessage('数据已经恢复，但摘要复核异常；请重启应用并检查数据。');
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
      <h2 className="font-medium">数据导出与备份</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        数据库备份体积较小；完整备份额外包含 EPUB、PDF
        和封面，可用于跨设备迁移。两种备份都只保存在你选择的位置。
      </p>

      {!manager.available ? (
        <p className="text-muted-foreground mt-4 text-sm">
          数据库备份仅在 Tauri 桌面应用中可用。
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
              <h3 className="text-sm font-semibold">备份已通过恢复前验证</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                创建于 {new Date(prepared.createdAt).toLocaleString('zh-CN')} ·{' '}
                {prepared.counts.books} 本书 · {prepared.counts.readingStates}{' '}
                条阅读进度 · {prepared.counts.annotations} 条高亮/批注 ·{' '}
                {prepared.counts.notes} 条笔记
              </p>
              {prepared.mode === 'full' ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  完整备份 · {prepared.assetCount ?? 0} 个文件 ·{' '}
                  {((prepared.assetBytes ?? 0) / 1024 / 1024).toFixed(1)} MB ·{' '}
                  {prepared.conflicts ?? 0} 个现有文件冲突
                </p>
              ) : (
                <p className="text-muted-foreground mt-1 text-sm">
                  仅数据库备份，不包含 EPUB 与封面。
                </p>
              )}
              <p className="text-destructive mt-3 text-sm">
                确认恢复会替换当前本地数据库
                {prepared.mode === 'full'
                  ? '，并以备份中的 EPUB 和封面替换同路径文件'
                  : ''}
                。恢复失败时会回滚到当前数据。
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => void handleDiscard()}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => void handleRestore()}
              variant="destructive"
            >
              <ArchiveRestore aria-hidden="true" size={16} />
              {status === 'restoring' ? '正在恢复…' : '确认恢复'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="backup-export-mode">
            备份模式
          </label>
          <select
            className="bg-background h-10 rounded-md border px-3 text-sm"
            id="backup-export-mode"
            onChange={(event) => {
              setExportMode(event.currentTarget.value as BackupMode);
            }}
            value={exportMode}
          >
            <option value="database">仅数据库</option>
            <option value="full">完整备份（含 EPUB 与封面）</option>
          </select>
          <Button disabled={busy} onClick={() => void handleExport()}>
            <Download aria-hidden="true" size={16} />
            {status === 'exporting' ? '正在导出…' : '导出备份'}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void handlePrepareImport()}
            variant="secondary"
          >
            <Upload aria-hidden="true" size={16} />
            {status === 'preparing' ? '正在验证…' : '导入备份'}
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

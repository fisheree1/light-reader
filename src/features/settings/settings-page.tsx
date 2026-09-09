import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { checkDatabaseHealth } from '../../database/client';
import type { ReaderSettingsRepository } from '../../database/repositories/reader-settings-repository';
import type { ReadingActivityRepository } from '../../database/repositories/reading-activity-repository';
import { ReaderSettingsForm } from '../reader/components/reader-settings-form';
import {
  defaultReaderSettings,
  type ReaderDisplaySettings,
} from '../reader/domain/reader-settings';
import { readerServices } from '../reader/services/reader-services';
import { useReaderSettingsStore } from '../../stores/reader-settings-store';
import { BackupSettings } from '../backup/components/backup-settings';
import type { BackupManager } from '../backup/services/backup-service';
import { backupManager as defaultBackupManager } from '../backup/services/backup-services';
import type {
  ReadingHistoryEntry,
  ReadingStats,
} from '../reader/domain/reading-activity';
import { AiSettingsSection } from '../ai-agent/components/ai-settings-section';
import type { AgentFacade } from '../ai-agent/services/agent-facade';
import { agentFacade as defaultAgentFacade } from '../ai-agent/services/ai-services';

type HealthStatus = 'idle' | 'checking' | 'healthy' | 'error';
type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface SettingsPageProps {
  agentFacade?: AgentFacade;
  backupManager?: BackupManager;
  readingActivityRepository?: ReadingActivityRepository;
  settingsRepository?: ReaderSettingsRepository;
}

export function SettingsPage({
  agentFacade = defaultAgentFacade,
  backupManager = defaultBackupManager,
  readingActivityRepository,
  settingsRepository = readerServices.settingsRepository,
}: SettingsPageProps) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [readerSettings, setReaderSettings] = useState<ReaderDisplaySettings>(
    defaultReaderSettings,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [readingStats, setReadingStats] = useState<ReadingStats | null>(null);
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryEntry[]>(
    [],
  );
  const setGlobalSettings = useReaderSettingsStore(
    (state) => state.setGlobalSettings,
  );

  useEffect(() => {
    let cancelled = false;
    settingsRepository
      .getGlobal()
      .then((settings) => {
        if (cancelled) return;
        setReaderSettings(settings);
        setGlobalSettings(settings);
        setSaveStatus('idle');
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [setGlobalSettings, settingsRepository]);

  useEffect(() => {
    const repository =
      readingActivityRepository ?? readerServices.readingActivityRepository;
    if (!repository) return;
    let cancelled = false;
    void Promise.all([repository.getStats(), repository.listRecent(10)]).then(
      ([stats, history]) => {
        if (!cancelled) {
          setReadingStats(stats);
          setReadingHistory(history);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [readingActivityRepository]);

  async function handleSaveReaderSettings() {
    setSaveStatus('saving');
    try {
      const saved = await settingsRepository.saveGlobal(readerSettings);
      setReaderSettings(saved);
      setGlobalSettings(saved);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  async function handleDatabaseCheck() {
    setHealthStatus('checking');
    try {
      const isHealthy = await checkDatabaseHealth();
      setHealthStatus(isHealthy ? 'healthy' : 'error');
    } catch {
      setHealthStatus('error');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          管理阅读偏好、数据备份和本地 AI。
        </p>
      </header>

      <section className="bg-surface rounded-xl border p-5 sm:p-6">
        <h2 className="font-medium">全局阅读设置</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          新打开的 EPUB 默认使用这些主题和排版。单本图书可在阅读页覆盖。
        </p>
        <div className="mt-5 max-w-xl">
          <ReaderSettingsForm
            disabled={saveStatus === 'loading' || saveStatus === 'saving'}
            idPrefix="global-reader"
            onChange={(settings) => {
              setReaderSettings(settings);
              setSaveStatus('idle');
            }}
            value={readerSettings}
          />
          <div className="mt-5 flex items-center gap-3">
            <Button
              disabled={saveStatus === 'loading' || saveStatus === 'saving'}
              onClick={() => void handleSaveReaderSettings()}
            >
              {saveStatus === 'saving' ? '保存中…' : '保存全局设置'}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-sm">
              {saveStatus === 'loading' ? '正在加载设置…' : null}
              {saveStatus === 'saved' ? '阅读设置已保存' : null}
              {saveStatus === 'error' ? '设置加载或保存失败，请重试' : null}
            </span>
          </div>
        </div>
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
        <h2 className="font-medium">阅读统计</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">累计阅读</p>
            <p className="mt-1 text-xl font-semibold">
              {readingStats
                ? `${String(Math.floor(readingStats.totalSeconds / 3600))} 小时 ${String(
                    Math.floor((readingStats.totalSeconds % 3600) / 60),
                  )} 分钟`
                : '—'}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">阅读次数</p>
            <p className="mt-1 text-xl font-semibold">
              {readingStats?.sessionCount ?? '—'}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">读过的书</p>
            <p className="mt-1 text-xl font-semibold">
              {readingStats?.booksRead ?? '—'}
            </p>
          </div>
        </div>
        <h3 className="mt-5 text-sm font-medium">最近阅读</h3>
        {readingHistory.length ? (
          <ol className="mt-2 divide-y rounded-md border">
            {readingHistory.map((entry, index) => (
              <li
                className="flex items-center justify-between gap-4 p-3 text-sm"
                key={`${entry.bookId}-${String(entry.startedAt)}-${String(index)}`}
              >
                <span className="truncate">
                  {entry.bookTitle}
                  <span className="text-muted-foreground ml-2">
                    {entry.author ?? '未知作者'}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {new Date(entry.startedAt).toLocaleString('zh-CN')} ·{' '}
                  {String(Math.max(1, Math.round(entry.durationSeconds / 60)))}{' '}
                  分钟
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">暂无阅读记录。</p>
        )}
      </section>

      <BackupSettings manager={backupManager} />

      <AiSettingsSection facade={agentFacade} />

      {import.meta.env.DEV ? (
        <section className="bg-surface mt-4 rounded-lg border p-5">
          <h2 className="font-medium">开发诊断</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            此检查仅能在 Tauri 开发窗口中运行，Web 预览不提供原生 SQL 插件。
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={healthStatus === 'checking'}
              onClick={() => void handleDatabaseCheck()}
            >
              {healthStatus === 'checking' ? '检查中…' : '检查数据库'}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-sm">
              {healthStatus === 'healthy' ? '数据库连接正常' : null}
              {healthStatus === 'error'
                ? '数据库检查失败，请查看开发日志'
                : null}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { checkDatabaseHealth } from '../../database/client';
import type { ReaderSettingsRepository } from '../../database/repositories/reader-settings-repository';
import { ReaderSettingsForm } from '../reader/components/reader-settings-form';
import {
  defaultReaderSettings,
  type ReaderDisplaySettings,
} from '../reader/domain/reader-settings';
import { readerServices } from '../reader/services/reader-services';
import { useReaderSettingsStore } from '../../stores/reader-settings-store';

type HealthStatus = 'idle' | 'checking' | 'healthy' | 'error';
type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface SettingsPageProps {
  settingsRepository?: ReaderSettingsRepository;
}

export function SettingsPage({
  settingsRepository = readerServices.settingsRepository,
}: SettingsPageProps) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [readerSettings, setReaderSettings] = useState<ReaderDisplaySettings>(
    defaultReaderSettings,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
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
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          应用偏好与开发诊断。
        </p>
      </header>

      <section className="bg-surface rounded-lg border p-5">
        <h2 className="font-medium">应用外观</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          可通过左下角按钮切换应用界面的浅色或深色主题。
        </p>
      </section>

      <section className="bg-surface mt-4 rounded-lg border p-5">
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

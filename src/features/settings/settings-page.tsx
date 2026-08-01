import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { checkDatabaseHealth } from '../../database/client';

type HealthStatus = 'idle' | 'checking' | 'healthy' | 'error';

export function SettingsPage() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');

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
        <h2 className="font-medium">外观</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          可通过左下角按钮切换浅色或深色主题。
        </p>
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
              onClick={() => {
                void handleDatabaseCheck();
              }}
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

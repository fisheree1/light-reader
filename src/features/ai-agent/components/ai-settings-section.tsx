import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { defaultAiSettings, type AiSettings } from '../domain/ai-settings';
import type { AgentFacade } from '../services/agent-facade';

type LoadStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';
type ConnectionStatus =
  'idle' | 'checking' | 'available' | 'model-missing' | 'unavailable';

interface AiSettingsSectionProps {
  facade: AgentFacade;
}

export function AiSettingsSection({ facade }: AiSettingsSectionProps) {
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('idle');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    facade.getSettings().then(
      (value) => {
        if (!cancelled) {
          setSettings(value);
          setLoadStatus('idle');
        }
      },
      () => {
        if (!cancelled) setLoadStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [facade]);

  async function save() {
    setLoadStatus('saving');
    try {
      const saved = await facade.saveSettings(settings);
      setSettings(saved);
      setLoadStatus('saved');
    } catch {
      setLoadStatus('error');
    }
  }

  async function checkConnection() {
    setConnectionStatus('checking');
    const status = await facade.checkProvider(settings);
    setModels(status.models);
    if (!status.available) setConnectionStatus('unavailable');
    else if (!status.models.includes(settings.model)) {
      setConnectionStatus('model-missing');
    } else setConnectionStatus('available');
  }

  return (
    <section
      aria-labelledby="ai-settings-title"
      className="bg-surface mt-4 rounded-lg border p-5"
    >
      <h2 className="font-medium" id="ai-settings-title">
        本地 AI 助手
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        使用本机 Ollama 处理你逐次确认的选中文本。AI
        默认关闭，不会读取整本书或自动修改笔记。
      </p>

      <div className="mt-5 max-w-xl space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            checked={settings.enabled}
            className="accent-primary size-4"
            disabled={loadStatus === 'loading' || loadStatus === 'saving'}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setSettings((current) => ({
                ...current,
                enabled,
              }));
              setLoadStatus('idle');
            }}
            type="checkbox"
          />
          启用本地 AI 助手
        </label>

        <label className="block text-sm font-medium">
          Ollama 模型
          <input
            className="bg-background mt-2 w-full rounded-md border px-3 py-2 text-sm"
            disabled={loadStatus === 'loading' || loadStatus === 'saving'}
            list="ollama-models"
            onChange={(event) => {
              const model = event.currentTarget.value;
              setSettings((current) => ({
                ...current,
                model,
              }));
              setLoadStatus('idle');
              setConnectionStatus('idle');
            }}
            value={settings.model}
          />
          <datalist id="ollama-models">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>

        <div className="rounded-md border p-3 text-sm">
          <span className="font-medium">本机服务地址：</span>{' '}
          <code>{settings.endpoint}</code>
          <p className="text-muted-foreground mt-1 text-xs">
            为避免向外部主机泄露正文，第一版不支持修改地址或端口。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={loadStatus === 'loading' || loadStatus === 'saving'}
            onClick={() => void save()}
          >
            {loadStatus === 'saving' ? '保存中…' : '保存 AI 设置'}
          </Button>
          <Button
            disabled={connectionStatus === 'checking'}
            onClick={() => void checkConnection()}
            variant="secondary"
          >
            {connectionStatus === 'checking' ? '检测中…' : '检测 Ollama'}
          </Button>
          <span aria-live="polite" className="text-muted-foreground text-sm">
            {loadStatus === 'loading' ? '正在加载 AI 设置…' : null}
            {loadStatus === 'saved' ? 'AI 设置已保存' : null}
            {loadStatus === 'error' ? 'AI 设置加载或保存失败，请重试' : null}
            {connectionStatus === 'available' ? 'Ollama 和模型均可用' : null}
            {connectionStatus === 'model-missing'
              ? 'Ollama 已连接，但所选模型尚未安装'
              : null}
            {connectionStatus === 'unavailable'
              ? '无法连接 Ollama，请先启动本机服务'
              : null}
          </span>
        </div>
      </div>
    </section>
  );
}

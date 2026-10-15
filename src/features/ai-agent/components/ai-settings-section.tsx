import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { defaultAiSettings, type AiSettings } from '../domain/ai-settings';
import type { AgentFacade } from '../services/agent-facade';
import { useI18n } from '../../../i18n/use-i18n';

type LoadStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';
type ConnectionStatus =
  'idle' | 'checking' | 'available' | 'model-missing' | 'unavailable';

interface AiSettingsSectionProps {
  facade: AgentFacade;
}

export function AiSettingsSection({ facade }: AiSettingsSectionProps) {
  const { t } = useI18n();
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
        {t('aiSettings.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('aiSettings.description')}
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
          {t('aiSettings.enable')}
        </label>

        <label className="block text-sm font-medium">
          {t('aiSettings.model')}
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
          <span className="font-medium">{t('aiSettings.endpoint')}</span>{' '}
          <code>{settings.endpoint}</code>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('aiSettings.endpointHint')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={loadStatus === 'loading' || loadStatus === 'saving'}
            onClick={() => void save()}
          >
            {loadStatus === 'saving'
              ? t('common.saving')
              : t('aiSettings.save')}
          </Button>
          <Button
            disabled={connectionStatus === 'checking'}
            onClick={() => void checkConnection()}
            variant="secondary"
          >
            {connectionStatus === 'checking'
              ? t('aiSettings.checking')
              : t('aiSettings.check')}
          </Button>
          <span aria-live="polite" className="text-muted-foreground text-sm">
            {loadStatus === 'loading' ? t('aiSettings.loading') : null}
            {loadStatus === 'saved' ? t('aiSettings.saved') : null}
            {loadStatus === 'error' ? t('aiSettings.failed') : null}
            {connectionStatus === 'available'
              ? t('aiSettings.available')
              : null}
            {connectionStatus === 'model-missing'
              ? t('aiSettings.modelMissing')
              : null}
            {connectionStatus === 'unavailable'
              ? t('aiSettings.unavailable')
              : null}
          </span>
        </div>
      </div>
    </section>
  );
}

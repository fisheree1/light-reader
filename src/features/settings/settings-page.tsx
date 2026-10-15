import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

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
import { BackupSettings } from '../backup/components/backup-settings';
import type { BackupManager } from '../backup/services/backup-service';
import { backupManager as defaultBackupManager } from '../backup/services/backup-services';
import { AiSettingsSection } from '../ai-agent/components/ai-settings-section';
import { DictionarySettings } from '../dictionary/components/dictionary-settings';
import {
  dictionaryServices,
  type DictionaryServices,
} from '../dictionary/services/dictionary-services';
import type { AgentFacade } from '../ai-agent/services/agent-facade';
import { agentFacade as defaultAgentFacade } from '../ai-agent/services/ai-services';
import { supportedLocales, type LocalePreference } from '../../i18n/i18n';
import { useI18n } from '../../i18n/use-i18n';
import { useAppStore } from '../../stores/app-store';

type HealthStatus = 'idle' | 'checking' | 'healthy' | 'error';
type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface SettingsPageProps {
  agentFacade?: AgentFacade;
  backupManager?: BackupManager;
  dictionary?: Pick<DictionaryServices, 'dictionary' | 'picker'>;
  settingsRepository?: ReaderSettingsRepository;
}

export function SettingsPage({
  agentFacade = defaultAgentFacade,
  backupManager = defaultBackupManager,
  dictionary = dictionaryServices,
  settingsRepository = readerServices.settingsRepository,
}: SettingsPageProps) {
  const { t } = useI18n();
  const localePreference = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const { hash } = useLocation();
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

  useEffect(() => {
    // Deep links such as /settings#dictionaries scroll to their section.
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

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
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('settings.description')}
        </p>
      </header>

      <section className="bg-surface mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
        <div>
          <h2 className="font-medium" id="interface-language-title">
            {t('settings.language')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('settings.languageDescription')}
          </p>
        </div>
        <select
          aria-labelledby="interface-language-title"
          className="bg-background h-9 rounded-md border px-2 text-sm"
          onChange={(event) => {
            setLocale(event.currentTarget.value as LocalePreference);
          }}
          value={localePreference}
        >
          <option value="system">{t('settings.languageSystem')}</option>
          {supportedLocales.map((locale) => (
            <option key={locale} lang={locale} value={locale}>
              {locale === 'en' ? 'English' : '简体中文'}
            </option>
          ))}
        </select>
      </section>

      <section className="bg-surface rounded-xl border p-5 sm:p-6">
        <h2 className="font-medium">{t('settings.globalReading')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('settings.globalReadingDescription')}
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
              {saveStatus === 'saving'
                ? t('common.saving')
                : t('settings.saveGlobal')}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-sm">
              {saveStatus === 'loading' ? t('settings.loading') : null}
              {saveStatus === 'saved' ? t('settings.saved') : null}
              {saveStatus === 'error' ? t('settings.saveFailed') : null}
            </span>
          </div>
        </div>
      </section>

      <section className="bg-surface mt-4 flex items-center justify-between gap-4 rounded-lg border p-5">
        <div>
          <h2 className="font-medium">{t('settings.stats')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('settings.statsDescription')}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/stats">{t('settings.viewStats')}</Link>
        </Button>
      </section>

      <DictionarySettings
        dictionary={dictionary.dictionary}
        picker={dictionary.picker}
      />

      <BackupSettings manager={backupManager} />

      <AiSettingsSection facade={agentFacade} />

      {import.meta.env.DEV ? (
        <section className="bg-surface mt-4 rounded-lg border p-5">
          <h2 className="font-medium">{t('settings.diagnostics')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('settings.diagnosticsDescription')}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={healthStatus === 'checking'}
              onClick={() => void handleDatabaseCheck()}
            >
              {healthStatus === 'checking'
                ? t('settings.checking')
                : t('settings.checkDatabase')}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-sm">
              {healthStatus === 'healthy'
                ? t('settings.databaseHealthy')
                : null}
              {healthStatus === 'error' ? t('settings.databaseFailed') : null}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}

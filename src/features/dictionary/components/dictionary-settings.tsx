import { BookA, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { asAppError } from '../../../lib/app-error';
import type { DictionaryFilePicker } from '../../../platform/dialog/dictionary-file-picker';
import type { InstalledDictionary } from '../domain/dictionary';
import type { DictionaryService } from '../services/dictionary-service';
import { useI18n } from '../../../i18n/use-i18n';

interface DictionarySettingsProps {
  dictionary: Pick<DictionaryService, 'importDictionary' | 'list' | 'remove'>;
  picker: DictionaryFilePicker;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string };

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** Imports and removes offline StarDict dictionaries. */
export function DictionarySettings({
  dictionary,
  picker,
}: DictionarySettingsProps) {
  const { formatNumber, t } = useI18n();
  const [items, setItems] = useState<InstalledDictionary[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => {
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let cancelled = false;
    dictionary.list().then(
      (installed) => {
        if (!cancelled) setItems(installed);
      },
      (error: unknown) => {
        if (cancelled) return;
        setItems([]);
        setStatus({
          kind: 'error',
          text: asAppError(error, 'DICTIONARY_READ_FAILED').userMessage,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dictionary, reloadKey]);

  async function importFiles() {
    let files;
    try {
      files = await picker.pick();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: asAppError(error, 'FILE_READ_FAILED').userMessage,
      });
      return;
    }
    if (!files) return;
    setStatus({ kind: 'busy', label: t('dictionary.importing') });
    try {
      const installed = await dictionary.importDictionary(files);
      setStatus({
        kind: 'message',
        text: t('dictionary.imported', { name: installed.name }),
      });
      reload();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: asAppError(error, 'DICTIONARY_WRITE_FAILED').userMessage,
      });
    }
  }

  async function remove(item: InstalledDictionary) {
    setStatus({
      kind: 'busy',
      label: t('dictionary.removing', { name: item.name }),
    });
    try {
      await dictionary.remove(item);
      setStatus({
        kind: 'message',
        text: t('dictionary.removed', { name: item.name }),
      });
      reload();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: asAppError(error, 'DICTIONARY_WRITE_FAILED').userMessage,
      });
    }
  }

  return (
    <section
      aria-labelledby="dictionary-settings-title"
      className="bg-surface mt-4 rounded-lg border p-5"
      id="dictionaries"
    >
      <h2 className="font-medium" id="dictionary-settings-title">
        {t('dictionary.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('dictionary.description')}
      </p>

      {items === null ? (
        <p className="mt-4 text-sm">{t('dictionary.loading')}</p>
      ) : items.length ? (
        <ul className="mt-4 divide-y rounded-md border">
          {items.map((item) => (
            <li className="flex items-center gap-3 p-3 text-sm" key={item.id}>
              <BookA aria-hidden="true" className="shrink-0" size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="text-muted-foreground text-xs">
                  {t('dictionary.entries', {
                    count: formatNumber(item.wordCount),
                    size: formatSize(item.sizeBytes),
                  })}
                </span>
              </span>
              <IconButton
                disabled={status.kind === 'busy'}
                icon={<Trash2 aria-hidden="true" size={16} />}
                label={t('dictionary.delete', { name: item.name })}
                onClick={() => void remove(item)}
                variant="ghost"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">
          {t('dictionary.empty')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={status.kind === 'busy'}
          onClick={() => void importFiles()}
        >
          {t('dictionary.import')}
        </Button>
        <span
          aria-live="polite"
          className={
            status.kind === 'error'
              ? 'text-destructive text-sm'
              : 'text-muted-foreground text-sm'
          }
          role={status.kind === 'error' ? 'alert' : undefined}
        >
          {status.kind === 'busy' ? status.label : null}
          {status.kind === 'message' || status.kind === 'error'
            ? status.text
            : null}
        </span>
      </div>
    </section>
  );
}

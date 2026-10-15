import { BookA, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { asAppError } from '../../../lib/app-error';
import type { DictionaryFilePicker } from '../../../platform/dialog/dictionary-file-picker';
import type { InstalledDictionary } from '../domain/dictionary';
import type { DictionaryService } from '../services/dictionary-service';

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
    setStatus({ kind: 'busy', label: '正在导入词典…' });
    try {
      const installed = await dictionary.importDictionary(files);
      setStatus({ kind: 'message', text: `已导入《${installed.name}》` });
      reload();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: asAppError(error, 'DICTIONARY_WRITE_FAILED').userMessage,
      });
    }
  }

  async function remove(item: InstalledDictionary) {
    setStatus({ kind: 'busy', label: `正在删除《${item.name}》…` });
    try {
      await dictionary.remove(item);
      setStatus({ kind: 'message', text: `已删除《${item.name}》` });
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
        离线词典
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        导入 StarDict 词典后，可在阅读时选中文字查词。请一次选择同一词典的
        .ifo、.idx 和 .dict.dz 文件（.syn 可选）；词典只保存在本机。
      </p>

      {items === null ? (
        <p className="mt-4 text-sm">正在加载词典…</p>
      ) : items.length ? (
        <ul className="mt-4 divide-y rounded-md border">
          {items.map((item) => (
            <li className="flex items-center gap-3 p-3 text-sm" key={item.id}>
              <BookA aria-hidden="true" className="shrink-0" size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="text-muted-foreground text-xs">
                  {item.wordCount.toLocaleString('zh-CN')} 个词条 ·{' '}
                  {formatSize(item.sizeBytes)}
                </span>
              </span>
              <IconButton
                disabled={status.kind === 'busy'}
                icon={<Trash2 aria-hidden="true" size={16} />}
                label={`删除词典《${item.name}》`}
                onClick={() => void remove(item)}
                variant="ghost"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">尚未导入词典。</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={status.kind === 'busy'}
          onClick={() => void importFiles()}
        >
          导入 StarDict 词典
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

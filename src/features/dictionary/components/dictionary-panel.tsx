import { Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { asAppError } from '../../../lib/app-error';
import type { DictionaryEntry } from '../domain/dictionary';
import type {
  DictionaryLookupResult,
  DictionaryService,
} from '../services/dictionary-service';

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | DictionaryLookupResult;

interface DictionaryPanelProps {
  canSpeak: boolean;
  dictionary: Pick<DictionaryService, 'lookup'>;
  onClose: () => void;
  onSpeak: (text: string) => void;
  text: string;
}

function groupByDictionary(entries: DictionaryEntry[]) {
  const groups = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    groups.set(entry.dictionaryName, [
      ...(groups.get(entry.dictionaryName) ?? []),
      entry,
    ]);
  }
  return [...groups];
}

/** Offline word lookup for the current selection in the reader sidebar. */
export function DictionaryPanel({
  canSpeak,
  dictionary,
  onClose,
  onSpeak,
  text,
}: DictionaryPanelProps) {
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ status: 'loading' });
    });
    dictionary.lookup(text).then(
      (result) => {
        if (!cancelled) setState(result);
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: asAppError(error, 'DICTIONARY_READ_FAILED').userMessage,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dictionary, text]);

  return (
    <aside
      aria-label="词典"
      className="bg-surface w-80 shrink-0 overflow-auto border-l p-4"
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {state.status === 'done' ? state.word : text.trim()}
        </h2>
        {canSpeak ? (
          <IconButton
            icon={<Volume2 aria-hidden="true" size={17} />}
            label="朗读词条"
            onClick={() => {
              onSpeak(state.status === 'done' ? state.word : text);
            }}
            variant="ghost"
          />
        ) : null}
        <IconButton
          icon={<X aria-hidden="true" size={17} />}
          label="关闭词典"
          onClick={onClose}
          variant="ghost"
        />
      </div>

      <div aria-live="polite" className="mt-4 text-sm">
        {state.status === 'loading' ? <p>正在查询本地词典…</p> : null}
        {state.status === 'error' ? (
          <p className="text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.status === 'invalid-selection' ? (
          <p className="text-muted-foreground">
            请选择一个单词或短语（最多 4 个词）后再查词。
          </p>
        ) : null}
        {state.status === 'no-dictionaries' ? (
          <div className="rounded-md border p-3">
            <p className="font-medium">尚未导入词典</p>
            <p className="text-muted-foreground mt-1">
              在设置中导入 StarDict 词典后，即可离线查词。
            </p>
            <Button asChild className="mt-3" size="sm" variant="secondary">
              <Link to="/settings#dictionaries">前往设置导入</Link>
            </Button>
          </div>
        ) : null}
        {state.status === 'done' && state.entries.length === 0 ? (
          <p className="text-muted-foreground">
            已导入的词典中没有找到这个词。
          </p>
        ) : null}
      </div>

      {state.status === 'done' && state.entries.length ? (
        <div className="space-y-5">
          {groupByDictionary(state.entries).map(([name, entries]) => (
            <section aria-label={name} key={name}>
              <h3 className="text-muted-foreground text-xs font-medium">
                {name}
              </h3>
              {entries.map((entry, index) => (
                <article
                  className="mt-2"
                  key={`${entry.word}-${String(index)}`}
                >
                  {entry.word.toLocaleLowerCase() !==
                  state.word.toLocaleLowerCase() ? (
                    <p className="text-sm font-medium">{entry.word}</p>
                  ) : null}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {entry.definition}
                  </p>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

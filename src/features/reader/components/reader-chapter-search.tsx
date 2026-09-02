import { X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { ReaderSearchResult } from '../../../reader-engines/types';

interface ReaderChapterSearchProps {
  scopeLabel?: string;
  onClose: () => void;
  onSearch: (query: string) => Promise<ReaderSearchResult[]>;
  onSelect: (result: ReaderSearchResult) => void;
}

export function ReaderChapterSearch({
  scopeLabel = '章节内',
  onClose,
  onSearch,
  onSelect,
}: ReaderChapterSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReaderSearchResult[]>([]);
  const [status, setStatus] = useState('');

  async function handleSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('正在查找…');
    try {
      const nextResults = await onSearch(query);
      setResults(nextResults);
      setStatus(`找到 ${String(nextResults.length)} 处`);
    } catch {
      setStatus('查找失败');
    }
  }

  return (
    <section
      aria-label={`${scopeLabel}查找`}
      className="bg-surface absolute top-3 right-3 z-30 w-[min(28rem,calc(100%-1.5rem))] rounded-lg border p-3 shadow-lg"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{scopeLabel}查找</h2>
        <IconButton
          icon={<X aria-hidden="true" size={16} />}
          label={`关闭${scopeLabel}查找`}
          onClick={onClose}
          variant="ghost"
        />
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => void handleSearch(event)}
      >
        <label className="sr-only" htmlFor="reader-chapter-query">
          查找内容
        </label>
        <input
          autoFocus
          className="bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm"
          id="reader-chapter-query"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          required
          type="search"
          value={query}
        />
        <Button size="sm" type="submit">
          查找
        </Button>
      </form>
      <p aria-live="polite" className="text-muted-foreground mt-2 text-xs">
        {status}
      </p>
      <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
        {results.map((result) => (
          <li
            key={
              result.locator.format === 'epub'
                ? result.locator.cfi
                : `${String(result.locator.pageIndex)}:${String(result.locator.textRange?.start ?? 0)}`
            }
          >
            <button
              className="hover:bg-muted w-full rounded p-2 text-left text-sm"
              onClick={() => {
                onSelect(result);
              }}
              type="button"
            >
              <span className="text-muted-foreground">
                {result.excerpt.pre}
              </span>
              <mark>{result.excerpt.match}</mark>
              <span className="text-muted-foreground">
                {result.excerpt.post}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

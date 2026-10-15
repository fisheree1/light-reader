import { X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { ReaderSearchResult } from '../../../reader-engines/types';
import { useI18n } from '../../../i18n/use-i18n';

interface ReaderChapterSearchProps {
  /** Whether the search covers the current chapter or the whole book. */
  scope?: 'book' | 'chapter';
  onClose: () => void;
  onSearch: (query: string) => Promise<ReaderSearchResult[]>;
  onSelect: (result: ReaderSearchResult) => void;
}

export function ReaderChapterSearch({
  scope = 'chapter',
  onClose,
  onSearch,
  onSelect,
}: ReaderChapterSearchProps) {
  const { t } = useI18n();
  const title =
    scope === 'book'
      ? t('readerSearch.bookTitle')
      : t('readerSearch.chapterTitle');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReaderSearchResult[]>([]);
  const [status, setStatus] = useState('');

  async function handleSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(t('readerSearch.searching'));
    try {
      const nextResults = await onSearch(query);
      setResults(nextResults);
      setStatus(t('readerSearch.found', { count: nextResults.length }));
    } catch {
      setStatus(t('readerSearch.failed'));
    }
  }

  return (
    <section
      aria-label={title}
      className="bg-surface absolute top-3 right-3 z-30 w-[min(28rem,calc(100%-1.5rem))] rounded-lg border p-3 shadow-lg"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton
          icon={<X aria-hidden="true" size={16} />}
          label={
            scope === 'book'
              ? t('readerSearch.closeBook')
              : t('readerSearch.closeChapter')
          }
          onClick={onClose}
          variant="ghost"
        />
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => void handleSearch(event)}
      >
        <label className="sr-only" htmlFor="reader-chapter-query">
          {t('readerSearch.query')}
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
          {t('readerSearch.submit')}
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

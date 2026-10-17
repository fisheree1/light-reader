import { ChevronDown, ChevronRight, Library } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';
import { continueVolume, type SeriesGroup } from '../domain/book-series';
import type { LibraryBook } from '../domain/library';

interface SeriesSectionProps {
  group: SeriesGroup<LibraryBook>;
  onOpen: (book: LibraryBook) => void;
  renderBook: (book: LibraryBook) => ReactNode;
}

export function SeriesSection({
  group,
  onOpen,
  renderBook,
}: SeriesSectionProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const next = continueVolume(group.books);
  const opened = group.books.filter((book) => book.lastReadAt !== null).length;
  const listId = `series-${group.key}`;

  return (
    <section
      aria-label={t('library.seriesLabel', { title: group.title })}
      className="bg-surface col-span-full rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          aria-controls={listId}
          aria-expanded={expanded}
          aria-label={t(
            expanded ? 'library.seriesCollapse' : 'library.seriesExpand',
            {
              title: group.title,
            },
          )}
          className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left"
          onClick={() => {
            setExpanded((value) => !value);
          }}
          type="button"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={18} />
          ) : (
            <ChevronRight aria-hidden="true" size={18} />
          )}
          <Library
            aria-hidden="true"
            className="text-muted-foreground"
            size={18}
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{group.title}</span>
            <span className="text-muted-foreground block text-xs">
              {t('library.seriesSummary', {
                count: group.books.length,
                opened,
              })}
            </span>
          </span>
        </button>
        {next ? (
          <Button
            onClick={() => {
              onOpen(next);
            }}
            size="sm"
            variant="secondary"
          >
            {t(
              next.lastReadAt === null
                ? 'library.seriesStart'
                : 'library.seriesContinue',
              {
                title: next.title,
              },
            )}
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div
          className="mt-4 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          id={listId}
        >
          {group.books.map((book) => renderBook(book))}
        </div>
      ) : null}
    </section>
  );
}

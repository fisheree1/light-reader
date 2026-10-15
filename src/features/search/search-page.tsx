import {
  BookText,
  Library,
  Highlighter,
  NotebookPen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import type {
  AnnotationSearchResult,
  BookContentSearchResult,
  BookSearchResult,
  NoteSearchResult,
} from './domain/search';
import { useLocalSearch } from './hooks/use-local-search';
import {
  searchServices,
  type SearchServices,
} from './services/search-services';
import { useI18n } from '../../i18n/use-i18n';

interface SearchPageProps {
  services?: SearchServices;
}

interface ResultSectionProps {
  children: React.ReactNode;
  count: number;
  icon: React.ReactNode;
  title: string;
}

function ResultSection({ children, count, icon, title }: ResultSectionProps) {
  if (count === 0) return null;
  return (
    <section aria-labelledby={`search-${title}`}>
      <h2
        className="mb-3 flex items-center gap-2 text-sm font-semibold"
        id={`search-${title}`}
      >
        {icon}
        {title}
        <span className="text-muted-foreground font-normal">{count}</span>
      </h2>
      <ol className="grid gap-3">{children}</ol>
    </section>
  );
}

function ResultButton({
  description,
  meta,
  onClick,
  title,
}: {
  description: string;
  meta: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="bg-surface hover:bg-muted focus-visible:bg-muted w-full rounded-lg border p-4 text-left transition-colors"
      onClick={onClick}
      type="button"
    >
      <span className="block truncate text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground mt-1 block text-xs">{meta}</span>
      <span className="mt-2 line-clamp-2 block text-sm">{description}</span>
    </button>
  );
}

export function SearchPage({ services = searchServices }: SearchPageProps) {
  const { formatDate, t } = useI18n();
  const noteMeta = (result: NoteSearchResult) =>
    formatDate(result.updatedAt, { dateStyle: 'medium' });
  const navigate = useNavigate();
  const search = useLocalSearch(services.localSearch);
  const total = search.results
    ? search.results.books.length +
      search.results.notes.length +
      search.results.annotations.length +
      search.results.bookContent.length
    : 0;

  const openNote = (result: NoteSearchResult) => {
    void navigate(`/notes?noteId=${encodeURIComponent(result.id)}`);
  };
  const openAnnotation = (result: AnnotationSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.bookId)}`, {
      state: {
        readerNavigation: {
          annotationId: result.id,
          locator: result.locator,
        },
      },
    });
  };
  const openBookContent = (result: BookContentSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.bookId)}`, {
      state: {
        readerNavigation: {
          locator: result.locator,
        },
      },
    });
  };
  const openBook = (result: BookSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.id)}`);
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('search.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('search.description')}
        </p>
      </header>

      <form
        className="mb-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search.search();
        }}
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t('search.inputLabel')}</span>
          <Search
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
            size={17}
          />
          <input
            aria-label={t('search.inputLabel')}
            className="bg-surface h-10 w-full rounded-md border pr-3 pl-10 text-sm"
            maxLength={200}
            onChange={(event) => {
              search.setQuery(event.currentTarget.value);
            }}
            placeholder={t('search.placeholder')}
            type="search"
            value={search.query}
          />
        </label>
        <Button disabled={search.phase === 'loading'} type="submit">
          <Search aria-hidden="true" size={16} />
          {search.phase === 'loading'
            ? t('search.searching')
            : t('search.submit')}
        </Button>
        <Button
          disabled={search.isRebuilding || search.phase === 'loading'}
          onClick={() => void search.rebuild()}
          type="button"
          variant="ghost"
        >
          <RefreshCw
            aria-hidden="true"
            className={search.isRebuilding ? 'animate-spin' : undefined}
            size={16}
          />
          {search.isRebuilding
            ? t('search.rebuilding')
            : t('search.maintenance')}
        </Button>
      </form>

      {search.error ? (
        <div
          className="border-destructive/30 bg-destructive/10 text-destructive mb-5 rounded-md border px-4 py-3 text-sm"
          role="alert"
        >
          {search.error}
        </div>
      ) : null}

      {search.rebuildResult ? (
        <p
          className="bg-surface mb-5 rounded-md border px-4 py-3 text-sm"
          role="status"
        >
          {t('search.rebuilt', { count: search.rebuildResult.indexedBooks })}
          {search.rebuildResult.failedBooks > 0
            ? t('search.rebuiltFailures', {
                count: search.rebuildResult.failedBooks,
              })
            : t('search.rebuiltAll')}
        </p>
      ) : null}

      {search.results?.indexFailures ? (
        <p className="text-destructive mb-5 text-sm" role="status">
          {t('search.indexFailures', {
            count: search.results.indexFailures,
          })}
        </p>
      ) : null}

      {search.phase === 'loading' ? (
        <p
          aria-live="polite"
          className="text-muted-foreground py-16 text-center"
        >
          {t('search.loading')}
        </p>
      ) : search.phase === 'idle' ? (
        <EmptyState
          description={t('search.idleDescription')}
          icon={<Search size={28} />}
          title={t('search.inputLabel')}
        />
      ) : search.phase === 'ready' && total === 0 ? (
        <EmptyState
          description={t('search.noResultsDescription', {
            query: search.results?.query ?? '',
          })}
          icon={<Search size={28} />}
          title={t('search.noResults')}
        />
      ) : search.results ? (
        <div className="space-y-8" aria-live="polite">
          <p className="text-muted-foreground text-sm">
            {t('search.resultCount', { count: total })}
          </p>
          <ResultSection
            count={search.results.books.length}
            icon={<Library aria-hidden="true" size={16} />}
            title={t('search.books')}
          >
            {search.results.books.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.author ?? t('common.unknownAuthor')}
                  meta={result.format.toUpperCase()}
                  onClick={() => {
                    openBook(result);
                  }}
                  title={result.title}
                />
              </li>
            ))}
          </ResultSection>
          <ResultSection
            count={search.results.notes.length}
            icon={<NotebookPen aria-hidden="true" size={16} />}
            title={t('search.notes')}
          >
            {search.results.notes.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.excerpt || t('search.blankNote')}
                  meta={noteMeta(result)}
                  onClick={() => {
                    openNote(result);
                  }}
                  title={result.title}
                />
              </li>
            ))}
          </ResultSection>

          <ResultSection
            count={search.results.annotations.length}
            icon={<Highlighter aria-hidden="true" size={16} />}
            title={t('search.highlights')}
          >
            {search.results.annotations.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.text}
                  meta={`${result.bookTitle} · ${
                    result.chapterHref ?? t('annotations.unknownChapter')
                  }`}
                  onClick={() => {
                    openAnnotation(result);
                  }}
                  title={result.bookTitle}
                />
              </li>
            ))}
          </ResultSection>

          <ResultSection
            count={search.results.bookContent.length}
            icon={<BookText aria-hidden="true" size={16} />}
            title={t('search.bookText')}
          >
            {search.results.bookContent.map((result) => (
              <li key={`${result.bookId}:${JSON.stringify(result.locator)}`}>
                <ResultButton
                  description={result.excerpt}
                  meta={result.bookTitle}
                  onClick={() => {
                    openBookContent(result);
                  }}
                  title={result.sectionLabel}
                />
              </li>
            ))}
          </ResultSection>
        </div>
      ) : null}
    </div>
  );
}

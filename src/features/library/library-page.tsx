import { BookOpen, CircleAlert, Search } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { BookCard } from './components/book-card';
import { SeriesSection } from './components/series-section';
import { groupBySeries } from './domain/book-series';
import type { LibraryBook } from './domain/library';
import { ImportBookButton } from './components/import-book-button';
import { useLibrary } from './hooks/use-library';
import {
  libraryServices,
  type LibraryServices,
} from './services/library-services';
import { useI18n } from '../../i18n/use-i18n';

// Opened on demand, so it stays out of the shelf's initial load.
const BookManagementDialog = lazy(() =>
  import('./components/book-management-dialog').then((module) => ({
    default: module.BookManagementDialog,
  })),
);

interface LibraryPageProps {
  services?: LibraryServices;
}

export function LibraryPage({ services = libraryServices }: LibraryPageProps) {
  const { t } = useI18n();
  const library = useLibrary(services);
  const navigate = useNavigate();
  const [managedBookId, setManagedBookId] = useState<string | null>(null);
  const managedBook =
    library.books.find((book) => book.id === managedBookId) ?? null;
  const hasFilter = Boolean(library.query.trim()) || library.favoritesOnly;
  const showLibraryControls = library.books.length > 0 || hasFilter;
  const entries = library.groupSeries
    ? groupBySeries(library.books)
    : library.books.map((book) => ({ kind: 'book' as const, book }));
  const openBook = (book: LibraryBook) => {
    void navigate(`/reader/${encodeURIComponent(book.id)}`);
  };
  const renderBook = (book: LibraryBook) => (
    <BookCard
      key={book.id}
      book={book}
      disabled={library.mutatingBookId === book.id}
      onManage={(selectedBook) => {
        setManagedBookId(selectedBook.id);
      }}
      onOpen={openBook}
      onToggleFavorite={(selectedBook) => {
        void library.setFavorite(selectedBook.id, !selectedBook.favorite);
      }}
      services={services}
    />
  );

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('library.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t(services.storageDescription ?? 'library.storageDefault')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigate('/discover');
            }}
          >
            {t('discovery.title')}
          </Button>
          {library.isLoading || showLibraryControls ? (
            <ImportBookButton
              isImporting={library.isImporting}
              onImport={() => {
                void library.importBook();
              }}
            />
          ) : null}
        </div>
      </header>

      {showLibraryControls ? (
        <section
          aria-label={t('library.filters')}
          className="bg-surface mb-6 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('library.searchLabel')}</span>
            <Search
              aria-hidden="true"
              className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              size={16}
            />
            <input
              aria-label={t('library.searchLabel')}
              className="bg-background h-9 w-full rounded-md border pr-3 pl-9 text-sm"
              maxLength={200}
              onChange={(event) => {
                library.setQuery(event.currentTarget.value);
              }}
              placeholder={t('library.searchPlaceholder')}
              type="search"
              value={library.query}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('library.sort')}</span>
            <select
              aria-label={t('library.sortLabel')}
              className="bg-background h-9 rounded-md border px-2"
              onChange={(event) => {
                library.setSort(
                  event.currentTarget.value as typeof library.sort,
                );
              }}
              value={library.sort}
            >
              <option value="recent">{t('library.sortRecent')}</option>
              <option value="added">{t('library.sortAdded')}</option>
              <option value="title">{t('library.sortTitle')}</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 px-2 text-sm">
            <input
              checked={library.favoritesOnly}
              className="accent-primary size-4"
              onChange={(event) => {
                library.setFavoritesOnly(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            {t('library.favoritesOnly')}
          </label>
          <label className="flex h-9 items-center gap-2 px-2 text-sm">
            <input
              checked={library.groupSeries}
              className="accent-primary size-4"
              onChange={(event) => {
                library.setGroupSeries(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            {t('library.groupSeries')}
          </label>
        </section>
      ) : null}

      {library.notice ? (
        <div
          aria-live="polite"
          className={cn(
            'mb-5 rounded-md border px-4 py-3 text-sm',
            library.notice.kind === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'bg-surface text-foreground',
          )}
          role={library.notice.kind === 'error' ? 'alert' : 'status'}
        >
          {library.notice.message}
        </div>
      ) : null}

      {library.isLoading ? (
        <div
          aria-live="polite"
          className="text-muted-foreground py-16 text-center text-sm"
        >
          {t('library.loading')}
        </div>
      ) : library.loadError ? (
        <EmptyState
          action={
            <Button
              onClick={() => {
                void library.loadBooks();
              }}
              variant="secondary"
            >
              {t('library.retry')}
            </Button>
          }
          description={library.loadError}
          icon={<CircleAlert size={28} />}
          title={t('library.loadFailed')}
        />
      ) : library.books.length === 0 && hasFilter ? (
        <EmptyState
          description={t('library.noMatchesDescription')}
          icon={<Search size={28} />}
          title={t('library.noMatches')}
        />
      ) : library.books.length === 0 ? (
        <EmptyState
          action={
            <ImportBookButton
              isImporting={library.isImporting}
              onImport={() => {
                void library.importBook();
              }}
            />
          }
          description={t('library.emptyDescription')}
          icon={<BookOpen size={28} />}
          title={t('library.emptyTitle')}
        />
      ) : (
        <section
          aria-label={t('library.books')}
          className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {entries.map((entry) =>
            entry.kind === 'book' ? (
              renderBook(entry.book)
            ) : (
              <SeriesSection
                key={entry.key}
                group={entry}
                onOpen={openBook}
                renderBook={renderBook}
              />
            ),
          )}
        </section>
      )}

      {managedBook ? (
        <Suspense fallback={null}>
          <BookManagementDialog
            book={managedBook}
            busy={library.mutatingBookId === managedBook.id}
            onDelete={(mode) => library.deleteBook(managedBook.id, mode)}
            onOpenChange={(open) => {
              if (!open) setManagedBookId(null);
            }}
            onSaveDetails={(details) =>
              library.updateDetails(managedBook.id, details)
            }
            onSaveTags={(tags) => library.replaceTags(managedBook.id, tags)}
            open
          />
        </Suspense>
      ) : null}
    </div>
  );
}

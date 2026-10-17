import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Folder,
  Home,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/common/empty-state';
import { useI18n } from '../../../i18n/use-i18n';
import { bookFormatLabels } from '../../library/domain/book';
import { discoveryErrorMessage } from '../domain/discovery-error';
import {
  preferredAcquisition,
  type OpdsCatalog,
  type OpdsEntry,
  type OpdsFeed,
} from './opds';
import { useCancellableAction } from '../hooks/use-cancellable-action';
import { suggestedCatalogs, useOpdsCatalogs } from './opds-catalog-store';
import type { OpdsService } from './opds-service';

type Outcome =
  | { status: 'created' | 'duplicate'; bookId: string }
  | { status: 'failed'; message: string };

/** Runs cover downloads one after another so a page of covers stays polite. */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function OpdsCover({
  catalog,
  entry,
  queue,
  services,
}: {
  catalog: OpdsCatalog;
  entry: OpdsEntry;
  queue: ReturnType<typeof createQueue>;
  services: OpdsService;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.coverUrl) return;
    const coverUrl = entry.coverUrl;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void queue(() =>
      controller.signal.aborted
        ? Promise.resolve(null)
        : services.cover(catalog, coverUrl, controller.signal),
    )
      .then((bytes) => {
        if (!bytes || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([bytes.slice()]));
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [catalog, entry.coverUrl, queue, services]);
  return (
    <div className="bg-muted text-muted-foreground flex aspect-[2/3] w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
      {url ? (
        <img alt="" className="h-full w-full object-cover" src={url} />
      ) : (
        <BookOpen aria-hidden="true" size={20} />
      )}
    </div>
  );
}

export function OpdsPanel({ services }: { services: OpdsService }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { catalogs, add, remove } = useOpdsCatalogs();
  const [catalogId, setCatalogId] = useState<string | null>(
    catalogs[0]?.id ?? null,
  );
  const catalog = catalogs.find((item) => item.id === catalogId) ?? null;
  const [feed, setFeed] = useState<OpdsFeed | null>(null);
  // The catalog's root feed: its search link stays usable on every page.
  const [root, setRoot] = useState<OpdsFeed | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<string, Outcome>>>(
    {},
  );
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const { abort, busy, error, perform } = useCancellableAction({
    onSettled: () => {
      setDownloading(null);
    },
  });
  const [queue] = useState(createQueue);

  const show = (next: OpdsFeed, from: OpdsFeed | null) => {
    setHistory((previous) => (from ? [...previous, from.url] : []));
    setFeed(next);
  };

  const openCatalog = (target: OpdsCatalog) =>
    perform(async (signal) => {
      const opened = await services.open(target, target.url, signal);
      if (signal.aborted) return;
      setRoot(opened);
      setOutcomes({});
      show(opened, null);
    });

  useEffect(() => {
    setFeed(null);
    setRoot(null);
    setHistory([]);
    if (catalog && services.gateway.available) void openCatalog(catalog);
    // Opening is driven by the selected catalog only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog?.id]);

  const openUrl = (url: string) =>
    perform(async (signal) => {
      if (!catalog) return;
      const opened = await services.open(catalog, url, signal);
      if (!signal.aborted) show(opened, feed);
    });

  const goBack = () =>
    perform(async (signal) => {
      const previous = history.at(-1);
      if (!catalog || !previous) return;
      const opened = await services.open(catalog, previous, signal);
      if (signal.aborted) return;
      setHistory((items) => items.slice(0, -1));
      setFeed(opened);
    });

  const search = () =>
    perform(async (signal) => {
      const base = feed?.search ? feed : root;
      if (!catalog || !base) return;
      const found = await services.search(catalog, base, query, signal);
      if (!signal.aborted) show(found, feed);
    });

  const acquire = (entry: OpdsEntry) =>
    perform(async (signal) => {
      if (!catalog) return;
      setDownloading(entry.id);
      try {
        const result = await services.acquire(catalog, entry, signal);
        setOutcomes((previous) => ({
          ...previous,
          [entry.id]: { status: result.status, bookId: result.book.id },
        }));
      } catch (value) {
        if (signal.aborted) return;
        setOutcomes((previous) => ({
          ...previous,
          [entry.id]: {
            status: 'failed',
            message: discoveryErrorMessage(value),
          },
        }));
      }
    });

  const addCatalog = (title: string, url: string) => {
    const added = add(title, url);
    if (!added) {
      setAddError(t('opds.addInvalid'));
      return;
    }
    setAddError(null);
    setNewTitle('');
    setNewUrl('');
    setCatalogId(added.id);
  };

  const searchable = Boolean(feed?.search ?? root?.search);
  const suggestions = suggestedCatalogs.filter(
    (item) => !catalogs.some((existing) => existing.url === item.url),
  );

  return (
    <div className="grid gap-5">
      {!services.gateway.available ? (
        <p role="status" className="bg-muted rounded-lg p-4 text-sm">
          {t('opds.unavailable')}
        </p>
      ) : null}
      <section
        aria-label={t('opds.catalogs')}
        className="bg-surface grid gap-3 rounded-xl border p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-48 flex-1 gap-1 text-sm">
            {t('opds.catalog')}
            <select
              className="bg-background h-9 rounded-md border px-2"
              disabled={busy || !catalogs.length}
              onChange={(event) => {
                setCatalogId(event.currentTarget.value);
              }}
              value={catalogId ?? ''}
            >
              {catalogs.length ? null : (
                <option value="">{t('opds.noCatalogs')}</option>
              )}
              {catalogs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {catalog ? (
            <Button
              disabled={busy}
              onClick={() => {
                remove(catalog.id);
                setCatalogId(
                  catalogs.find((item) => item.id !== catalog.id)?.id ?? null,
                );
              }}
              variant="secondary"
            >
              <Trash2 aria-hidden="true" size={15} />
              {t('opds.remove')}
            </Button>
          ) : null}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            addCatalog(newTitle, newUrl);
          }}
        >
          <label className="grid min-w-36 gap-1 text-sm">
            {t('opds.name')}
            <input
              className="bg-background h-9 rounded-md border px-3"
              maxLength={100}
              onChange={(event) => {
                setNewTitle(event.currentTarget.value);
              }}
              placeholder={t('opds.namePlaceholder')}
              value={newTitle}
            />
          </label>
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            {t('opds.address')}
            <input
              className="bg-background h-9 rounded-md border px-3"
              inputMode="url"
              maxLength={2048}
              onChange={(event) => {
                setNewUrl(event.currentTarget.value);
              }}
              placeholder="https://example.org/opds"
              type="url"
              value={newUrl}
            />
          </label>
          <Button disabled={!newUrl.trim()} type="submit" variant="secondary">
            <Plus aria-hidden="true" size={15} />
            {t('opds.add')}
          </Button>
        </form>
        {addError ? (
          <p className="text-destructive text-xs" role="alert">
            {addError}
          </p>
        ) : null}
        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t('opds.suggested')}</span>
            {suggestions.map((item) => (
              <Button
                key={item.url}
                onClick={() => {
                  addCatalog(item.title, item.url);
                }}
                size="sm"
                variant="ghost"
              >
                <Plus aria-hidden="true" size={13} />
                {item.title}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs">{t('opds.notice')}</p>
      </section>

      {error ? (
        <p
          role="alert"
          className="text-destructive rounded-md border p-4 text-sm"
        >
          {error}
        </p>
      ) : null}

      {busy ? (
        <div
          aria-live="polite"
          role="status"
          className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
        >
          {downloading ? t('opds.downloading') : t('discovery.loading')}
          <Button
            onClick={() => {
              abort();
            }}
            variant="secondary"
          >
            {t('discovery.cancel')}
          </Button>
        </div>
      ) : null}

      {catalog && feed ? (
        <section aria-label={feed.title} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || !history.length}
              onClick={() => {
                void goBack();
              }}
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              {t('common.back')}
            </Button>
            <Button
              disabled={busy || !root}
              onClick={() => {
                if (root) {
                  setHistory([]);
                  setFeed(root);
                }
              }}
              variant="ghost"
            >
              <Home aria-hidden="true" size={16} />
              {t('opds.home')}
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
              {feed.title}
            </h2>
          </div>
          {searchable ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <input
                aria-label={t('opds.searchLabel', { catalog: catalog.title })}
                className="bg-background h-9 min-w-48 flex-1 rounded-md border px-3 text-sm"
                maxLength={200}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                placeholder={t('opds.searchPlaceholder')}
                type="search"
                value={query}
              />
              <Button disabled={busy || !query.trim()} type="submit">
                <Search aria-hidden="true" size={16} />
                {t('opds.search')}
              </Button>
            </form>
          ) : null}
          {feed.entries.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {feed.entries.map((entry) => {
                const navigation = entry.navigationUrl;
                const choice = preferredAcquisition(entry);
                const outcome = outcomes[entry.id];
                if (navigation)
                  return (
                    <li key={entry.id}>
                      <button
                        className="bg-surface hover:bg-muted flex w-full items-start gap-3 rounded-lg border p-4 text-left text-sm"
                        disabled={busy}
                        onClick={() => {
                          void openUrl(navigation);
                        }}
                        type="button"
                      >
                        <Folder
                          aria-hidden="true"
                          className="text-muted-foreground mt-0.5 shrink-0"
                          size={18}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {entry.title}
                          </span>
                          {entry.summary ? (
                            <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs">
                              {entry.summary}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                return (
                  <li
                    className="bg-surface flex gap-3 rounded-lg border p-4 text-sm"
                    key={entry.id}
                  >
                    <OpdsCover
                      catalog={catalog}
                      entry={entry}
                      queue={queue}
                      services={services}
                    />
                    <div className="grid min-w-0 flex-1 content-start gap-1">
                      <h3 className="font-medium">{entry.title}</h3>
                      <p className="text-muted-foreground text-xs">
                        {entry.authors.join('、') || t('common.unknownAuthor')}
                      </p>
                      {entry.summary ? (
                        <p className="text-muted-foreground line-clamp-3 text-xs">
                          {entry.summary}
                        </p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {choice ? (
                          <Button
                            disabled={busy || !services.gateway.available}
                            onClick={() => {
                              void acquire(entry);
                            }}
                            size="sm"
                          >
                            {t('opds.acquire', {
                              format: bookFormatLabels[choice.format],
                            })}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {t('opds.noFormat')}
                          </span>
                        )}
                        {outcome && outcome.status !== 'failed' ? (
                          <>
                            <span className="text-muted-foreground text-xs">
                              {t(`discovery.${outcome.status}`)}
                            </span>
                            <Button
                              onClick={() => {
                                void navigate(
                                  `/reader/${encodeURIComponent(outcome.bookId)}`,
                                );
                              }}
                              size="sm"
                              variant="secondary"
                            >
                              {t('discovery.read')}
                            </Button>
                          </>
                        ) : null}
                        {outcome?.status === 'failed' ? (
                          <span className="text-destructive text-xs">
                            {outcome.message}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              description={t('opds.emptyDescription')}
              icon={<Search size={28} />}
              title={t('opds.empty')}
            />
          )}
          {feed.previous || feed.next ? (
            <div className="flex justify-between gap-2">
              <Button
                disabled={busy || !feed.previous}
                onClick={() => {
                  if (feed.previous) void openUrl(feed.previous);
                }}
                variant="secondary"
              >
                <ChevronLeft aria-hidden="true" size={16} />
                {t('opds.previous')}
              </Button>
              <Button
                disabled={busy || !feed.next}
                onClick={() => {
                  if (feed.next) void openUrl(feed.next);
                }}
                variant="secondary"
              >
                {t('opds.next')}
                <ChevronRight aria-hidden="true" size={16} />
              </Button>
            </div>
          ) : null}
        </section>
      ) : !catalogs.length ? (
        <EmptyState
          description={t('opds.initialDescription')}
          icon={<Folder size={28} />}
          title={t('opds.initial')}
        />
      ) : null}
    </div>
  );
}

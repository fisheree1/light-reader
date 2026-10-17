import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/common/empty-state';
import { useI18n } from '../../../i18n/use-i18n';
import type { LibraryManagement } from '../../library/services/library-management-service';
import { ReportSummary } from '../components/report-summary';
import type { AcquisitionReport } from '../domain/acquisition-report';
import type { AcquisitionProgress } from '../domain/catalog';
import {
  discoveryErrorMessage,
  isSourceRefusal,
} from '../domain/discovery-error';
import {
  followedSeries,
  ownedVolumeIndex,
  ownedVolumes,
  volumeKey,
  type OwnedVolume,
} from '../domain/followed-series';
import { EpubValidationError } from '../domain/acquisition-report';
import type { SyosetuSearchResult, SyosetuToc } from './syosetu';
import type { SyosetuService } from './syosetu-service';

interface Outcome {
  volumeId: string;
  title: string;
  status: 'created' | 'duplicate' | 'failed';
  bookId?: string;
  message?: string;
  report?: AcquisitionReport;
}

export function SyosetuPanel({
  initialNcode,
  library,
  services,
}: {
  initialNcode?: string;
  library?: Pick<LibraryManagement, 'list'>;
  services: SyosetuService;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<{
    query: string;
    page: number;
  } | null>(null);
  const [results, setResults] = useState<SyosetuSearchResult | null>(null);
  const [toc, setToc] = useState<SyosetuToc | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [vertical, setVertical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<AcquisitionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [owned, setOwned] = useState<OwnedVolume[]>([]);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const refreshOwned = useCallback(async () => {
    if (!library) return;
    try {
      const books = await library.list({
        query: '',
        sort: 'added',
        favoritesOnly: false,
        status: 'all',
      });
      if (mounted.current)
        setOwned(
          ownedVolumes(books).filter((volume) => volume.source === 'syosetu'),
        );
    } catch {
      // Marking owned volumes is a convenience; the panel works without it.
    }
  }, [library]);
  useEffect(() => {
    void refreshOwned();
  }, [refreshOwned]);

  const ownedIndex = useMemo(() => ownedVolumeIndex(owned), [owned]);
  const followed = useMemo(() => followedSeries(owned), [owned]);

  const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setProgress(null);
    setStatus(null);
    try {
      await action(controller.signal);
    } catch (value) {
      if (!controller.signal.aborted && mounted.current)
        setError(discoveryErrorMessage(value));
    } finally {
      if (request.current === controller && mounted.current) {
        setBusy(false);
        setProgress(null);
        setStatus(null);
      }
    }
  };

  const search = (text: string, page: number) =>
    perform(async (signal) => {
      const found = await services.search(text, page, signal);
      if (signal.aborted || !mounted.current) return;
      setResults(found);
      setSearched({ query: text, page });
      setToc(null);
    });

  const openToc = (ncode: string) =>
    perform(async (signal) => {
      const loaded = await services.toc(ncode, signal, (completed, total) => {
        if (mounted.current)
          setStatus(t('syosetu.readingToc', { completed, total }));
      });
      if (signal.aborted || !mounted.current) return;
      setToc(loaded);
      setSelection(new Set());
      setOutcomes([]);
    });

  useEffect(() => {
    if (initialNcode && services.gateway.available) void openToc(initialNcode);
    // Only a new link should load; the loader changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNcode]);

  const ownedFor = (volumeId: string) =>
    toc ? ownedIndex.get(volumeKey('syosetu', toc.ncode, volumeId)) : undefined;
  const newVolumes = toc
    ? toc.volumes.filter((volume) => !ownedFor(volume.id))
    : [];

  const acquire = () =>
    perform(async (signal) => {
      if (!toc) return;
      for (const volume of toc.volumes.filter((item) =>
        selection.has(item.id),
      )) {
        if (signal.aborted) return;
        setStatus(volume.title);
        try {
          const result = await services.acquire(
            {
              toc,
              volume,
              vertical,
              onProgress: (value) => {
                if (mounted.current) setProgress(value);
              },
            },
            signal,
          );
          if (!mounted.current) return;
          setOutcomes((previous) => [
            ...previous.filter((item) => item.volumeId !== volume.id),
            {
              volumeId: volume.id,
              title: volume.title,
              status: result.status,
              bookId: result.book.id,
              report: result.report,
            },
          ]);
          setSelection((previous) => {
            const next = new Set(previous);
            next.delete(volume.id);
            return next;
          });
        } catch (value) {
          if (request.current?.signal.aborted) return;
          if (mounted.current)
            setOutcomes((previous) => [
              ...previous.filter((item) => item.volumeId !== volume.id),
              {
                volumeId: volume.id,
                title: volume.title,
                status: 'failed',
                message: discoveryErrorMessage(value),
                report:
                  value instanceof EpubValidationError
                    ? value.report
                    : undefined,
              },
            ]);
          if (isSourceRefusal(value)) {
            if (mounted.current) setError(t('discovery.stoppedAfterBlock'));
            return;
          }
        }
      }
    }).then(refreshOwned);

  return (
    <div className="grid gap-5">
      {!services.gateway.available ? (
        <p role="status" className="bg-muted rounded-lg p-4 text-sm">
          {t('syosetu.unavailable')}
        </p>
      ) : null}
      <form
        className="bg-surface flex flex-wrap items-end gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query.trim(), 1);
        }}
      >
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          {t('syosetu.query')}
          <input
            className="bg-background h-9 rounded-md border px-3"
            disabled={busy || !services.gateway.available}
            maxLength={100}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder={t('syosetu.placeholder')}
            type="search"
            value={query}
          />
        </label>
        <Button
          disabled={busy || !query.trim() || !services.gateway.available}
          type="submit"
        >
          <Search aria-hidden="true" size={16} />
          {t('syosetu.search')}
        </Button>
      </form>
      <p className="text-muted-foreground text-xs">{t('syosetu.notice')}</p>

      {error ? (
        <p
          role="alert"
          className="text-destructive rounded-md border p-4 text-sm"
        >
          {error}
        </p>
      ) : null}

      {busy ? (
        <section
          aria-live="polite"
          role="status"
          className="bg-surface rounded-lg border p-4 text-sm"
        >
          <p className="font-medium">{status ?? t('discovery.loading')}</p>
          {progress ? (
            <p className="text-muted-foreground mt-1">
              {t(`discovery.${progress.stage}`)} · {progress.completed}/
              {progress.total}
            </p>
          ) : null}
          <Button
            className="mt-3"
            disabled={progress?.stage === 'importing'}
            onClick={() => {
              request.current?.abort();
            }}
            variant="secondary"
          >
            {t('discovery.cancel')}
          </Button>
        </section>
      ) : null}

      {outcomes.length ? (
        <ul aria-label={t('discovery.outcomes')} className="grid gap-2">
          {outcomes.map((outcome) => (
            <li
              className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
              key={outcome.volumeId}
            >
              <div>
                <p className="font-medium">{outcome.title}</p>
                <p
                  className={
                    outcome.status === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {outcome.message ?? t(`discovery.${outcome.status}`)}
                </p>
                {outcome.report ? (
                  <ReportSummary report={outcome.report} />
                ) : null}
              </div>
              {outcome.bookId ? (
                <Button
                  onClick={() => {
                    void navigate(
                      `/reader/${encodeURIComponent(outcome.bookId ?? '')}`,
                    );
                  }}
                  variant="secondary"
                >
                  {t('discovery.read')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {toc ? (
        <section aria-label={t('syosetu.toc')}>
          <Button
            disabled={busy}
            onClick={() => {
              setToc(null);
              setSelection(new Set());
            }}
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {t('common.back')}
          </Button>
          <h2 className="mt-4 text-xl font-semibold">{toc.title}</h2>
          <p className="text-muted-foreground text-sm">{toc.author}</p>
          <Button
            className="mt-2"
            onClick={() => {
              void navigate(
                `/discover?${new URLSearchParams({ lookup: toc.title }).toString()}`,
              );
            }}
            size="sm"
            variant="secondary"
          >
            {t('bangumi.findTranslation')}
          </Button>
          {toc.summary ? (
            <p className="text-muted-foreground mt-2 line-clamp-4 text-sm">
              {toc.summary}
            </p>
          ) : null}
          {toc.truncated ? (
            <p className="text-destructive mt-2 text-sm">
              {t('syosetu.truncated')}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-3 text-sm">
            {t('discovery.ownedSummary', {
              owned: toc.volumes.length - newVolumes.length,
              fresh: newVolumes.length,
            })}
          </p>
          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={vertical}
                disabled={busy}
                onChange={(event) => {
                  setVertical(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              {t('syosetu.vertical')}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !newVolumes.length}
                onClick={() => {
                  setSelection(new Set(newVolumes.map((volume) => volume.id)));
                }}
                variant="secondary"
              >
                {t('discovery.selectNew', { count: newVolumes.length })}
              </Button>
              <Button
                disabled={
                  busy || !selection.size || !services.gateway.available
                }
                onClick={() => {
                  void acquire();
                }}
              >
                {t('discovery.acquire', { count: selection.size })}
              </Button>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {toc.volumes.map((volume) => {
              const ownedVolume = ownedFor(volume.id);
              return (
                <li
                  className="bg-surface rounded-lg border p-4"
                  key={volume.id}
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      checked={selection.has(volume.id)}
                      className="mt-1"
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelection((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(volume.id);
                          else next.delete(volume.id);
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    <span>
                      <span className="font-medium">{volume.title}</span>
                      <span className="text-muted-foreground mt-1 block">
                        {t('syosetu.episodes', {
                          count: volume.episodes.length,
                        })}
                      </span>
                    </span>
                  </label>
                  {ownedVolume ? (
                    <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-sm">
                      <span className="text-primary font-medium">
                        {t('discovery.onShelf')}
                      </span>
                      <Button
                        onClick={() => {
                          void navigate(
                            `/reader/${encodeURIComponent(ownedVolume.bookId)}`,
                          );
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        {t('discovery.readVolume')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : results ? (
        <section aria-label={t('discovery.results')}>
          <p className="text-muted-foreground mb-3 text-xs">
            {t('syosetu.total', { count: results.total })}
          </p>
          {results.works.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {results.works.map((work) => (
                <li
                  className="bg-surface grid gap-2 rounded-lg border p-4 text-sm"
                  key={work.ncode}
                >
                  <h2 className="font-medium">{work.title}</h2>
                  <p className="text-muted-foreground text-xs">
                    {work.author} ·{' '}
                    {work.short
                      ? t('syosetu.short')
                      : t(work.ended ? 'syosetu.ended' : 'syosetu.ongoing', {
                          count: work.episodes,
                        })}
                  </p>
                  {work.story ? (
                    <p className="text-muted-foreground line-clamp-3 text-xs">
                      {work.story}
                    </p>
                  ) : null}
                  <div>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void openToc(work.ncode);
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {t('syosetu.openToc')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              description={t('discovery.emptyDescription')}
              icon={<Search size={28} />}
              title={t('discovery.empty')}
            />
          )}
          {searched ? (
            <div className="mt-4 flex justify-between gap-2">
              <Button
                disabled={busy || searched.page <= 1}
                onClick={() => {
                  void search(searched.query, searched.page - 1);
                }}
                variant="secondary"
              >
                {t('opds.previous')}
              </Button>
              <Button
                disabled={busy || searched.page * 20 >= results.total}
                onClick={() => {
                  void search(searched.query, searched.page + 1);
                }}
                variant="secondary"
              >
                {t('opds.next')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : !busy && followed.length ? (
        <section aria-label={t('discovery.followed')}>
          <h2 className="mb-1 text-lg font-semibold">
            {t('discovery.followed')}
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            {t('syosetu.followedDescription')}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {followed.map((work) => (
              <li
                className="bg-surface flex items-center justify-between gap-3 rounded-lg border p-4 text-sm"
                key={work.novelId}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {work.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {t('syosetu.followedVolumes', { count: work.volumes })}
                  </span>
                </span>
                <Button
                  disabled={!services.gateway.available}
                  onClick={() => {
                    void openToc(work.novelId);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {t('syosetu.checkUpdates')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : !busy ? (
        <EmptyState
          description={t('syosetu.initialDescription')}
          icon={<Search size={28} />}
          title={t('syosetu.initial')}
        />
      ) : null}
    </div>
  );
}

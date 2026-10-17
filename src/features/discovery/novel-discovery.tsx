import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, Search } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/common/empty-state';
import { useI18n } from '../../i18n/use-i18n';
import type { BangumiService } from './bangumi/bangumi-service';
import { TranslationLookup } from './bangumi/translation-lookup';
import { ReportSummary } from './components/report-summary';
import {
  isSelectable,
  methodKeys,
  volumeBadges,
} from './components/volume-labels';
import {
  EpubValidationError,
  type AcquisitionReport,
} from './domain/acquisition-report';
import type {
  AcquisitionProgress,
  NovelCatalogue,
  NovelSource,
} from './domain/catalog';
import {
  discoveryErrorMessage,
  isSourceRefusal,
} from './domain/discovery-error';
import {
  followedSeries,
  ownedVolumeIndex,
  volumeKey,
} from './domain/followed-series';
import { useCancellableAction } from './hooks/use-cancellable-action';
import { useOwnedVolumes, type OwnedBooks } from './hooks/use-owned-volumes';
import {
  groupBySeries,
  type BookDiscoveryService,
  type SeriesCandidate,
  type SourceSearchFailure,
} from './services/book-discovery-service';

type SearchScope = NovelSource | 'all';

const sources: readonly NovelSource[] = ['bilinovel', 'linovelib'];

const sourceNames: Record<NovelSource, string> = {
  bilinovel: 'Bilinovel',
  linovelib: 'Linovelib',
};

interface Outcome {
  volumeId: string;
  title: string;
  status: 'created' | 'duplicate' | 'failed';
  bookId?: string;
  message?: string;
  missingImages?: number;
  report?: AcquisitionReport;
}

export function NovelDiscovery({
  bangumi,
  library,
  lookupKeyword,
  services,
  tabs,
}: {
  bangumi?: BangumiService;
  library?: OwnedBooks;
  lookupKeyword?: string;
  services: BookDiscoveryService;
  tabs: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [scope, setScope] = useState<SearchScope>('bilinovel');
  const [source, setSource] = useState<NovelSource>('bilinovel');
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [groups, setGroups] = useState<SeriesCandidate[]>([]);
  const [failures, setFailures] = useState<SourceSearchFailure[]>([]);
  const [searched, setSearched] = useState(false);
  const [catalogue, setCatalogue] = useState<NovelCatalogue | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<AcquisitionProgress | null>(null);
  const [activeVolume, setActiveVolume] = useState('');
  const { aborted, abort, busy, error, mounted, perform, setError } =
    useCancellableAction({
      onStart: () => {
        setProgress(null);
      },
      onSettled: () => {
        setProgress(null);
        setActiveVolume('');
      },
    });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [allowMissingImages, setAllowMissingImages] = useState(false);
  const { owned, refresh: refreshOwned } = useOwnedVolumes(library);
  const ownedIndex = useMemo(() => ownedVolumeIndex(owned), [owned]);
  const followed = useMemo(
    () =>
      followedSeries(owned).flatMap((work) => {
        const novelSource = sources.find((item) => item === work.source);
        return novelSource ? [{ ...work, source: novelSource }] : [];
      }),
    [owned],
  );
  const [params] = useSearchParams();

  const showResults = (
    found: SeriesCandidate[],
    failed: SourceSearchFailure[],
  ) => {
    setGroups(found);
    setFailures(failed);
    setSearched(true);
    setCatalogue(null);
    setOutcomes([]);
    setSelection(new Set());
  };
  /** Searches both sources with a work's Chinese titles from Bangumi. */
  const searchTranslations = (names: string[]) =>
    perform(async (signal) => {
      setScope('all');
      const found = await services.searchByNames(sources, names, signal);
      if (signal.aborted || !mounted.current) return;
      setSearchedQuery(names[0] ?? '');
      showResults(found.groups, found.failures);
    });
  const search = () =>
    perform(async (signal) => {
      const typed = query.trim();
      const found = await services.searchSources(
        scope === 'all' ? sources : [scope],
        typed,
        signal,
      );
      if (signal.aborted || !mounted.current) return;
      setSearchedQuery(typed);
      showResults(found.groups, found.failures);
    });
  /** Searches one failed source again and adds its results to the list. */
  const retrySource = (failed: NovelSource) =>
    perform(async (signal) => {
      const found = await services.searchSources(
        [failed],
        searchedQuery,
        signal,
      );
      if (signal.aborted || !mounted.current) return;
      showResults(
        groupBySeries([
          ...groups.flatMap((group) => group.entries),
          ...found.groups.flatMap((group) => group.entries),
        ]),
        failures.filter((item) => item.source !== failed),
      );
    });
  const loadCatalogue = (from: NovelSource, id: string) =>
    perform(async (signal) => {
      const result = await services.catalogue(from, id, signal);
      if (signal.aborted || !mounted.current) return;
      setSource(from);
      setCatalogue(result);
      setSelection(new Set());
      setOutcomes([]);
    });
  const acquire = () =>
    perform(async (signal) => {
      if (!catalogue) return;
      for (const volume of catalogue.volumes.filter((item) =>
        selection.has(item.id),
      )) {
        if (signal.aborted) return;
        setActiveVolume(volume.title);
        try {
          const result = await services.acquire(
            {
              source,
              catalogue,
              volume,
              allowMissingImages,
              onProgress: (value) => {
                if (mounted.current) setProgress(value);
              },
            },
            signal,
          );
          if (mounted.current) {
            setOutcomes((previous) => [
              ...previous.filter((item) => item.volumeId !== volume.id),
              {
                volumeId: volume.id,
                title: volume.title,
                status: result.status,
                bookId: result.book.id,
                missingImages: result.missingImages,
                report: result.report,
              },
            ]);
            setSelection((previous) => {
              const next = new Set(previous);
              next.delete(volume.id);
              return next;
            });
          }
        } catch (value) {
          if (aborted()) return;
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
          // The source refused or throttled us: do not start the next volume.
          if (isSourceRefusal(value)) {
            if (mounted.current) setError(t('discovery.stoppedAfterBlock'));
            return;
          }
        }
      }
    }).then(refreshOwned);

  // `?source=…&novel=…` (from the shelf or "我的系列") opens that work's
  // volumes directly: one catalogue request, made because the user asked.
  useEffect(() => {
    const from = sources.find((item) => item === params.get('source'));
    const novel = params.get('novel') ?? '';
    if (!from || !/^\d{1,10}$/.test(novel) || !services.gateway.available)
      return;
    setScope(from);
    void loadCatalogue(from, novel);
    // Runs again only for a new link (or StrictMode's remount, whose first
    // request was cancelled); the loader itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const ownedFor = (volumeId: string) =>
    catalogue
      ? ownedIndex.get(volumeKey(source, catalogue.id, volumeId))
      : undefined;
  const newVolumes = catalogue
    ? catalogue.volumes.filter(
        (volume) => isSelectable(volume) && !ownedFor(volume.id),
      )
    : [];
  const ownedCount = catalogue
    ? catalogue.volumes.filter((volume) => ownedFor(volume.id)).length
    : 0;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('discovery.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('discovery.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy || scope === 'all' || !services.gateway.available}
            onClick={() => {
              if (scope === 'all') return;
              void perform(async (signal) => {
                const found = await services.current(scope, signal);
                if (signal.aborted || !mounted.current) return;
                showResults(
                  groupBySeries(
                    found.map((novel) => ({ ...novel, source: scope })),
                  ),
                  [],
                );
              });
            }}
          >
            {t('discovery.readCurrent')}
          </Button>
          <Button
            variant="secondary"
            disabled={scope === 'all'}
            onClick={() => {
              if (scope === 'all') return;
              void services.gateway
                .openSource(scope)
                .catch((value: unknown) => {
                  setError(discoveryErrorMessage(value));
                });
            }}
          >
            <Globe size={16} />
            {t('discovery.openSource')}
          </Button>
        </div>
      </header>
      {tabs}
      {bangumi ? (
        <TranslationLookup
          disabled={busy || !services.gateway.available}
          initialKeyword={lookupKeyword}
          onSearch={(names) => {
            void searchTranslations(names);
          }}
          services={bangumi}
        />
      ) : null}
      {!services.gateway.available ? (
        <p role="status" className="bg-muted mb-5 rounded-lg p-4 text-sm">
          {t('discovery.unavailable')}
        </p>
      ) : null}
      <form
        className="bg-surface mb-5 flex flex-wrap items-end gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="grid gap-1 text-sm">
          {t('discovery.source')}
          <select
            className="bg-background h-9 rounded-md border px-2"
            disabled={busy}
            value={scope}
            onChange={(event) => {
              const next = event.currentTarget.value as SearchScope;
              setScope(next);
              if (next !== 'all') setSource(next);
              setError(null);
              setCatalogue(null);
              setGroups([]);
              setFailures([]);
              setSearched(false);
              setSelection(new Set());
              setOutcomes([]);
            }}
          >
            <option value="bilinovel">Bilinovel</option>
            <option value="linovelib">Linovelib</option>
            <option value="all">{t('discovery.allSources')}</option>
          </select>
        </label>
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          {t('discovery.query')}
          <input
            type="search"
            value={query}
            maxLength={100}
            disabled={busy || !services.gateway.available}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder={t('discovery.placeholder')}
            className="bg-background h-9 rounded-md border px-3"
          />
        </label>
        <Button
          type="submit"
          disabled={busy || !query.trim() || !services.gateway.available}
        >
          <Search size={16} />
          {t('discovery.search')}
        </Button>
      </form>
      <p className="text-muted-foreground mb-5 text-xs">
        {t('discovery.sourceNotice')}
      </p>
      {error ? (
        <p
          role="alert"
          className="text-destructive mb-5 rounded-md border p-4 text-sm"
        >
          {error}
        </p>
      ) : null}
      {busy ? (
        <section
          aria-live="polite"
          role="status"
          className="bg-surface mb-5 rounded-lg border p-4 text-sm"
        >
          <p className="font-medium">
            {activeVolume || t('discovery.loading')}
          </p>
          {progress ? (
            <p className="text-muted-foreground mt-1">
              {t(`discovery.${progress.stage}`)} · {progress.completed}/
              {progress.total}
            </p>
          ) : null}
          <Button
            variant="secondary"
            className="mt-3"
            disabled={progress?.stage === 'importing'}
            onClick={() => {
              abort();
            }}
          >
            {t('discovery.cancel')}
          </Button>
        </section>
      ) : null}
      {outcomes.length ? (
        <ul aria-label={t('discovery.outcomes')} className="mb-5 grid gap-2">
          {outcomes.map((outcome) => (
            <li
              key={outcome.volumeId}
              className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
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
                {outcome.missingImages ? (
                  <p>
                    {t('discovery.missingImages', {
                      count: outcome.missingImages,
                    })}
                  </p>
                ) : null}
                {outcome.report ? (
                  <ReportSummary report={outcome.report} />
                ) : null}
              </div>
              {outcome.bookId ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigate(
                      `/reader/${encodeURIComponent(outcome.bookId ?? '')}`,
                    );
                  }}
                >
                  {t('discovery.read')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {catalogue ? (
        <section aria-label={t('discovery.volumes')}>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setCatalogue(null);
              setSelection(new Set());
            }}
          >
            <ArrowLeft size={16} />
            {t('discovery.back')}
          </Button>
          <h2 className="mt-4 text-xl font-semibold">{catalogue.title}</h2>
          <p className="text-muted-foreground text-sm">{catalogue.author}</p>
          <p className="text-muted-foreground mb-4 text-sm">
            {catalogue.translators.length
              ? t('discovery.translators', {
                  names: catalogue.translators.join('、'),
                })
              : t('discovery.translatorsUnknown')}
            {' · '}
            {t('discovery.methodLabel', {
              method: t(methodKeys[catalogue.translationMethod]),
            })}
          </p>
          {ownedCount ? (
            <p className="text-muted-foreground mb-3 text-sm">
              {t('discovery.ownedSummary', {
                owned: ownedCount,
                fresh: newVolumes.length,
              })}
            </p>
          ) : null}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowMissingImages}
                disabled={busy}
                onChange={(event) => {
                  setAllowMissingImages(event.currentTarget.checked);
                }}
              />
              {t('discovery.allowMissingImages')}
            </label>
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
              disabled={busy || !selection.size || !services.gateway.available}
              onClick={() => {
                void acquire();
              }}
            >
              {t('discovery.acquire', { count: selection.size })}
            </Button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {catalogue.volumes.map((volume) => {
              const unavailable = !isSelectable(volume);
              const ownedVolume = ownedFor(volume.id);
              return (
                <li
                  key={volume.id}
                  className="bg-surface rounded-lg border p-4"
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selection.has(volume.id)}
                      disabled={busy || unavailable}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelection((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(volume.id);
                          else next.delete(volume.id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      <span className="font-medium">{volume.title}</span>
                      <span className="text-muted-foreground mt-1 block">
                        {t('discovery.chapterCount', {
                          count: volume.chapters.length,
                        })}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {volumeBadges(volume, t).map((label) => (
                          <span
                            className="bg-muted rounded px-1.5 py-0.5 text-xs"
                            key={label}
                          >
                            {label}
                          </span>
                        ))}
                      </span>
                      {volume.unavailableChapters ? (
                        <span className="text-destructive mt-1 block">
                          {t('discovery.restricted', {
                            count: volume.unavailableChapters,
                          })}
                        </span>
                      ) : null}
                      {volume.contentKind !== 'novel' ? (
                        <span className="text-muted-foreground block">
                          {t('discovery.unsupportedVolume')}
                        </span>
                      ) : null}
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
      ) : groups.length || failures.length ? (
        <section aria-label={t('discovery.results')}>
          {failures.length ? (
            <ul className="mb-3 grid gap-2">
              {failures.map((failure) => (
                <li
                  key={failure.source}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="text-destructive">
                    {t('discovery.sourceFailed', {
                      source: sourceNames[failure.source],
                      message: discoveryErrorMessage(failure.error),
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void retrySource(failure.source);
                    }}
                  >
                    {t('discovery.retrySource', {
                      source: sourceNames[failure.source],
                    })}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground mb-3 text-xs">
            {t('discovery.resultLimit')}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => {
              const multiSource =
                new Set(group.entries.map((entry) => entry.source)).size > 1;
              return (
                <li
                  key={group.key}
                  className="bg-surface rounded-lg border p-4"
                >
                  <h2 className="mb-3 font-medium">{group.title}</h2>
                  {multiSource ? (
                    <p className="text-muted-foreground mb-3 text-xs">
                      {t('discovery.sameTitleNote')}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {group.entries.map((entry) => (
                      <Button
                        key={`${entry.source}:${entry.id}`}
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          void loadCatalogue(entry.source, entry.id);
                        }}
                      >
                        {group.entries.length > 1
                          ? t('discovery.chooseVolumeFrom', {
                              source: sourceNames[entry.source],
                              title: entry.title,
                            })
                          : t('discovery.chooseVolume')}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : !busy && !searched && followed.length ? (
        <section aria-label={t('discovery.followed')}>
          <h2 className="mb-1 text-lg font-semibold">
            {t('discovery.followed')}
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            {t('discovery.followedDescription')}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {followed.map((work) => (
              <li
                className="bg-surface flex items-center justify-between gap-3 rounded-lg border p-4 text-sm"
                key={`${work.source}:${work.novelId}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {work.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {t('discovery.followedVolumes', {
                      source: sourceNames[work.source],
                      count: work.volumes,
                    })}
                  </span>
                </span>
                <Button
                  disabled={!services.gateway.available}
                  onClick={() => {
                    setScope(work.source);
                    void loadCatalogue(work.source, work.novelId);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {t('discovery.checkNew')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : !busy ? (
        <EmptyState
          icon={<Search size={28} />}
          title={t(searched ? 'discovery.empty' : 'discovery.initial')}
          description={t(
            searched
              ? 'discovery.emptyDescription'
              : 'discovery.initialDescription',
          )}
        />
      ) : null}
    </div>
  );
}

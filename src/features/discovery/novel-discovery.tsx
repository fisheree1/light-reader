import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, Search } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/common/empty-state';
import { useI18n } from '../../i18n/use-i18n';
import type { BangumiService } from './bangumi/bangumi-service';
import {
  TranslationLookup,
  type LookupRequest,
} from './bangumi/translation-lookup';
import {
  isSelectable,
  methodKeys,
  volumeBadges,
} from './components/volume-labels';
import type { NovelCatalogue, NovelSource } from './domain/catalog';
import { discoveryErrorMessage } from './domain/discovery-error';
import {
  followedSeries,
  ownedVolumeIndex,
  volumeKey,
} from './domain/followed-series';
import { useCancellableAction } from './hooks/use-cancellable-action';
import { DownloadList } from './downloads/download-list';
import { enqueueDownloads, useDownloads } from './downloads/download-queue';
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
  const [query, setQuery] = useState(lookupKeyword ?? '');
  // Each search also looks the title up on Bangumi (desktop only).
  const [lookup, setLookup] = useState<LookupRequest | null>(
    lookupKeyword ? { text: lookupKeyword, id: 0 } : null,
  );
  // A link from a なろう work fills in its title and looks it up only:
  // searching the sources with a Japanese title rarely finds anything.
  const [seenKeyword, setSeenKeyword] = useState(lookupKeyword);
  if (seenKeyword !== lookupKeyword) {
    setSeenKeyword(lookupKeyword);
    if (lookupKeyword) {
      setQuery(lookupKeyword);
      setLookup((previous) => ({
        text: lookupKeyword,
        id: (previous?.id ?? 0) + 1,
      }));
    }
  }
  const [searchedQuery, setSearchedQuery] = useState('');
  const [groups, setGroups] = useState<SeriesCandidate[]>([]);
  const [failures, setFailures] = useState<SourceSearchFailure[]>([]);
  const [searched, setSearched] = useState(false);
  const [catalogue, setCatalogue] = useState<NovelCatalogue | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const { abort, busy, error, mounted, perform, setError } =
    useCancellableAction();
  const [allowMissingImages, setAllowMissingImages] = useState(false);
  // Volumes finished downloading: owned marks refresh when this changes.
  const saved = useDownloads(
    (state) =>
      state.jobs.filter(
        (job) =>
          job.group.startsWith('novel:') &&
          (job.status === 'created' || job.status === 'duplicate'),
      ).length,
  );
  const { owned } = useOwnedVolumes(library, undefined, saved);
  const ownedIndex = useMemo(() => ownedVolumeIndex(owned), [owned]);
  /** Volumes on the shelf per source work, for hints in search results. */
  const ownedWorks = useMemo(
    () =>
      new Map(
        followedSeries(owned).map((work) => [
          `${work.source}:${work.novelId}`,
          work.volumes,
        ]),
      ),
    [owned],
  );
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
  const search = () => {
    const typed = query.trim();
    setLookup((previous) => ({ text: typed, id: (previous?.id ?? 0) + 1 }));
    return perform(async (signal) => {
      const found = await services.searchSources(
        scope === 'all' ? sources : [scope],
        typed,
        signal,
      );
      if (signal.aborted || !mounted.current) return;
      setSearchedQuery(typed);
      showResults(found.groups, found.failures);
    });
  };
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
    });
  /**
   * Queues the selected volumes. They download one at a time in the
   * background and keep going when this page is left.
   */
  const acquire = () => {
    if (!catalogue) return;
    const from = source;
    const work = catalogue;
    const missingAllowed = allowMissingImages;
    enqueueDownloads(
      work.volumes
        .filter((volume) => selection.has(volume.id))
        .map((volume) => ({
          group: `novel:${from}:${work.id}`,
          volumeId: volume.id,
          title: volume.title,
          run: (signal, onProgress) =>
            services.acquire(
              {
                source: from,
                catalogue: work,
                volume,
                allowMissingImages: missingAllowed,
                onProgress,
              },
              signal,
            ),
        })),
    );
    setSelection(new Set());
  };

  // `?source=…&novel=…` (from the shelf or "我的系列") opens that work's
  // volumes directly: one catalogue request, made because the user asked.
  useEffect(() => {
    const from = sources.find((item) => item === params.get('source'));
    const novel = params.get('novel') ?? '';
    if (!from || !/^\d{1,10}$/.test(novel) || !services.gateway.available)
      return;
    // Started after the render commits; a quick remount cancels it.
    const timer = setTimeout(() => {
      setScope(from);
      void loadCatalogue(from, novel);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
    // Runs again only for a new link; the loader changes every render.
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
      {bangumi ? (
        <TranslationLookup
          disabled={busy || !services.gateway.available}
          onSearch={(names) => {
            void searchTranslations(names);
          }}
          request={lookup}
          services={bangumi}
        />
      ) : null}
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
          <p className="font-medium">{t('discovery.loading')}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              abort();
            }}
          >
            {t('discovery.cancel')}
          </Button>
        </section>
      ) : null}
      <DownloadList prefix="novel:" />
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
                acquire();
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
                  {group.entries.some((entry) =>
                    ownedWorks.has(`${entry.source}:${entry.id}`),
                  ) ? (
                    <p className="text-primary mb-3 text-xs font-medium">
                      {t('discovery.resultOwned', {
                        count: group.entries.reduce(
                          (sum, entry) =>
                            sum +
                            (ownedWorks.get(`${entry.source}:${entry.id}`) ??
                              0),
                          0,
                        ),
                      })}
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

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/common/empty-state';
import { useI18n } from '../../i18n/use-i18n';
import type {
  AcquisitionProgress,
  NovelCatalogue,
  NovelSource,
  NovelVolume,
} from './domain/catalog';
import {
  discoveryErrorMessage,
  isSourceRefusal,
} from './domain/discovery-error';
import {
  groupBySeries,
  type BookDiscoveryService,
  type SeriesCandidate,
  type SourceSearchFailure,
} from './services/book-discovery-service';
import type { ChineseScript } from './domain/chinese-script';
import type { TranslationMethod, VolumeKind } from './domain/edition';
import type { MessageKey } from '../../i18n/i18n';
import {
  EpubValidationError,
  type AcquisitionReport,
} from './domain/acquisition-report';

type SearchScope = NovelSource | 'all';

const sources: readonly NovelSource[] = ['bilinovel', 'linovelib'];

const sourceNames: Record<NovelSource, string> = {
  bilinovel: 'Bilinovel',
  linovelib: 'Linovelib',
};

const methodKeys: Record<TranslationMethod, MessageKey> = {
  human: 'discovery.methodHuman',
  machine: 'discovery.methodMachine',
  mixed: 'discovery.methodMixed',
  unknown: 'discovery.methodUnknown',
};

const kindKeys: Partial<Record<VolumeKind, MessageKey>> = {
  main: 'discovery.kindMain',
  'side-story': 'discovery.kindSideStory',
  collection: 'discovery.kindCollection',
};

const scriptKeys: Partial<Record<ChineseScript, MessageKey>> = {
  hans: 'discovery.scriptHans',
  hant: 'discovery.scriptHant',
  mixed: 'discovery.scriptMixed',
};

/** Short labels for a volume's kind, edition and script, when known. */
function volumeBadges(
  volume: NovelVolume,
  t: (key: MessageKey) => string,
): string[] {
  const kind = kindKeys[volume.kind];
  const script = scriptKeys[volume.script];
  return [
    kind ? t(kind) : null,
    volume.edition,
    script ? t(script) : null,
  ].filter((label): label is string => label !== null);
}

interface Outcome {
  volumeId: string;
  title: string;
  status: 'created' | 'duplicate' | 'failed';
  bookId?: string;
  message?: string;
  missingImages?: number;
  report?: AcquisitionReport;
}

function ReportSummary({ report }: { report: AcquisitionReport }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { errors, warnings } = report.validation;
  return (
    <div className="text-muted-foreground mt-1 grid gap-1 text-xs">
      <p>
        {t('discovery.reportSummary', {
          built: report.builtChapters,
          expected: report.expectedChapters,
          pages: report.pagesFetched,
          embedded: report.images.embedded,
          images: report.images.total,
        })}
        {' · '}
        <span className={errors.length ? 'text-destructive' : undefined}>
          {errors.length
            ? t('discovery.reportInvalid', { count: errors.length })
            : t('discovery.reportValid')}
        </span>
        {warnings.length
          ? ` · ${t('discovery.reportWarnings', { count: warnings.length })}`
          : null}
      </p>
      {report.shortChapters.length ? (
        <p>
          {t('discovery.reportShort', {
            titles: report.shortChapters.join('、'),
          })}
        </p>
      ) : null}
      <div>
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(report, null, 2))
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setCopied(false);
              });
          }}
        >
          {copied ? t('discovery.reportCopied') : t('discovery.copyReport')}
        </Button>
      </div>
    </div>
  );
}

export function DiscoveryPage({
  services,
}: {
  services: BookDiscoveryService;
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AcquisitionProgress | null>(null);
  const [activeVolume, setActiveVolume] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [allowMissingImages, setAllowMissingImages] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await action(controller.signal);
    } catch (value) {
      if (!controller.signal.aborted && mounted.current)
        setError(discoveryErrorMessage(value));
    } finally {
      if (request.current === controller && mounted.current) {
        setBusy(false);
        setProgress(null);
        setActiveVolume('');
      }
    }
  };
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
          // The source refused or throttled us: do not start the next volume.
          if (isSourceRefusal(value)) {
            if (mounted.current) setError(t('discovery.stoppedAfterBlock'));
            return;
          }
        }
      }
    });

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
              request.current?.abort();
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
              const unavailable =
                volume.unavailableChapters > 0 ||
                !volume.chapters.length ||
                volume.contentKind !== 'novel';
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

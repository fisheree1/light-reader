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
  NovelSummary,
} from './domain/catalog';
import { discoveryErrorMessage } from './domain/discovery-error';
import type { BookDiscoveryService } from './services/book-discovery-service';

interface Outcome {
  volumeId: string;
  title: string;
  status: 'created' | 'duplicate' | 'failed';
  bookId?: string;
  message?: string;
  missingImages?: number;
}

export function DiscoveryPage({
  services,
}: {
  services: BookDiscoveryService;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [source, setSource] = useState<NovelSource>('bilinovel');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NovelSummary[]>([]);
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
  const search = () =>
    perform(async (signal) => {
      const found = await services.search(source, query, signal);
      if (signal.aborted || !mounted.current) return;
      setResults(found);
      setSearched(true);
      setCatalogue(null);
      setOutcomes([]);
      setSelection(new Set());
    });
  const loadCatalogue = (id: string) =>
    perform(async (signal) => {
      const result = await services.catalogue(source, id, signal);
      if (signal.aborted || !mounted.current) return;
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
              },
            ]);
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
            disabled={busy || !services.gateway.available}
            onClick={() => {
              void perform(async (signal) => {
                const found = await services.current(source, signal);
                if (signal.aborted || !mounted.current) return;
                setResults(found);
                setSearched(true);
                setCatalogue(null);
                setSelection(new Set());
                setOutcomes([]);
              });
            }}
          >
            {t('discovery.readCurrent')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void services.gateway
                .openSource(source)
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
            value={source}
            onChange={(event) => {
              setSource(event.currentTarget.value as NovelSource);
              setError(null);
              setCatalogue(null);
              setResults([]);
              setSearched(false);
              setSelection(new Set());
              setOutcomes([]);
            }}
          >
            <option value="bilinovel">Bilinovel</option>
            <option value="linovelib">Linovelib</option>
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
          <p className="text-muted-foreground mb-4 text-sm">
            {catalogue.author}
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
      ) : results.length ? (
        <section aria-label={t('discovery.results')}>
          <p className="text-muted-foreground mb-3 text-xs">
            {t('discovery.resultLimit')}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {results.map((result) => (
              <li key={result.id} className="bg-surface rounded-lg border p-4">
                <h2 className="mb-3 font-medium">{result.title}</h2>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void loadCatalogue(result.id);
                  }}
                >
                  {t('discovery.chooseVolume')}
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

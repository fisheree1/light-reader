import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';
import { toSimplified } from '../domain/chinese-script';
import { useCancellableAction } from '../hooks/use-cancellable-action';
import {
  searchNames,
  type BangumiCandidate,
  type TranslationInfo,
} from './bangumi';
import type { BangumiService } from './bangumi-service';

/** A submitted search: the same text submitted again looks up again. */
export interface LookupRequest {
  text: string;
  id: number;
}

/**
 * Looks up the searched title on Bangumi alongside the source search and,
 * when it is a known light novel, shows its Chinese titles and official
 * Chinese editions, with a button to search the sources with those titles.
 * Shows nothing when Bangumi is unavailable or knows no such work.
 */
export function TranslationLookup({
  disabled,
  onSearch,
  request,
  services,
}: {
  disabled: boolean;
  onSearch: (names: string[]) => void;
  request: LookupRequest | null;
  services: BangumiService;
}) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<BangumiCandidate[] | null>(null);
  const [info, setInfo] = useState<TranslationInfo | null>(null);
  const [choosing, setChoosing] = useState(false);
  const { busy, error, perform } = useCancellableAction();

  const loadDetails = (id: number) =>
    perform(async (signal) => {
      const details = await services.details(id, signal);
      if (signal.aborted) return;
      setInfo(details);
      setChoosing(false);
    });

  const lookUp = (text: string) =>
    perform(async (signal) => {
      const found = await services.search(text, signal);
      if (signal.aborted) return;
      setInfo(null);
      setChoosing(false);
      setCandidates(found);
      // The best match (series first) opens directly; others stay one click
      // away under "不是这部？".
      if (found.length) setInfo(await services.details(found[0].id, signal));
    });

  useEffect(() => {
    if (!request?.text || !services.gateway.available) return;
    // Started after the render commits; a quick remount cancels it.
    const timer = setTimeout(() => {
      void lookUp(request.text);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
    // Each submitted search looks up once; the action changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  const names = info ? searchNames(info.chineseNames, toSimplified) : [];
  if (!services.gateway.available || !request) return null;
  if (!busy && !error && !info) return null;

  return (
    <section
      aria-label={t('bangumi.title')}
      className="bg-surface mb-5 grid gap-3 rounded-xl border p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Languages aria-hidden="true" size={16} />
        {t('bangumi.title')}
      </h2>
      {busy ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('bangumi.looking')}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {choosing && candidates && candidates.length > 1 ? (
        <ul aria-label={t('bangumi.candidates')} className="grid gap-2">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                aria-pressed={info?.id === candidate.id}
                className="hover:bg-muted w-full rounded-md border p-3 text-left text-sm aria-pressed:border-[var(--primary)]"
                disabled={busy}
                onClick={() => {
                  void loadDetails(candidate.id);
                }}
                type="button"
              >
                <span className="block font-medium">
                  {candidate.nameCn ?? candidate.name}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {[
                    candidate.nameCn ? candidate.name : null,
                    candidate.author,
                    candidate.label,
                    candidate.series ? t('bangumi.series') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {info ? (
        <article
          aria-label={t('bangumi.details', { title: info.nameCn ?? info.name })}
          className="grid gap-3 rounded-lg border p-4 text-sm"
        >
          <div>
            <h3 className="font-semibold">{info.nameCn ?? info.name}</h3>
            <p className="text-muted-foreground text-xs">
              {[info.nameCn ? info.name : null, info.author, info.label]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div>
            <h4 className="mb-1 font-medium">{t('bangumi.official')}</h4>
            {info.editions.length ? (
              <ul className="grid gap-1">
                {info.editions.map((edition) => (
                  <li key={edition.label}>
                    <span className="bg-muted mr-2 rounded px-1.5 py-0.5 text-xs">
                      {edition.language}
                    </span>
                    {[
                      edition.title,
                      edition.publisher,
                      edition.producer,
                      edition.translators
                        ? t('bangumi.translators', {
                            names: edition.translators,
                          })
                        : null,
                      edition.date,
                      edition.volumes,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('bangumi.noOfficial')}</p>
            )}
            {info.editions.length ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('bangumi.buyOfficial')}
              </p>
            ) : null}
          </div>
          <div>
            <h4 className="mb-1 font-medium">{t('bangumi.names')}</h4>
            {info.chineseNames.length ? (
              <p>{info.chineseNames.join('、')}</p>
            ) : (
              <p className="text-muted-foreground">{t('bangumi.noNames')}</p>
            )}
          </div>
          {candidates && candidates.length > 1 && !choosing ? (
            <Button
              className="justify-self-start"
              disabled={busy}
              onClick={() => {
                setChoosing(true);
              }}
              size="sm"
              variant="ghost"
            >
              {t('bangumi.notThis', { count: candidates.length - 1 })}
            </Button>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {t('bangumi.attribution', { url: info.url })}
            </span>
            <Button
              disabled={disabled || busy || !names.length}
              onClick={() => {
                onSearch(names);
              }}
            >
              {t('bangumi.searchSources', { count: names.length })}
            </Button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

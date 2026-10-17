import { useEffect, useState } from 'react';
import { Languages, Search } from 'lucide-react';

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

/**
 * Finds a light novel's Chinese titles and official Chinese editions on
 * Bangumi, then hands the titles to the source search.
 */
export function TranslationLookup({
  disabled,
  initialKeyword,
  onSearch,
  services,
}: {
  disabled: boolean;
  initialKeyword?: string;
  onSearch: (names: string[]) => void;
  services: BangumiService;
}) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState(initialKeyword ?? '');
  const [candidates, setCandidates] = useState<BangumiCandidate[] | null>(null);
  const [info, setInfo] = useState<TranslationInfo | null>(null);
  const { busy, error, perform } = useCancellableAction();

  const loadDetails = (id: number) =>
    perform(async (signal) => {
      const details = await services.details(id, signal);
      if (!signal.aborted) setInfo(details);
    });

  const lookUp = (text: string) =>
    perform(async (signal) => {
      const found = await services.search(text, signal);
      if (signal.aborted) return;
      setInfo(null);
      setCandidates(found);
      // One clear match: show its titles without another click.
      if (found.length === 1)
        setInfo(await services.details(found[0].id, signal));
    });

  // A new link replaces the typed keyword during render, not in an effect.
  const [seenKeyword, setSeenKeyword] = useState(initialKeyword);
  if (seenKeyword !== initialKeyword) {
    setSeenKeyword(initialKeyword);
    if (initialKeyword) setKeyword(initialKeyword);
  }
  useEffect(() => {
    if (!initialKeyword || !services.gateway.available) return;
    // Started after the render commits; a quick remount cancels it.
    const timer = setTimeout(() => {
      void lookUp(initialKeyword);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
    // A new link should look up again; the action changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKeyword]);

  const names = info ? searchNames(info.chineseNames, toSimplified) : [];

  return (
    <section
      aria-label={t('bangumi.title')}
      className="bg-surface mb-5 grid gap-3 rounded-xl border p-4"
    >
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Languages aria-hidden="true" size={18} />
          {t('bangumi.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('bangumi.description')}
        </p>
      </div>
      {!services.gateway.available ? (
        <p className="bg-muted rounded-md p-3 text-sm" role="status">
          {t('bangumi.unavailable')}
        </p>
      ) : null}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void lookUp(keyword.trim());
        }}
      >
        <input
          aria-label={t('bangumi.keyword')}
          className="bg-background h-9 min-w-48 flex-1 rounded-md border px-3 text-sm"
          disabled={busy || !services.gateway.available}
          maxLength={100}
          onChange={(event) => {
            setKeyword(event.currentTarget.value);
          }}
          placeholder={t('bangumi.placeholder')}
          type="search"
          value={keyword}
        />
        <Button
          disabled={busy || !keyword.trim() || !services.gateway.available}
          type="submit"
          variant="secondary"
        >
          <Search aria-hidden="true" size={16} />
          {t('bangumi.lookUp')}
        </Button>
      </form>
      {busy ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('discovery.loading')}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {candidates && !candidates.length && !busy ? (
        <p className="text-muted-foreground text-sm">{t('bangumi.empty')}</p>
      ) : null}
      {candidates && candidates.length > 1 ? (
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

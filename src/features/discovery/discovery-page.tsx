import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useI18n } from '../../i18n/use-i18n';
import type { BangumiService } from './bangumi/bangumi-service';
import { DiscoveryTabs, type DiscoveryTab } from './components/discovery-tabs';
import type { OwnedBooks } from './hooks/use-owned-volumes';
import { NovelDiscovery } from './novel-discovery';
import { OpdsPanel } from './opds/opds-panel';
import type { OpdsService } from './opds/opds-service';
import type { BookDiscoveryService } from './services/book-discovery-service';
import { ncodePattern } from './syosetu/syosetu';
import { SyosetuPanel } from './syosetu/syosetu-panel';
import type { SyosetuService } from './syosetu/syosetu-service';

/**
 * Online books: light-novel sources, and OPDS catalogs when available. Each
 * tab keeps its own state while the page stays open.
 */
export function DiscoveryPage({
  bangumi,
  library,
  opds,
  services,
  syosetu,
}: {
  bangumi?: BangumiService;
  library?: OwnedBooks;
  opds?: OpdsService;
  services: BookDiscoveryService;
  syosetu?: SyosetuService;
}) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  // A shelf link to a なろう work opens that tab with its table of contents.
  const novelParam = params.get('novel') ?? '';
  const linkedNcode =
    syosetu &&
    params.get('source') === 'syosetu' &&
    ncodePattern.test(novelParam)
      ? novelParam
      : undefined;
  const [tab, setTab] = useState<DiscoveryTab>(
    linkedNcode ? 'syosetu' : 'novels',
  );
  // `?lookup=…` (from a なろう work) looks up its Chinese translations.
  const lookup = params.get('lookup')?.trim().slice(0, 100) ?? '';
  const lookupKeyword = bangumi && lookup ? lookup : undefined;
  // Switch tabs for a new link during render, not in an effect.
  const linkKey = `${linkedNcode ?? ''}|${lookupKeyword ?? ''}`;
  const [seenLink, setSeenLink] = useState(linkKey);
  if (seenLink !== linkKey) {
    setSeenLink(linkKey);
    if (linkedNcode) setTab('syosetu');
    else if (lookupKeyword) setTab('novels');
  }
  const tabs =
    opds || syosetu ? <DiscoveryTabs onChange={setTab} tab={tab} /> : null;
  return (
    <>
      <div hidden={tab !== 'novels'}>
        <NovelDiscovery
          bangumi={bangumi}
          library={library}
          lookupKeyword={lookupKeyword}
          services={services}
          tabs={tabs}
        />
      </div>
      {syosetu && tab === 'syosetu' ? (
        <div>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">{t('discovery.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('syosetu.description')}
            </p>
          </header>
          {tabs}
          <SyosetuPanel
            initialNcode={linkedNcode}
            library={library}
            services={syosetu}
          />
        </div>
      ) : null}
      {opds && tab === 'opds' ? (
        <div>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">{t('discovery.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('opds.description')}
            </p>
          </header>
          {tabs}
          <OpdsPanel services={opds} />
        </div>
      ) : null}
    </>
  );
}

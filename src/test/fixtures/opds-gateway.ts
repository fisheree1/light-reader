import {
  DiscoveryError,
  throwIfCancelled,
} from '../../features/discovery/domain/discovery-error';
import type { OpdsGateway } from '../../features/discovery/opds/opds-service';
import { createEpubFixture } from './epub-fixture';
import { fixtureImage } from './novel-gateway';

export const OPDS_FIXTURE_ROOT = 'https://opds.test/catalog';

const atom = (title: string, links: string, entries: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
<id>urn:test:${title}</id><title>${title}</title>${links}${entries}</feed>`;

const book = (id: string, title: string, author: string, links: string) =>
  `<entry><id>urn:book:${id}</id><title>${title}</title><author><name>${author}</name></author>
<summary>为测试编写的原创简介：${title}。</summary>${links}</entry>`;

export const opdsFixture = {
  root: atom(
    '测试书库',
    '<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml"/><link rel="start" type="application/atom+xml;profile=opds-catalog" href="/catalog"/>',
    `<entry><id>urn:nav:new</id><title>最新书籍</title><content type="text">最近加入的书。</content>
<link rel="subsection" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="/catalog/new"/></entry>`,
  ),
  newBooks: atom(
    '最新书籍',
    '<link rel="next" type="application/atom+xml;profile=opds-catalog" href="/catalog/new?page=2"/>',
    book(
      '1',
      '原创测试长篇',
      '测试作者',
      `<link rel="http://opds-spec.org/image/thumbnail" type="image/png" href="/covers/1.png"/>
<link rel="http://opds-spec.org/acquisition" type="application/pdf" href="/books/1.pdf"/>
<link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/books/1.epub"/>
<link rel="http://opds-spec.org/acquisition/buy" type="application/epub+zip" href="/buy/1"/>`,
    ) +
      book(
        '2',
        '只有音频的条目',
        '测试作者',
        '<link rel="http://opds-spec.org/acquisition" type="audio/mpeg" href="/books/2.mp3"/>',
      ),
  ),
  secondPage: atom(
    '最新书籍（第 2 页）',
    '<link rel="previous" type="application/atom+xml;profile=opds-catalog" href="/catalog/new"/>',
    book(
      '3',
      '第二页的书',
      '另一位作者',
      '<link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/books/3.epub"/>',
    ),
  ),
  openSearch: `<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
<Url type="text/html" template="/html-search?q={searchTerms}"/>
<Url type="application/atom+xml;profile=opds-catalog" template="/search?q={searchTerms}&amp;page={startPage?}"/>
</OpenSearchDescription>`,
};

/** Development-only OPDS gateway, injected by Playwright. Never in builds. */
export class FixtureOpdsGateway implements OpdsGateway {
  readonly available = true;

  readFeed(_catalogUrl: string, url: string, signal: AbortSignal) {
    throwIfCancelled(signal);
    const target = new URL(url);
    const query = target.searchParams.get('q');
    const text =
      target.pathname === '/catalog'
        ? opdsFixture.root
        : target.pathname === '/catalog/new'
          ? target.searchParams.get('page') === '2'
            ? opdsFixture.secondPage
            : opdsFixture.newBooks
          : target.pathname === '/opensearch.xml'
            ? opdsFixture.openSearch
            : target.pathname === '/search' && query !== null
              ? query === '无结果'
                ? `<feed xmlns="http://www.w3.org/2005/Atom"><title>搜索：${query}</title></feed>`
                : opdsFixture.newBooks.replace(
                    '<title>最新书籍</title>',
                    `<title>搜索：${query}</title>`,
                  )
              : null;
    return text === null
      ? Promise.reject(new DiscoveryError('OPDS_NOT_FOUND'))
      : Promise.resolve({ url: target.href, text });
  }

  download(
    _catalogUrl: string,
    url: string,
    kind: 'image' | 'book',
    signal: AbortSignal,
  ) {
    throwIfCancelled(signal);
    if (kind === 'image') return Promise.resolve(fixtureImage());
    const id = /\/books\/(\d+)\.epub$/.exec(new URL(url).pathname)?.[1];
    return id
      ? Promise.resolve(
          createEpubFixture({
            title: id === '1' ? '原创测试长篇' : '第二页的书',
            includeCover: false,
          }),
        )
      : Promise.reject(new DiscoveryError('OPDS_NOT_FOUND'));
  }
}

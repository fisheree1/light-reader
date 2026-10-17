import {
  OPDS_FIXTURE_ROOT,
  opdsFixture,
} from '../../../test/fixtures/opds-gateway';
import { preferredAcquisition } from './opds';
import {
  fillSearchTemplate,
  parseOpdsFeed,
  parseOpenSearch,
} from './opds-parser';

describe('OPDS feed parsing', () => {
  it('reads navigation entries, search and start links', () => {
    const feed = parseOpdsFeed(opdsFixture.root, OPDS_FIXTURE_ROOT);
    expect(feed).toMatchObject({
      title: '测试书库',
      start: 'https://opds.test/catalog',
      search: { kind: 'description', url: 'https://opds.test/opensearch.xml' },
      next: null,
    });
    expect(feed.entries).toEqual([
      expect.objectContaining({
        title: '最新书籍',
        summary: '最近加入的书。',
        navigationUrl: 'https://opds.test/catalog/new',
        acquisitions: [],
      }),
    ]);
  });

  it('keeps readable free acquisitions, prefers EPUB and resolves against the final URL', () => {
    const feed = parseOpdsFeed(
      opdsFixture.newBooks,
      'https://opds.test/catalog/new',
    );
    const [book, audio] = feed.entries;
    expect(book.acquisitions.map((item) => [item.format, item.url])).toEqual([
      ['pdf', 'https://opds.test/books/1.pdf'],
      ['epub', 'https://opds.test/books/1.epub'],
    ]);
    expect(preferredAcquisition(book)?.format).toBe('epub');
    expect(book).toMatchObject({
      authors: ['测试作者'],
      coverUrl: 'https://opds.test/covers/1.png',
      navigationUrl: null,
    });
    expect(audio.acquisitions).toEqual([]);
    expect(preferredAcquisition(audio)).toBeNull();
    expect(feed.next).toBe('https://opds.test/catalog/new?page=2');
  });

  it('ignores unsafe links and strips HTML summaries', () => {
    const feed = parseOpdsFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
      <link rel="next" href="javascript:alert(1)"/>
      <entry><title>书</title><content type="html">&lt;p&gt;第一段&lt;/p&gt;&lt;script&gt;x&lt;/script&gt;&lt;b&gt;加粗&lt;/b&gt;</content>
      <link rel="http://opds-spec.org/acquisition" type="application/epub+zip; charset=binary" href="file:///etc/passwd"/>
      <link rel="http://opds-spec.org/acquisition" type="application/epub+zip; charset=binary" href="//cdn.example.org/b.epub"/></entry>
      <entry><link href="/no-title"/></entry></feed>`,
      'https://books.example.org/opds',
    );
    expect(feed.next).toBeNull();
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.summary).toBe('第一段x加粗');
    expect(feed.entries[0]?.acquisitions).toEqual([
      {
        url: 'https://cdn.example.org/b.epub',
        type: 'application/epub+zip',
        format: 'epub',
      },
    ]);
  });

  it('rejects documents that are not OPDS 1.x feeds', () => {
    expect(() => parseOpdsFeed('{"metadata":{}}', OPDS_FIXTURE_ROOT)).toThrow(
      expect.objectContaining({ code: 'OPDS_UNSUPPORTED' }),
    );
    for (const text of ['<html><body>登录</body></html>', 'not xml <'])
      expect(() => parseOpdsFeed(text, OPDS_FIXTURE_ROOT)).toThrow(
        expect.objectContaining({ code: 'OPDS_NOT_FEED' }),
      );
  });

  it('builds search URLs from OpenSearch and inline templates', () => {
    const template = parseOpenSearch(
      opdsFixture.openSearch,
      'https://opds.test/opensearch.xml',
    );
    expect(template).toBe('https://opds.test/search?q={searchTerms}&page=');
    expect(fillSearchTemplate(template, ' 三体 & more ')).toBe(
      'https://opds.test/search?q=%E4%B8%89%E4%BD%93%20%26%20more&page=',
    );
    const inline = parseOpdsFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
      <link rel="search" type="application/atom+xml" href="search/{searchTerms}{?count}"/></feed>`,
      'https://a.example/opds/',
    );
    expect(inline.search).toEqual({
      kind: 'template',
      template: 'https://a.example/opds/search/{searchTerms}',
    });
    expect(() =>
      parseOpenSearch(
        '<OpenSearchDescription><Url type="text/html" template="/s?q={searchTerms}"/></OpenSearchDescription>',
        'https://a.example/osd.xml',
      ),
    ).toThrow(expect.objectContaining({ code: 'OPDS_NO_SEARCH' }));
  });
});

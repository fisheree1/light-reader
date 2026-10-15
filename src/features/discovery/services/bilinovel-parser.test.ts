import { novelFixture } from '../../../test/fixtures/novel-gateway';
import {
  imageUrl,
  pagePath,
  parseCatalogue,
  parseChapter,
  parseSearch,
} from './bilinovel-parser';

const url = 'https://www.bilinovel.com/novel/1/101.html';

describe('Bilinovel source parsing', () => {
  it('deduplicates search results and handles exact-match redirects', () => {
    expect(
      parseSearch('bilinovel', {
        url: 'https://www.bilinovel.com/search.html',
        html: novelFixture.search,
      }),
    ).toHaveLength(1);
    expect(
      parseSearch('bilinovel', {
        url: 'https://www.bilinovel.com/novel/1.html',
        html: '<h1>测试小说</h1>',
      })[0].id,
    ).toBe('1');
  });
  it('accepts the current source search endpoint and rejects home and foreign snapshots', () => {
    expect(
      parseSearch('linovelib', {
        url: 'https://www.linovelib.com/S6/',
        html: novelFixture.search,
      }),
    ).toHaveLength(1);
    for (const snapshotUrl of [
      'https://www.linovelib.com/',
      'https://other.test/novel/1.html',
      'https://www.linovelib.com/S6/evil',
    ]) {
      expect(() =>
        parseSearch('linovelib', {
          url: snapshotUrl,
          html: novelFixture.search,
        }),
      ).toThrow();
    }
  });
  it('keeps restricted chapters and art books distinct from complete novel volumes', () => {
    const result = parseCatalogue(
      'bilinovel',
      { url, html: novelFixture.catalogue },
      '1',
    );
    expect(result.author).toBe('测试作者');
    expect(
      result.volumes.map((volume) => [
        volume.id,
        volume.chapters.length,
        volume.unavailableChapters,
        volume.contentKind,
      ]),
    ).toEqual([
      ['10', 2, 0, 'novel'],
      ['20', 0, 1, 'novel'],
      ['30', 1, 0, 'other'],
    ]);
  });
  it('reads desktop volume lists with a cover before the heading and a separate author field', () => {
    const result = parseCatalogue(
      'linovelib',
      {
        url: 'https://www.linovelib.com/novel/1/catalog',
        html: novelFixture.catalogueDesktop,
      },
      '1',
    );
    expect(result.author).toBe('测试作者');
    expect(result.volumes[0]).toMatchObject({
      id: '10',
      title: '测试轻小说 第一卷',
      coverUrl: 'https://img3.readpai.com/cover/1/cover.png',
      unavailableChapters: 0,
    });
    expect(result.volumes[0].chapters).toHaveLength(2);
    expect(result.volumes[1].unavailableChapters).toBe(1);
    expect(result.volumes[2].contentKind).toBe('other');
  });
  it('distinguishes desktop next-chapter links from same-chapter pagination', () => {
    const snapshot = {
      url: 'https://www.linovelib.com/novel/1/101.html',
      html: '<h1>测试章节</h1><div id="TextContent"><p>原创正文</p></div><div class="mlfy_page"><a href="/novel/1/102.html">下一页</a></div>',
    };
    expect(
      parseChapter('linovelib', snapshot, '/novel/1/101.html'),
    ).toMatchObject({
      title: '测试章节',
      nextPath: null,
    });
    expect(
      parseChapter(
        'linovelib',
        {
          ...snapshot,
          html: snapshot.html.replace('1/102.html', '1/101_2.html'),
        },
        '/novel/1/101.html',
      ).nextPath,
    ).toBe('/novel/1/101_2.html');
    expect(() =>
      parseChapter(
        'linovelib',
        {
          ...snapshot,
          html: snapshot.html.replace(
            '/novel/1/102.html',
            'javascript:blocked()',
          ),
        },
        '/novel/1/101.html',
      ),
    ).toThrow();
  });
  it('sanitizes chapter content while preserving ruby and safe images', () => {
    const result = parseChapter(
      'bilinovel',
      { url, html: `${novelFixture.first}<iframe src="https://evil.test"/>` },
      '/novel/1/101.html',
    );
    expect(result.html).toContain('自动测试');
    expect(result.html).not.toMatch(/script|alert|隐藏|iframe/);
    expect(result.nextPath).toBe('/novel/1/101_2.html');
    const art = parseChapter(
      'bilinovel',
      { url: url.replace('101', '102'), html: novelFixture.illustration },
      '/novel/1/102.html',
    );
    expect(art.html).toContain('<ruby>测试<rt>test</rt></ruby>');
    expect(art.images).toEqual(['https://img3.readpai.com/pic/1/art.png']);
  });
  it('rejects missing content, unsafe origins and unexpected chapter identities', () => {
    expect(() =>
      pagePath('bilinovel', 'https://www.bilinovel.com.evil.test/novel/1.html'),
    ).toThrow();
    expect(() =>
      imageUrl('bilinovel', 'http://127.0.0.1/a.png', url),
    ).toThrow();
    expect(() =>
      parseChapter(
        'bilinovel',
        { url, html: '<div id="acontent">x</div>' },
        '/novel/2/101.html',
      ),
    ).toThrow();
    expect(() =>
      parseChapter(
        'bilinovel',
        { url, html: '<h1>Access denied</h1>' },
        '/novel/1/101.html',
      ),
    ).toThrow();
  });
  it('rejects a repeated page or a next-page link pointing backwards', () => {
    expect(() =>
      parseChapter(
        'bilinovel',
        { url, html: novelFixture.first },
        '/novel/1/101_2.html',
      ),
    ).toThrow();
    expect(() =>
      parseChapter(
        'bilinovel',
        {
          url: url.replace('101.html', '101_2.html'),
          html: '<div id="acontent"><p>测试正文</p></div><div id="footlink"><a href="/novel/1/101.html">下一页</a></div>',
        },
        '/novel/1/101_2.html',
      ),
    ).toThrow();
  });
  it('uses exported pagination metadata for listener-bound links and rejects missing page targets', () => {
    const html =
      '<div id="acontent"><p>测试正文</p></div><div id="footlink"><a class="nextlink">下一頁</a></div>';
    expect(() =>
      parseChapter('bilinovel', { url, html }, '/novel/1/101.html'),
    ).toThrow();
    expect(
      parseChapter(
        'bilinovel',
        {
          url,
          html: `<meta name="lightreader-next" content="/novel/1/101_2.html">${html}`,
        },
        '/novel/1/101.html',
      ).nextPath,
    ).toBe('/novel/1/101_2.html');
  });
});

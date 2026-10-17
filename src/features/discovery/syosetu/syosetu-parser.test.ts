import { syosetuFixture } from '../../../test/fixtures/syosetu-gateway';
import {
  groupVolumes,
  parseEpisode,
  parseSearch,
  parseTocPage,
  type TocItem,
} from './syosetu-parser';

describe('なろう parsing', () => {
  it('reads API search results and drops malformed works', () => {
    expect(parseSearch(syosetuFixture.search)).toEqual({
      total: 2,
      works: [
        {
          ncode: 'n0001aa',
          title: 'テスト用の長編',
          author: 'テスト作者',
          story: 'テストのために書いた、短いあらすじです。',
          episodes: 4,
          short: false,
          ended: false,
          updatedAt: '2026-10-01 00:00:00',
        },
      ],
    });
    for (const text of ['<html>', '[]', '[{"x":1}]'])
      expect(() => parseSearch(text)).toThrow(
        expect.objectContaining({ code: 'SOURCE_INVALID' }),
      );
  });

  it('reads table-of-contents pages, keeping only episodes of this work', () => {
    const first = parseTocPage(syosetuFixture.tocPage(1), 'n0001aa');
    expect(first).toMatchObject({
      title: 'テスト用の長編',
      author: 'テスト作者',
      summary: 'テストのために書いた、短いあらすじです。',
      short: false,
      lastPage: 2,
    });
    const second = parseTocPage(syosetuFixture.tocPage(2), 'n0001aa');
    expect(second.items).toEqual([
      { kind: 'episode', number: 3, title: '一部の終わり' },
      { kind: 'section', title: '第二部 つづき' },
      { kind: 'episode', number: 4, title: '新章' },
    ]);
    // A section continues across table-of-contents pages.
    expect(
      groupVolumes([...first.items, ...second.items], first.title).map(
        (volume) => [volume.id, volume.title, volume.episodes.length],
      ),
    ).toEqual([
      ['1', '第一部 はじまり', 3],
      ['4', '第二部 つづき', 1],
    ]);
    expect(() => parseTocPage('<html></html>', 'n0001aa')).toThrow();
  });

  it('splits long sections and works without sections every 100 episodes', () => {
    const episodes = (from: number, count: number): TocItem[] =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'episode' as const,
        number: from + index,
        title: `話${String(from + index)}`,
      }));
    expect(
      groupVolumes(
        [
          ...episodes(1, 150),
          { kind: 'section', title: '第二部' },
          ...episodes(151, 120),
        ],
        '作品',
      ).map((volume) => [volume.id, volume.title, volume.episodes.length]),
    ).toEqual([
      ['1', '第1–100話', 100],
      ['101', '第101–150話', 50],
      ['151', '第二部（第151–250話）', 100],
      ['251', '第二部（第251–270話）', 20],
    ]);
  });

  it('names a short work without sections after the work', () => {
    expect(
      groupVolumes(
        [
          { kind: 'episode', number: 1, title: '一' },
          { kind: 'episode', number: 2, title: '二' },
        ],
        '短い連載',
      ),
    ).toEqual([
      {
        id: '1',
        title: '短い連載',
        episodes: [
          { number: 1, title: '一' },
          { number: 2, title: '二' },
        ],
      },
    ]);
  });

  it('reads a short story from its work page', () => {
    const page = parseTocPage(
      '<h1 class="p-novel__title">短編</h1><div class="p-novel__body"><div class="js-novel-text p-novel__text"><p>本文</p></div></div>',
      'n0002bb',
    );
    expect(page).toMatchObject({ short: true, items: [{ number: 0 }] });
    expect(groupVolumes(page.items, '短編')).toEqual([
      { id: '0', title: '短編', episodes: [{ number: 0, title: '短編' }] },
    ]);
    expect(
      parseEpisode(
        '<h1 class="p-novel__title">短編</h1><div class="p-novel__body"><div class="js-novel-text p-novel__text"><p>本文</p></div></div>',
        'n0002bb',
        0,
      ).html,
    ).toBe('<p>本文</p>');
  });

  it('keeps ruby, blank lines, author notes and みてみん illustrations, dropping scripts', () => {
    const episode = parseEpisode(syosetuFixture.episodePage(1), 'n0001aa', 1);
    expect(episode.title).toBe('テスト第1話');
    expect(episode.html).toBe(
      '<div class="preface"><p>前書きです。</p></div>' +
        '<p>　<ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby>のテスト本文、第1話。</p>' +
        '<p class="blank"><br /></p>' +
        '<p>　［挿絵］続き。</p>' +
        '<p><img src="image:0" alt="挿絵" /></p>' +
        '<div class="afterword"><p>後書きです。</p></div>',
    );
    // Only the みてみん address shape becomes a downloadable illustration.
    expect(episode.images).toEqual([
      'https://47160.mitemin.net/userpageimage/viewimagebig/icode/i901/',
    ]);
    expect(() =>
      parseEpisode(syosetuFixture.episodePage(2), 'n0001aa', 3),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_INVALID' }));
    expect(() => parseEpisode('<html></html>', 'n0001aa', 1)).toThrow();
  });
});

import { bangumiFixture } from '../../../test/fixtures/bangumi-gateway';
import { toSimplified } from '../domain/chinese-script';
import {
  parseBangumiSearch,
  parseBangumiSubject,
  searchNames,
} from './bangumi';

describe('Bangumi parsing', () => {
  it('keeps light-novel series, dropping their volumes, comics and adult entries', () => {
    const found = parseBangumiSearch(JSON.stringify(bangumiFixture.search));
    expect(found.map((item) => item.id)).toEqual([1001, 1005]);
    expect(found[0]).toEqual({
      id: 1001,
      name: 'テストのライトノベル！',
      nameCn: '测试轻小说',
      series: true,
      author: 'テスト作者',
      label: 'テスト文庫',
      date: '2020-01-01',
    });
    // Without its series entry, a volume is still offered.
    expect(
      parseBangumiSearch(
        JSON.stringify({ data: bangumiFixture.search.data.slice(1) }),
      ).map((item) => item.id),
    ).toEqual([1005, 1002]);
    for (const text of ['<html>', '{"data":"x"}'])
      expect(() => parseBangumiSearch(text)).toThrow(
        expect.objectContaining({ code: 'SOURCE_INVALID' }),
      );
  });

  it('reads official Chinese editions and Chinese titles, edition titles first', () => {
    const info = parseBangumiSubject(JSON.stringify(bangumiFixture.series));
    expect(info).toMatchObject({
      id: 1001,
      name: 'テストのライトノベル！',
      nameCn: '测试轻小说',
      author: 'テスト作者',
      label: 'テスト文庫',
      url: 'https://bgm.tv/subject/1001',
      // Kana-only aliases are not Chinese titles.
      chineseNames: ['測試輕小說', '测试轻小说', '另一个译名'],
    });
    expect(info.editions).toEqual([
      {
        label: '测试出版社版',
        title: '測試輕小說',
        language: '繁体中文',
        publisher: '测试出版社',
        producer: null,
        translators: '测试译者',
        date: '2021-01-01',
        volumes: null,
      },
      {
        label: '另一版',
        title: '另一个译名',
        language: '简体中文',
        publisher: '测试出版社二',
        producer: '测试出品方',
        translators: null,
        date: null,
        volumes: null,
      },
    ]);
    expect(() =>
      parseBangumiSubject(
        JSON.stringify({ ...bangumiFixture.series, nsfw: true }),
      ),
    ).toThrow();
  });

  it('collapses titles differing only in script into simplified searches', () => {
    expect(
      searchNames(
        ['測試輕小說', '测试轻小说', '另一个译名', '第四', '第五'],
        toSimplified,
      ),
    ).toEqual(['测试轻小说', '另一个译名', '第四']);
  });
});

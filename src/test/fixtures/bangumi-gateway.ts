import {
  DiscoveryError,
  throwIfCancelled,
} from '../../features/discovery/domain/discovery-error';
import type { BangumiGateway } from '../../features/discovery/bangumi/bangumi-service';

/** Original data in the shape of the Bangumi API; not copied from it. */
const series = {
  id: 1001,
  name: 'テストのライトノベル！',
  name_cn: '测试轻小说',
  platform: '小说',
  series: true,
  nsfw: false,
  date: '2020-01-01',
  infobox: [
    { key: '中文名', value: '测试轻小说' },
    { key: '作者', value: 'テスト作者' },
    { key: '文库', value: 'テスト文庫' },
    { key: '别名', value: [{ v: 'テストラノベ' }, { v: '测试轻小说' }] },
    {
      key: '版本:测试出版社版',
      value: [
        { k: '版本名', v: '測試輕小說' },
        { k: '别名', v: '测试轻小说' },
        { k: '语言', v: '繁体中文' },
        { k: '出版社', v: '测试出版社' },
        { k: '译者', v: '测试译者' },
        { k: '发售日', v: '2021-01-01' },
      ],
    },
    {
      key: '版本:另一版',
      value: [
        { k: '版本名', v: '另一个译名' },
        { k: '语言', v: '简体中文' },
        { k: '出品方', v: '测试出品方' },
        { k: '出版社', v: '测试出版社二' },
      ],
    },
  ],
};

export const bangumiFixture = {
  series,
  search: {
    total: 4,
    data: [
      { ...series, infobox: series.infobox.slice(0, 3) },
      {
        ...series,
        id: 1002,
        name: 'テストのライトノベル! (2)',
        name_cn: '',
        series: false,
      },
      {
        ...series,
        id: 1003,
        name: 'テストのライトノベル@comic',
        platform: '漫画',
      },
      { ...series, id: 1004, name: '成人向けテスト', nsfw: true },
      {
        ...series,
        id: 1005,
        name: '別のテスト作品',
        name_cn: '另一部测试作品',
        infobox: [],
      },
    ],
  },
};

/** Development-only Bangumi gateway, injected by Playwright. */
export class FixtureBangumiGateway implements BangumiGateway {
  readonly available = true;

  search(keyword: string, signal: AbortSignal) {
    throwIfCancelled(signal);
    return Promise.resolve(
      JSON.stringify(
        keyword === '无结果' ? { total: 0, data: [] } : bangumiFixture.search,
      ),
    );
  }

  subject(id: number, signal: AbortSignal) {
    throwIfCancelled(signal);
    if (id === 1001) return Promise.resolve(JSON.stringify(series));
    if (id === 1005)
      return Promise.resolve(
        JSON.stringify({
          ...series,
          id: 1005,
          name: '別のテスト作品',
          name_cn: '另一部测试作品',
          infobox: [],
        }),
      );
    return Promise.reject(new DiscoveryError('OPDS_NOT_FOUND'));
  }
}

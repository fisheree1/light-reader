import {
  continueVolume,
  groupBySeries,
  parseSeriesIndex,
  seriesKey,
  seriesTitleFromVolume,
  type BookSeries,
} from './book-series';
import type { BookOrigin } from './book-origin';

const origin = (novelId: string, volumeId: string): BookOrigin => ({
  source: 'bilinovel',
  novelId,
  volumeId,
  url: `https://www.bilinovel.com/novel/${novelId}/vol_${volumeId}.html`,
  revision: 'a'.repeat(64),
  translators: [],
});

function book(
  id: string,
  title: string,
  metadata: { series?: BookSeries | null; origin?: BookOrigin } = {},
) {
  return { id, title, metadata };
}

const shape = (entries: ReturnType<typeof groupBySeries>) =>
  entries.map((entry) =>
    entry.kind === 'book'
      ? entry.book.id
      : [entry.title, entry.books.map((item) => item.id)],
  );

describe('series grouping', () => {
  it('groups at the first member, orders volumes and keeps lone books plain', () => {
    expect(
      shape(
        groupBySeries([
          book('c', '系列 第十卷', { series: { title: '系列', index: 10 } }),
          book('solo', '独立作品'),
          book('a', '系列 第二卷', { series: { title: '系列', index: 2 } }),
          book('b', '系列 外传', {
            series: { title: '《系列》', index: null },
          }),
          book('d', '系列 第2.5卷', {
            series: { title: 'ｓ系列', index: 2.5 },
          }),
          book('lone', '只有一卷', { series: { title: '另一系列', index: 1 } }),
        ]),
      ),
    ).toEqual([['系列', ['a', 'c', 'b']], 'solo', 'd', 'lone']);
  });

  it('joins older fetched volumes to their work and respects a removed series', () => {
    expect(
      shape(
        groupBySeries([
          book('v3', '作品 第三卷', { origin: origin('1', '30') }),
          book('v1', '作品 第一卷', {
            origin: origin('1', '10'),
            series: { title: '作品', index: 1 },
          }),
          book('v2', '作品 第二卷', { origin: origin('1', '20') }),
          book('other', '另一作品 第一卷', { origin: origin('2', '10') }),
          book('other2', '另一作品 第二卷', { origin: origin('2', '11') }),
          book('removed', '作品 第四卷', {
            origin: origin('1', '40'),
            series: null,
          }),
        ]),
      ),
    ).toEqual([
      // An explicit position first, then fetched volumes in source order.
      ['作品', ['v1', 'v2', 'v3']],
      ['另一作品', ['other', 'other2']],
      'removed',
    ]);
  });

  it('parses positions and work titles conservatively', () => {
    expect(['3', '2.5', '３', ' 10 '].map(parseSeriesIndex)).toEqual([
      3, 2.5, 3, 10,
    ]);
    expect(
      ['', 'x', '-1', '1e3', '1.2345', '200000'].map(parseSeriesIndex),
    ).toEqual([null, null, null, null, null, null]);
    expect(seriesTitleFromVolume('作品名 第三卷 新的开始')).toBe('作品名');
    expect(seriesTitleFromVolume('Work Vol. 2')).toBe('Work');
    expect(seriesTitleFromVolume('第一卷')).toBe('第一卷');
    expect(seriesKey('Ａ・B c')).toBe(seriesKey('abc'));
  });
});

describe('continueVolume', () => {
  const at = (lastReadAt: number | null, progress: number | null) => ({
    lastReadAt,
    progress,
  });

  it('starts at the first volume and resumes the latest unfinished one', () => {
    const unread = [at(null, null), at(null, null)];
    expect(continueVolume(unread)).toBe(unread[0]);
    const reading = [at(10, 1), at(30, 0.4), at(20, 0.2)];
    expect(continueVolume(reading)).toBe(reading[1]);
    expect(continueVolume([])).toBeNull();
  });

  it('moves past a finished volume to the next unfinished one', () => {
    const books = [at(50, 1), at(10, 0.99), at(null, null), at(null, null)];
    expect(continueVolume(books)).toBe(books[2]);
    const allDone = [at(10, 1), at(50, 0.985)];
    expect(continueVolume(allDone)).toBe(allDone[1]);
  });
});

import type { LibraryBook } from '../../library/domain/library';
import { createTestBook } from '../../../test/fixtures/web-records';
import {
  followedSeries,
  ownedVolumeIndex,
  ownedVolumes,
  volumeKey,
} from './followed-series';

function book(
  id: string,
  novelId: string | null,
  volumeId: string,
  createdAt: number,
  lastReadAt: number | null = null,
): LibraryBook {
  const base = createTestBook({
    id,
    title: `作品${novelId ?? ''} 第${volumeId}卷`,
    createdAt,
  });
  return {
    ...base,
    favorite: false,
    tags: [],
    lastReadAt,
    progress: null,
    metadata: {
      ...base.metadata,
      ...(novelId
        ? {
            origin: {
              source: 'bilinovel' as const,
              novelId,
              volumeId,
              url: 'https://www.bilinovel.com/novel/1.html',
              revision: 'b'.repeat(64),
              translators: [],
            },
          }
        : {}),
    },
  };
}

describe('followed series', () => {
  it('indexes owned volumes, preferring the newest copy', () => {
    const owned = ownedVolumes([
      book('a', '1', '10', 1),
      book('b', '1', '10', 9),
      book('local', null, '1', 5),
    ]);
    expect(owned.map((item) => item.bookId)).toEqual(['a', 'b']);
    expect(
      ownedVolumeIndex(owned).get(volumeKey('bilinovel', '1', '10'))?.bookId,
    ).toBe('b');
  });

  it('groups works and orders them by latest activity', () => {
    expect(
      followedSeries(
        ownedVolumes([
          book('a', '1', '10', 1),
          book('b', '1', '10', 2),
          book('c', '1', '11', 3),
          book('d', '2', '10', 4, 50),
        ]),
      ),
    ).toEqual([
      {
        source: 'bilinovel',
        novelId: '2',
        title: '作品2',
        volumes: 1,
        activeAt: 50,
      },
      {
        source: 'bilinovel',
        novelId: '1',
        title: '作品1',
        volumes: 2,
        activeAt: 3,
      },
    ]);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';

import { createTestBook } from '../../../test/fixtures/web-records';
import type { LibraryBook } from '../../library/domain/library';
import { useOwnedVolumes } from './use-owned-volumes';

function fetched(id: string, source: 'bilinovel' | 'syosetu'): LibraryBook {
  const book = createTestBook({ id });
  return {
    ...book,
    favorite: false,
    tags: [],
    lastReadAt: null,
    progress: null,
    metadata: {
      ...book.metadata,
      origin: {
        source,
        novelId: source === 'syosetu' ? 'n0001aa' : '1',
        volumeId: '1',
        url: 'https://example.org/',
        revision: 'a'.repeat(64),
        translators: [],
      },
    },
  };
}

describe('useOwnedVolumes', () => {
  it('reads fetched books, optionally from some sources, and refreshes', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        fetched('a', 'bilinovel'),
        fetched('b', 'syosetu'),
      ])
      .mockResolvedValue([
        fetched('a', 'bilinovel'),
        fetched('b', 'syosetu'),
        fetched('c', 'syosetu'),
      ]);
    // Pages pass a stable library object; a new one each render re-reads.
    const library = { list };
    const { result } = renderHook(() => useOwnedVolumes(library, ['syosetu']));
    await waitFor(() => {
      expect(result.current.owned.map((item) => item.bookId)).toEqual(['b']);
    });
    await act(() => result.current.refresh());
    expect(result.current.owned.map((item) => item.bookId)).toEqual(['b', 'c']);
  });

  it('keeps the page working when the shelf cannot be read', async () => {
    const list = vi.fn().mockRejectedValue(new Error('locked'));
    const library = { list };
    const { result } = renderHook(() => useOwnedVolumes(library));
    await waitFor(() => {
      expect(list).toHaveBeenCalled();
    });
    expect(result.current.owned).toEqual([]);
    const { result: none } = renderHook(() => useOwnedVolumes(undefined));
    await act(() => none.current.refresh());
    expect(none.current.owned).toEqual([]);
  });
});

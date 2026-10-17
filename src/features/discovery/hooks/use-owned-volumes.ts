import { useCallback, useEffect, useState } from 'react';

import type { BookOrigin } from '../../library/domain/book-origin';
import type { LibraryManagement } from '../../library/services/library-management-service';
import { ownedVolumes, type OwnedVolume } from '../domain/followed-series';

/** The shelf, read to mark volumes already fetched. */
export type OwnedBooks = Pick<LibraryManagement, 'list'>;

/**
 * Shelf books fetched from online sources (optionally only `sources`), read
 * on mount and again on `refresh`. Failures leave the list as it was: marking
 * owned volumes is a convenience, never required.
 */
export function useOwnedVolumes(
  library: OwnedBooks | undefined,
  sources?: readonly BookOrigin['source'][],
) {
  const [owned, setOwned] = useState<OwnedVolume[]>([]);
  const sourceKey = sources?.join('|') ?? '';

  const refresh = useCallback(async () => {
    if (!library) return;
    try {
      const books = await library.list({
        query: '',
        sort: 'added',
        favoritesOnly: false,
        status: 'all',
      });
      const wanted = sourceKey ? sourceKey.split('|') : null;
      setOwned(
        ownedVolumes(books).filter(
          (volume) => !wanted || wanted.includes(volume.source),
        ),
      );
    } catch {
      // The panel works without the marks.
    }
  }, [library, sourceKey]);

  useEffect(() => {
    // Started after the render commits; a quick remount cancels it.
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [refresh]);

  return { owned, refresh };
}

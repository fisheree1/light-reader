import { useEffect, useState } from 'react';

import { groupBySeries } from '../../library/domain/book-series';
import type { LibraryBook } from '../../library/domain/library';
import type { LibraryManagement } from '../../library/services/library-management-service';

/**
 * The next volume on the shelf of the series `bookId` belongs to, looked up
 * only once the reader reaches the end of the book.
 */
export function useNextVolume(
  bookId: string,
  library: Pick<LibraryManagement, 'list'> | undefined,
  atEnd: boolean,
): LibraryBook | null {
  const [found, setFound] = useState<{
    bookId: string;
    next: LibraryBook | null;
  } | null>(null);

  useEffect(() => {
    if (!atEnd || !library) return;
    let active = true;
    // Started after the render commits; leaving the book cancels it.
    const timer = setTimeout(() => {
      library
        .list({ query: '', sort: 'added', favoritesOnly: false, status: 'all' })
        .then((books) => {
          if (!active) return;
          const series = groupBySeries(books).find(
            (entry) =>
              entry.kind === 'series' &&
              entry.books.some((book) => book.id === bookId),
          );
          const volumes = series?.kind === 'series' ? series.books : [];
          const index = volumes.findIndex((book) => book.id === bookId);
          setFound({ bookId, next: volumes.at(index + 1) ?? null });
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [atEnd, bookId, library]);

  return found?.bookId === bookId ? found.next : null;
}

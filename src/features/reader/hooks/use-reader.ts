import { useCallback, useEffect, useRef, useState } from 'react';

import { AppError, asAppError } from '../../../lib/app-error';
import type {
  BookLocator,
  EbookReader,
  ReaderTocItem,
} from '../../../reader-engines/types';
import type { Book } from '../../library/domain/book';
import type { ReaderServices } from '../services/reader-services';

type ReaderPhase = 'error' | 'loading' | 'ready';

const initialLocator: BookLocator = {
  version: 1,
  format: 'epub',
  progression: 0,
};

export function useReader(bookId: string, services: ReaderServices) {
  const [attempt, setAttempt] = useState(0);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locator, setLocator] = useState<BookLocator>(initialLocator);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ReaderPhase>('loading');
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<EbookReader | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    let reader: EbookReader | null = null;
    let unsubscribe: () => void = () => undefined;
    const host = hostRef.current;

    services.repository
      .findById(bookId)
      .then(async (foundBook) => {
        if (!foundBook) throw new AppError('BOOK_NOT_FOUND');
        if (isCancelled() || !host) return;

        setBook(foundBook);
        reader = services.createReader();
        readerRef.current = reader;
        reader.mount(host);
        unsubscribe = reader.subscribeToRelocation((nextLocator) => {
          if (!isCancelled()) setLocator(nextLocator);
        });

        const source = await services.source.read(foundBook.filePath);
        if (isCancelled()) return;
        await reader.open(source);
        if (isCancelled()) {
          await reader.close();
          return;
        }
        setToc(reader.getTableOfContents());
        setPhase('ready');
      })
      .catch((reason: unknown) => {
        if (isCancelled()) return;
        setError(asAppError(reason, 'READER_OPEN_FAILED').userMessage);
        setPhase('error');
      });

    return () => {
      cancelled = true;
      unsubscribe();
      readerRef.current = null;
      void reader?.close();
    };
  }, [attempt, bookId, services]);

  const runNavigation = useCallback(
    async (action: (reader: EbookReader) => Promise<void>) => {
      const reader = readerRef.current;
      if (!reader) return;
      setNavigationError(null);
      try {
        await action(reader);
      } catch (reason) {
        setNavigationError(
          asAppError(reason, 'READER_NAVIGATION_FAILED').userMessage,
        );
      }
    },
    [],
  );

  const goToChapter = useCallback(
    (chapterHref: string) =>
      runNavigation((reader) =>
        reader.goTo({ version: 1, format: 'epub', chapterHref }),
      ),
    [runNavigation],
  );

  const previousPage = useCallback(
    () => runNavigation((reader) => reader.previousPage()),
    [runNavigation],
  );
  const nextPage = useCallback(
    () => runNavigation((reader) => reader.nextPage()),
    [runNavigation],
  );

  const retry = useCallback(() => {
    setBook(null);
    setError(null);
    setLocator(initialLocator);
    setNavigationError(null);
    setPhase('loading');
    setToc([]);
    setAttempt((current) => current + 1);
  }, []);

  return {
    book,
    error,
    goToChapter,
    hostRef,
    locator,
    navigationError,
    nextPage,
    phase,
    previousPage,
    retry,
    toc,
  };
}

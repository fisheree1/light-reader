import { useCallback, useEffect, useState } from 'react';

import { asAppError } from '../../../lib/app-error';
import {
  type BookDeletionMode,
  type BookSort,
  type LibraryBook,
} from '../domain/library';
import type { LibraryServices } from '../services/library-services';
import { translate } from '../../../i18n/i18n';

export interface LibraryNotice {
  kind: 'error' | 'info' | 'success';
  message: string;
}

export function useLibrary(services: LibraryServices) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BookSort>('recent');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [mutatingBookId, setMutatingBookId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);

  const loadBooks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setBooks(await services.management.list({ query, sort, favoritesOnly }));
    } catch (error) {
      setLoadError(asAppError(error, 'DATABASE_READ_FAILED').userMessage);
    } finally {
      setIsLoading(false);
    }
  }, [favoritesOnly, query, services.management, sort]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        services.management
          .list({ query, sort, favoritesOnly })
          .then((persistedBooks) => {
            if (active) setBooks(persistedBooks);
          })
          .catch((error: unknown) => {
            if (active) {
              setLoadError(
                asAppError(error, 'DATABASE_READ_FAILED').userMessage,
              );
            }
          })
          .finally(() => {
            if (active) setIsLoading(false);
          });
      },
      query ? 180 : 0,
    );

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [favoritesOnly, query, services.management, sort]);

  const importBook = useCallback(async () => {
    setIsImporting(true);
    setNotice(null);
    try {
      if (services.importer.importBooks) {
        const result = await services.importer.importBooks();
        if (result.status === 'cancelled') return;
        if (result.created.length > 0) await loadBooks();
        const summary = translate('library.batchSummary', {
          created: result.created.length,
          duplicates: result.duplicates.length,
          failed: result.failed.length,
        });
        const firstFailure = result.failed.at(0);
        setNotice({
          kind:
            result.failed.length === 0
              ? result.created.length > 0
                ? 'success'
                : 'info'
              : result.created.length > 0 || result.duplicates.length > 0
                ? 'info'
                : 'error',
          message: firstFailure
            ? `${summary} ${translate('library.failureDetail', {
                fileName: firstFailure.fileName,
                message: firstFailure.message,
              })}`
            : summary,
        });
        return;
      }
      const result = services.importer.importBook
        ? await services.importer.importBook()
        : await services.importer.importEpub();
      if (result.status === 'created') {
        await loadBooks();
        setNotice({
          kind: 'success',
          message: translate('library.imported', { title: result.book.title }),
        });
      } else if (result.status === 'duplicate') {
        setNotice({ kind: 'info', message: translate('library.duplicate') });
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: asAppError(error, 'UNKNOWN').userMessage,
      });
    } finally {
      setIsImporting(false);
    }
  }, [loadBooks, services.importer]);

  const updateBook = useCallback((updated: LibraryBook) => {
    setBooks((current) =>
      current.map((book) => (book.id === updated.id ? updated : book)),
    );
  }, []);

  const setFavorite = useCallback(
    async (bookId: string, favorite: boolean) => {
      setMutatingBookId(bookId);
      setNotice(null);
      try {
        updateBook(await services.management.setFavorite(bookId, favorite));
        return true;
      } catch (error) {
        setNotice({
          kind: 'error',
          message: asAppError(error, 'BOOK_UPDATE_FAILED').userMessage,
        });
        return false;
      } finally {
        setMutatingBookId(null);
      }
    },
    [services.management, updateBook],
  );

  const replaceTags = useCallback(
    async (bookId: string, tags: string[]) => {
      setMutatingBookId(bookId);
      setNotice(null);
      try {
        const updated = await services.management.replaceTags(bookId, tags);
        updateBook(updated);
        setNotice({ kind: 'success', message: translate('library.tagsSaved') });
        return true;
      } catch (error) {
        setNotice({
          kind: 'error',
          message: asAppError(error, 'BOOK_UPDATE_FAILED').userMessage,
        });
        return false;
      } finally {
        setMutatingBookId(null);
      }
    },
    [services.management, updateBook],
  );

  const deleteBook = useCallback(
    async (bookId: string, mode: BookDeletionMode) => {
      setMutatingBookId(bookId);
      setNotice(null);
      try {
        const result = await services.management.deleteBook(bookId, mode);
        setBooks((current) => current.filter((book) => book.id !== bookId));
        setNotice({
          kind: result.cleanupPending ? 'info' : 'success',
          message: result.cleanupPending
            ? translate('library.cleanupPending')
            : mode === 'delete-all'
              ? translate('library.deletedAll', {
                  count: result.removedReferences,
                })
              : translate('library.deletedKeepReferences'),
        });
        return true;
      } catch (error) {
        setNotice({
          kind: 'error',
          message: asAppError(error, 'BOOK_DELETE_FAILED').userMessage,
        });
        return false;
      } finally {
        setMutatingBookId(null);
      }
    },
    [services.management],
  );

  return {
    books,
    deleteBook,
    favoritesOnly,
    importBook,
    importEpub: importBook,
    isImporting,
    isLoading,
    loadBooks,
    loadError,
    mutatingBookId,
    notice,
    query,
    replaceTags,
    setFavorite,
    setFavoritesOnly,
    setQuery,
    setSort,
    sort,
  };
}

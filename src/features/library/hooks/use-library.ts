import { useCallback, useEffect, useState } from 'react';

import { asAppError } from '../../../lib/app-error';
import type { Book } from '../domain/book';
import type { LibraryServices } from '../services/library-services';

export interface LibraryNotice {
  kind: 'error' | 'info' | 'success';
  message: string;
}

export function useLibrary(services: LibraryServices) {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);

  const loadBooks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setBooks(await services.repository.list());
    } catch (error) {
      setLoadError(asAppError(error, 'DATABASE_READ_FAILED').userMessage);
    } finally {
      setIsLoading(false);
    }
  }, [services]);

  useEffect(() => {
    let active = true;
    services.repository
      .list()
      .then((persistedBooks) => {
        if (active) setBooks(persistedBooks);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(asAppError(error, 'DATABASE_READ_FAILED').userMessage);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [services.repository]);

  const importEpub = useCallback(async () => {
    setIsImporting(true);
    setNotice(null);
    try {
      const result = await services.importer.importEpub();
      if (result.status === 'created') {
        setBooks((current) => [
          result.book,
          ...current.filter((book) => book.id !== result.book.id),
        ]);
        setNotice({
          kind: 'success',
          message: `《${result.book.title}》已导入书架。`,
        });
      } else if (result.status === 'duplicate') {
        setNotice({ kind: 'info', message: '这本书已经在书架中了。' });
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: asAppError(error, 'UNKNOWN').userMessage,
      });
    } finally {
      setIsImporting(false);
    }
  }, [services]);

  const showReaderUnavailable = useCallback((book: Book) => {
    setNotice({
      kind: 'info',
      message: `《${book.title}》已保存在本地，阅读功能尚未实现。`,
    });
  }, []);

  return {
    books,
    importEpub,
    isImporting,
    isLoading,
    loadBooks,
    loadError,
    notice,
    showReaderUnavailable,
  };
}

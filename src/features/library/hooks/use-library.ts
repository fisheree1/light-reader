import { useCallback, useEffect, useState } from 'react';

import { asAppError } from '../../../lib/app-error';
import {
  type BookDeletionMode,
  type BookSort,
  type LibraryBook,
} from '../domain/library';
import type { LibraryServices } from '../services/library-services';

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
        const summary = `批量导入完成：新增 ${String(result.created.length)} 本，重复 ${String(result.duplicates.length)} 本，失败 ${String(result.failed.length)} 本。`;
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
            ? `${summary} ${firstFailure.fileName}：${firstFailure.message}`
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
        setNotice({ kind: 'success', message: '标签已保存。' });
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
            ? '书籍已移出书架，残留隔离文件将在后续清理。'
            : mode === 'delete-all'
              ? `书籍及相关数据已删除，共移除 ${String(result.removedReferences)} 个笔记引用。`
              : '书籍文件和阅读数据已删除，笔记引用快照已保留。',
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

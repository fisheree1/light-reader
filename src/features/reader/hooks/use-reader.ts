import { useCallback } from 'react';

import { AppError, asAppError } from '../../../lib/app-error';
import { createUuid } from '../../../lib/id';
import type {
  BookLocator,
  EbookReader,
  ReaderSearchResult,
} from '../../../reader-engines/types';
import type { AnnotationColor } from '../../annotations/domain/annotation';
import { NoteService } from '../../notes/services/note-service';
import type { Bookmark } from '../domain/bookmark';
import type { ReaderNavigationTarget } from '../domain/reader-navigation';
import {
  resolveReaderSettings,
  type ReaderSettingsOverride,
} from '../domain/reader-settings';
import type { ReaderServices } from '../services/reader-services';
import { useReaderSession } from './use-reader-session';

export function useReader(
  bookId: string,
  services: ReaderServices,
  navigationTarget: ReaderNavigationTarget | null = null,
) {
  const session = useReaderSession(bookId, services, navigationTarget);
  const {
    annotationServiceRef,
    annotations,
    book,
    globalSettings,
    locator,
    readerRef,
    setActiveAnnotationId,
    setAnnotationError,
    setAnnotations,
    setBookmarks,
    setBookOverride,
    setLocator,
    setNavigationError,
    setPersistenceError,
    setUnresolvedAnnotationIds,
  } = session;

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
    [readerRef, setNavigationError],
  );

  const saveBookSettings = useCallback(
    async (settings: ReaderSettingsOverride) => {
      setPersistenceError(null);
      try {
        const saved = await services.settingsRepository.saveBookOverride(
          bookId,
          settings,
        );
        setBookOverride(saved);
        readerRef.current?.applyDisplaySettings(
          resolveReaderSettings(globalSettings, saved),
        );
      } catch (reason) {
        const appError = asAppError(reason, 'READER_SETTINGS_WRITE_FAILED');
        setPersistenceError(appError.userMessage);
        throw appError;
      }
    },
    [
      bookId,
      globalSettings,
      readerRef,
      services.settingsRepository,
      setBookOverride,
      setPersistenceError,
    ],
  );

  const clearBookSettings = useCallback(async () => {
    setPersistenceError(null);
    try {
      await services.settingsRepository.deleteBookOverride(bookId);
      setBookOverride(null);
      readerRef.current?.applyDisplaySettings(globalSettings);
    } catch (reason) {
      const appError = asAppError(reason, 'READER_SETTINGS_WRITE_FAILED');
      setPersistenceError(appError.userMessage);
      throw appError;
    }
  }, [
    bookId,
    globalSettings,
    readerRef,
    services.settingsRepository,
    setBookOverride,
    setPersistenceError,
  ]);

  const createHighlight = useCallback(
    async (color: AnnotationColor) => {
      const service = annotationServiceRef.current;
      if (!service) return;
      setAnnotationError(null);
      try {
        const annotation = await service.createFromSelection(bookId, color);
        setAnnotations((current) => [annotation, ...current]);
      } catch (reason) {
        const appError = asAppError(reason, 'ANNOTATION_WRITE_FAILED');
        setAnnotationError(appError.userMessage);
        throw appError;
      }
    },
    [annotationServiceRef, bookId, setAnnotationError, setAnnotations],
  );

  const updateAnnotationNote = useCallback(
    async (annotationId: string, noteText: string) => {
      const service = annotationServiceRef.current;
      if (!service) throw new AppError('ANNOTATION_WRITE_FAILED');
      const updated = await service.updateNote(annotationId, noteText);
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === updated.id ? updated : annotation,
        ),
      );
      return updated;
    },
    [annotationServiceRef, setAnnotations],
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      const service = annotationServiceRef.current;
      if (!service) throw new AppError('ANNOTATION_WRITE_FAILED');
      const annotation = annotations.find((item) => item.id === annotationId);
      if (!annotation) throw new AppError('ANNOTATION_NOT_FOUND');
      try {
        await service.delete(annotation);
        setAnnotations((current) =>
          current.filter((item) => item.id !== annotationId),
        );
        setActiveAnnotationId((current) =>
          current === annotationId ? null : current,
        );
        setUnresolvedAnnotationIds((current) =>
          current.filter((id) => id !== annotationId),
        );
      } catch (reason) {
        const appError = asAppError(reason, 'ANNOTATION_WRITE_FAILED');
        setAnnotationError(appError.userMessage);
        throw appError;
      }
    },
    [
      annotationServiceRef,
      annotations,
      setActiveAnnotationId,
      setAnnotationError,
      setAnnotations,
      setUnresolvedAnnotationIds,
    ],
  );

  const navigateToAnnotation = useCallback(
    async (annotationId: string) => {
      const located =
        (await annotationServiceRef.current?.navigateTo(annotationId)) ?? false;
      setActiveAnnotationId(annotationId);
      if (!located) {
        setUnresolvedAnnotationIds((current) =>
          current.includes(annotationId) ? current : [...current, annotationId],
        );
        setAnnotationError(
          new AppError('ANNOTATION_LOCATE_FAILED').userMessage,
        );
      }
      return located;
    },
    [
      annotationServiceRef,
      setActiveAnnotationId,
      setAnnotationError,
      setUnresolvedAnnotationIds,
    ],
  );

  const insertAnnotationIntoNote = useCallback(
    async (annotationId: string) => {
      if (!services.noteRepository || !book) {
        throw new AppError('NOTE_WRITE_FAILED');
      }
      const annotation = annotations.find((item) => item.id === annotationId);
      if (!annotation) throw new AppError('ANNOTATION_NOT_FOUND');
      try {
        const service = new NoteService(services.noteRepository);
        return await service.createFromAnnotation(annotation, book.title);
      } catch (reason) {
        throw asAppError(reason, 'NOTE_WRITE_FAILED');
      }
    },
    [annotations, book, services.noteRepository],
  );

  const goToChapter = useCallback(
    (chapterHref: string) =>
      runNavigation((reader) =>
        reader.goTo({ version: 1, format: 'epub', chapterHref }),
      ),
    [runNavigation],
  );
  const goToLocator = useCallback(
    (value: BookLocator) =>
      runNavigation(async (reader) => {
        await reader.goTo(value);
        setLocator(await reader.getCurrentLocator());
      }),
    [runNavigation, setLocator],
  );
  const previousPage = useCallback(
    () => runNavigation((reader) => reader.previousPage()),
    [runNavigation],
  );
  const nextPage = useCallback(
    () => runNavigation((reader) => reader.nextPage()),
    [runNavigation],
  );

  const createBookmark = useCallback(
    async (name: string) => {
      const now = Date.now();
      if (!services.bookmarkRepository) {
        throw new AppError('BOOKMARK_WRITE_FAILED');
      }
      const bookmark = await services.bookmarkRepository.create({
        id: createUuid(),
        bookId,
        name,
        locator,
        createdAt: now,
        updatedAt: now,
      });
      setBookmarks((current) => [bookmark, ...current]);
      return bookmark;
    },
    [bookId, locator, services.bookmarkRepository, setBookmarks],
  );

  const deleteBookmark = useCallback(
    async (id: string) => {
      if (!services.bookmarkRepository) {
        throw new AppError('BOOKMARK_WRITE_FAILED');
      }
      await services.bookmarkRepository.delete(id);
      setBookmarks((current) => current.filter((item) => item.id !== id));
    },
    [services.bookmarkRepository, setBookmarks],
  );

  const renameBookmark = useCallback(
    async (id: string, name: string) => {
      if (!services.bookmarkRepository) {
        throw new AppError('BOOKMARK_WRITE_FAILED');
      }
      const updated = await services.bookmarkRepository.rename(id, name);
      setBookmarks((current) =>
        current.map((item) => (item.id === id ? updated : item)),
      );
      return updated;
    },
    [services.bookmarkRepository, setBookmarks],
  );

  const navigateToBookmark = useCallback(
    (bookmark: Bookmark) =>
      runNavigation(async (reader) => {
        await reader.goTo(bookmark.locator);
        setLocator(await reader.getCurrentLocator());
      }),
    [runNavigation, setLocator],
  );

  const searchCurrentChapter = useCallback(
    async (query: string): Promise<ReaderSearchResult[]> => {
      const reader = readerRef.current;
      if (reader?.search) return reader.search(query);
      return reader?.searchCurrentChapter
        ? reader.searchCurrentChapter(query)
        : [];
    },
    [readerRef],
  );

  const clearChapterSearch = useCallback(() => {
    readerRef.current?.clearSearch?.();
  }, [readerRef]);

  return {
    activeAnnotationId: session.activeAnnotationId,
    annotationError: session.annotationError,
    annotations: session.annotations,
    bookmarks: session.bookmarks,
    book: session.book,
    bookOverride: session.bookOverride,
    clearBookSettings,
    clearChapterSearch,
    createBookmark,
    createHighlight,
    deleteAnnotation,
    deleteBookmark,
    effectiveSettings: session.effectiveSettings,
    error: session.error,
    goToChapter,
    goToLocator,
    hostRef: session.hostRef,
    insertAnnotationIntoNote,
    locator: session.locator,
    navigationError: session.navigationError,
    navigateToAnnotation,
    navigateToBookmark,
    nextPage,
    persistenceError: session.persistenceError,
    phase: session.phase,
    previousPage,
    renameBookmark,
    retry: session.retry,
    saveBookSettings,
    searchCurrentChapter,
    selection: session.selection,
    setActiveAnnotationId: session.setActiveAnnotationId,
    toc: session.toc,
    unresolvedAnnotationIds: session.unresolvedAnnotationIds,
    updateAnnotationNote,
  };
}

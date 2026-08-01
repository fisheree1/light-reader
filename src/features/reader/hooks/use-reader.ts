import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  defaultReaderSettings,
  resolveReaderSettings,
  type ReaderSettingsOverride,
} from '../domain/reader-settings';
import { AppError, asAppError } from '../../../lib/app-error';
import type {
  Annotation,
  AnnotationColor,
} from '../../annotations/domain/annotation';
import { AnnotationService } from '../../annotations/services/annotation-service';
import type {
  BookLocator,
  EbookReader,
  ReaderTocItem,
  ReaderTextSelection,
} from '../../../reader-engines/types';
import { useReaderSettingsStore } from '../../../stores/reader-settings-store';
import type { Book } from '../../library/domain/book';
import type { ReaderServices } from '../services/reader-services';

type ReaderPhase = 'error' | 'loading' | 'ready';

const initialLocator: BookLocator = {
  version: 1,
  format: 'epub',
  progression: 0,
};
const relocationSaveDelay = 600;

export function useReader(bookId: string, services: ReaderServices) {
  const [attempt, setAttempt] = useState(0);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locator, setLocator] = useState<BookLocator>(initialLocator);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ReaderPhase>('loading');
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReaderTextSelection | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(
    null,
  );
  const [unresolvedAnnotationIds, setUnresolvedAnnotationIds] = useState<
    string[]
  >([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<EbookReader | null>(null);
  const annotationServiceRef = useRef<AnnotationService | null>(null);
  const hydrateSettings = useReaderSettingsStore((state) => state.hydrate);
  const setBookOverride = useReaderSettingsStore(
    (state) => state.setBookOverride,
  );
  const bookOverride = useReaderSettingsStore((state) => state.bookOverride);
  const globalSettings = useReaderSettingsStore(
    (state) => state.globalSettings,
  );
  const effectiveSettings = useMemo(
    () => resolveReaderSettings(globalSettings, bookOverride),
    [bookOverride, globalSettings],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    let reader: EbookReader | null = null;
    let unsubscribe: () => void = () => undefined;
    let unsubscribeSelection: () => void = () => undefined;
    let unsubscribeHighlightActivation: () => void = () => undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingLocator: BookLocator | null = null;
    const host = hostRef.current;

    const savePendingLocator = () => {
      if (!pendingLocator) return;
      const value = pendingLocator;
      pendingLocator = null;
      void services.settingsRepository
        .saveReadingState(bookId, value)
        .catch((reason: unknown) => {
          if (!cancelled) {
            setPersistenceError(
              asAppError(reason, 'READING_STATE_WRITE_FAILED').userMessage,
            );
          }
        });
    };

    Promise.all([
      services.repository.findById(bookId),
      services.settingsRepository
        .getGlobal()
        .catch(() => defaultReaderSettings),
      services.settingsRepository.getBookOverride(bookId).catch(() => null),
      services.settingsRepository.getReadingState(bookId).catch(() => null),
    ])
      .then(async ([foundBook, globalSettings, override, readingState]) => {
        if (!foundBook) throw new AppError('BOOK_NOT_FOUND');
        if (isCancelled() || !host) return;

        setBook(foundBook);
        hydrateSettings(bookId, globalSettings, override);
        reader = services.createReader();
        readerRef.current = reader;
        reader.mount(host);

        const source = await services.source.read(foundBook.filePath);
        if (isCancelled()) return;
        await reader.open(source);
        if (isCancelled()) {
          await reader.close();
          return;
        }
        reader.applyDisplaySettings(
          resolveReaderSettings(globalSettings, override),
        );
        if (readingState) {
          await reader.goTo(readingState.locator);
          setLocator(readingState.locator);
        }
        const annotationService = new AnnotationService(
          services.annotationRepository,
          reader,
        );
        annotationServiceRef.current = annotationService;
        unsubscribeSelection = reader.subscribeToSelection((nextSelection) => {
          if (!isCancelled()) setSelection(nextSelection);
        });
        unsubscribeHighlightActivation = reader.subscribeToHighlightActivation(
          (annotationId) => {
            if (!isCancelled()) setActiveAnnotationId(annotationId);
          },
        );
        try {
          const restored = await annotationService.restore(bookId);
          if (!isCancelled()) {
            setAnnotations(restored.annotations);
            const unresolved = restored.restoreResults
              .filter((result) => result.status === 'unresolved')
              .map((result) => result.id);
            setUnresolvedAnnotationIds(unresolved);
            if (unresolved.length > 0) {
              setAnnotationError(
                new AppError('ANNOTATION_RESTORE_PARTIAL').userMessage,
              );
            }
          }
        } catch (reason) {
          if (!isCancelled()) {
            setAnnotationError(
              asAppError(reason, 'ANNOTATION_READ_FAILED').userMessage,
            );
          }
        }
        unsubscribe = reader.subscribeToRelocation((nextLocator) => {
          if (isCancelled()) return;
          setLocator(nextLocator);
          setPersistenceError(null);
          pendingLocator = nextLocator;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(savePendingLocator, relocationSaveDelay);
        });
        setToc(reader.getTableOfContents());
        setPhase('ready');
      })
      .catch((reason: unknown) => {
        if (isCancelled()) return;
        setError(asAppError(reason, 'READER_OPEN_FAILED').userMessage);
        setPhase('error');
      });

    return () => {
      clearTimeout(saveTimer);
      savePendingLocator();
      cancelled = true;
      unsubscribe();
      unsubscribeSelection();
      unsubscribeHighlightActivation();
      readerRef.current = null;
      annotationServiceRef.current = null;
      void reader?.close();
    };
  }, [attempt, bookId, hydrateSettings, services]);

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
    [bookId, globalSettings, services.settingsRepository, setBookOverride],
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
  }, [bookId, globalSettings, services.settingsRepository, setBookOverride]);

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
    [bookId],
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
    [],
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
    [annotations],
  );

  const navigateToAnnotation = useCallback(async (annotationId: string) => {
    const located =
      (await annotationServiceRef.current?.navigateTo(annotationId)) ?? false;
    setActiveAnnotationId(annotationId);
    if (!located) {
      setUnresolvedAnnotationIds((current) =>
        current.includes(annotationId) ? current : [...current, annotationId],
      );
      setAnnotationError(new AppError('ANNOTATION_LOCATE_FAILED').userMessage);
    }
    return located;
  }, []);

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
    setPersistenceError(null);
    setPhase('loading');
    setToc([]);
    setAnnotations([]);
    setAnnotationError(null);
    setSelection(null);
    setActiveAnnotationId(null);
    setUnresolvedAnnotationIds([]);
    setAttempt((current) => current + 1);
  }, []);

  return {
    book,
    activeAnnotationId,
    annotationError,
    annotations,
    bookOverride,
    clearBookSettings,
    createHighlight,
    deleteAnnotation,
    effectiveSettings,
    error,
    goToChapter,
    hostRef,
    locator,
    navigationError,
    nextPage,
    navigateToAnnotation,
    persistenceError,
    phase,
    previousPage,
    retry,
    saveBookSettings,
    selection,
    setActiveAnnotationId,
    toc,
    unresolvedAnnotationIds,
    updateAnnotationNote,
  };
}

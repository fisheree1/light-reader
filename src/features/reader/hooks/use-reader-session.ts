import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppError, asAppError } from '../../../lib/app-error';
import { createUuid } from '../../../lib/id';
import type {
  BookLocator,
  EbookReader,
  ReaderTextSelection,
  ReaderTocItem,
} from '../../../reader-engines/types';
import { useReaderSettingsStore } from '../../../stores/reader-settings-store';
import type { Annotation } from '../../annotations/domain/annotation';
import { AnnotationService } from '../../annotations/services/annotation-service';
import type { Book } from '../../library/domain/book';
import type { Bookmark } from '../domain/bookmark';
import type { ReaderNavigationTarget } from '../domain/reader-navigation';
import {
  defaultReaderSettings,
  resolveReaderSettings,
} from '../domain/reader-settings';
import type { ReaderServices } from '../services/reader-services';

type ReaderPhase = 'error' | 'loading' | 'ready';

export const initialReaderLocator: BookLocator = {
  version: 1,
  format: 'epub',
  progression: 0,
};

const relocationSaveDelay = 600;

export function useReaderSession(
  bookId: string,
  services: ReaderServices,
  navigationTarget: ReaderNavigationTarget | null,
) {
  const [attempt, setAttempt] = useState(0);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locator, setLocator] = useState<BookLocator>(initialReaderLocator);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ReaderPhase>('loading');
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
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
    let readingSessionId: string | null = null;
    const host = hostRef.current;
    const sessionHost = host ? document.createElement('div') : null;
    if (host && sessionHost) {
      sessionHost.className = 'h-full w-full';
      host.replaceChildren(sessionHost);
    }

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

    const restoreLocator = async (
      activeReader: EbookReader,
      value: BookLocator,
    ): Promise<boolean> => {
      try {
        await activeReader.goTo(value);
        return true;
      } catch (reason) {
        if (
          value.progression !== undefined &&
          value.format === 'epub' &&
          (value.cfi !== undefined || value.chapterHref !== undefined)
        ) {
          try {
            await activeReader.goTo({
              version: 1,
              format: 'epub',
              progression: value.progression,
            });
            return true;
          } catch {
            // The renderer remains at its safe initial location.
          }
        }
        if (!isCancelled()) {
          setNavigationError(
            asAppError(reason, 'READER_NAVIGATION_FAILED').userMessage,
          );
        }
        return false;
      }
    };

    Promise.all([
      services.repository.findById(bookId),
      services.settingsRepository
        .getGlobal()
        .catch(() => defaultReaderSettings),
      services.settingsRepository.getBookOverride(bookId).catch(() => null),
      services.settingsRepository.getReadingState(bookId).catch(() => null),
      services.bookmarkRepository?.listByBook(bookId).catch(() => []) ??
        Promise.resolve([]),
    ])
      .then(
        async ([
          foundBook,
          loadedGlobalSettings,
          override,
          readingState,
          savedBookmarks,
        ]) => {
          if (!foundBook) throw new AppError('BOOK_NOT_FOUND');
          if (isCancelled() || !sessionHost) return;

          setBook(foundBook);
          setBookmarks(savedBookmarks);
          hydrateSettings(bookId, loadedGlobalSettings, override);
          reader = services.createReader(foundBook.format);
          readerRef.current = reader;
          reader.mount(sessionHost);

          const source = await services.source.read(foundBook.filePath);
          if (isCancelled()) return;
          await reader.open(source);
          if (isCancelled()) {
            await reader.close();
            return;
          }
          reader.applyDisplaySettings(
            resolveReaderSettings(loadedGlobalSettings, override),
          );
          if (!navigationTarget && readingState) {
            if (await restoreLocator(reader, readingState.locator)) {
              setLocator(readingState.locator);
            }
          }
          const annotationService = new AnnotationService(
            services.annotationRepository,
            reader,
          );
          annotationServiceRef.current = annotationService;
          unsubscribeSelection = reader.subscribeToSelection(
            (nextSelection) => {
              if (!isCancelled()) setSelection(nextSelection);
            },
          );
          unsubscribeHighlightActivation =
            reader.subscribeToHighlightActivation((annotationId) => {
              if (!isCancelled()) setActiveAnnotationId(annotationId);
            });
          let navigationTargetLocated = false;
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
              if (
                navigationTarget?.annotationId &&
                restored.annotations.some(
                  (annotation) =>
                    annotation.id === navigationTarget.annotationId,
                )
              ) {
                const located = await annotationService.navigateTo(
                  navigationTarget.annotationId,
                );
                if (located) {
                  navigationTargetLocated = true;
                  setActiveAnnotationId(navigationTarget.annotationId);
                  setLocator(await reader.getCurrentLocator());
                }
              }
            }
          } catch (reason) {
            if (!isCancelled()) {
              setAnnotationError(
                asAppError(reason, 'ANNOTATION_READ_FAILED').userMessage,
              );
            }
          }
          if (navigationTarget && !navigationTargetLocated && !isCancelled()) {
            if (await restoreLocator(reader, navigationTarget.locator)) {
              setLocator(navigationTarget.locator);
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
          readingSessionId = createUuid();
          void services.readingActivityRepository
            ?.startSession({
              id: readingSessionId,
              bookId,
              startedAt: Date.now(),
              endedAt: null,
              durationSeconds: 0,
            })
            .catch(() => {
              readingSessionId = null;
            });
          setPhase('ready');
        },
      )
      .catch((reason: unknown) => {
        if (isCancelled()) return;
        setError(asAppError(reason, 'READER_OPEN_FAILED').userMessage);
        setPhase('error');
      });

    return () => {
      cancelled = true;
      clearTimeout(saveTimer);
      savePendingLocator();
      unsubscribe();
      unsubscribeSelection();
      unsubscribeHighlightActivation();
      if (readingSessionId) {
        void services.readingActivityRepository
          ?.finishSession(readingSessionId, Date.now())
          .catch(() => undefined);
      }
      reader?.clearSearch?.();
      readerRef.current = null;
      annotationServiceRef.current = null;
      void reader?.close();
      if (sessionHost?.parentElement === host) sessionHost.remove();
    };
  }, [attempt, bookId, hydrateSettings, navigationTarget, services]);

  const retry = useCallback(() => {
    setBook(null);
    setError(null);
    setLocator(initialReaderLocator);
    setNavigationError(null);
    setPersistenceError(null);
    setPhase('loading');
    setToc([]);
    setAnnotations([]);
    setBookmarks([]);
    setAnnotationError(null);
    setSelection(null);
    setActiveAnnotationId(null);
    setUnresolvedAnnotationIds([]);
    setAttempt((current) => current + 1);
  }, []);

  return {
    activeAnnotationId,
    annotationError,
    annotationServiceRef,
    annotations,
    book,
    bookmarks,
    bookOverride,
    effectiveSettings,
    error,
    globalSettings,
    hostRef,
    locator,
    navigationError,
    persistenceError,
    phase,
    readerRef,
    retry,
    selection,
    setActiveAnnotationId,
    setAnnotationError,
    setAnnotations,
    setBookmarks,
    setBookOverride,
    setLocator,
    setNavigationError,
    setPersistenceError,
    setUnresolvedAnnotationIds,
    toc,
    unresolvedAnnotationIds,
  };
}

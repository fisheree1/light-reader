import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Highlighter,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import { cn } from '../../lib/cn';
import { bookFormatLabels } from '../library/domain/book';
import { AnnotationPopover } from '../annotations/components/annotation-popover';
import { FINISHED_PROGRESS } from '../library/domain/reading-status';
import { useNextVolume } from './hooks/use-next-volume';
import {
  measureReadingLayout,
  useReadingLayout,
} from './hooks/use-reading-layout';
import { AnnotationSidebar } from '../annotations/components/annotation-sidebar';
import { AnnotationExportService } from '../annotations/services/annotation-export-service';
import { SelectionToolbar } from '../annotations/components/selection-toolbar';
import { ReaderTableOfContents } from './components/reader-table-of-contents';
import { ReaderSettingsDialog } from './components/reader-settings-dialog';
import { ReaderBookmarkSidebar } from './components/reader-bookmark-sidebar';
import { ReaderChapterSearch } from './components/reader-chapter-search';
import { parseReaderNavigationState } from './domain/reader-navigation';
import { useReader } from './hooks/use-reader';
import {
  readerServices,
  type ReaderServices,
} from './services/reader-services';
import { AiSelectionAssistant } from '../ai-agent/components/ai-selection-assistant';
import type { AgentFacade } from '../ai-agent/services/agent-facade';
import { agentFacade as defaultAgentFacade } from '../ai-agent/services/ai-services';
import type { AiDraft } from '../ai-agent/domain/agent';
import { NoteService } from '../notes/services/note-service';
import { DictionaryPanel } from '../dictionary/components/dictionary-panel';
import { useSpeech } from '../dictionary/hooks/use-speech';
import {
  dictionaryServices,
  type DictionaryServices,
} from '../dictionary/services/dictionary-services';
import { useI18n } from '../../i18n/use-i18n';

interface ReaderPageProps {
  agentFacade?: AgentFacade;
  dictionary?: DictionaryServices;
  services?: ReaderServices;
}

type ReaderRightSidebar = 'annotations' | 'bookmarks' | 'ai' | 'dictionary';

function isEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input, textarea, select, button, a'))
  );
}

export function ReaderPage({
  agentFacade = defaultAgentFacade,
  dictionary = dictionaryServices,
  services = readerServices,
}: ReaderPageProps) {
  const { t } = useI18n();
  const { bookId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationTarget = useMemo(
    () => parseReaderNavigationState(location.state),
    [location.state],
  );
  const {
    book,
    activeAnnotationId,
    annotationError,
    annotations,
    bookmarks,
    bookOverride,
    clearBookSettings,
    clearChapterSearch,
    createBookmark,
    createHighlight,
    deleteAnnotation,
    deleteBookmark,
    effectiveSettings,
    error,
    goToChapter,
    goToLocator,
    hostRef,
    insertAnnotationIntoNote,
    locator,
    navigationError,
    nextPage,
    navigateToAnnotation,
    navigateToBookmark,
    persistenceError,
    phase,
    previousPage,
    retry,
    renameBookmark,
    saveBookSettings,
    searchCurrentChapter,
    selection,
    setActiveAnnotationId,
    toc,
    unresolvedAnnotationIds,
    updateAnnotationNote,
  } = useReader(bookId, services, navigationTarget);
  // On smaller windows the side panels would squeeze the text: they start
  // closed and only one stays open at a time.
  const [initialLayout] = useState(measureReadingLayout);
  const [isTocOpen, setIsTocOpen] = useState(!initialLayout.narrow);
  const [rightSidebar, setRightSidebar] = useState<ReaderRightSidebar | null>(
    initialLayout.compact ? null : 'annotations',
  );
  const layout = useReadingLayout((next) => {
    setRightSidebar(null);
    if (next.narrow) setIsTocOpen(false);
  });
  const showRightSidebar = (
    next:
      | ReaderRightSidebar
      | null
      | ((current: ReaderRightSidebar | null) => ReaderRightSidebar | null),
  ) => {
    const value = typeof next === 'function' ? next(rightSidebar) : next;
    setRightSidebar(value);
    if (value && layout.compact) setIsTocOpen(false);
  };
  const [isChapterSearchOpen, setIsChapterSearchOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState(selection);
  const [aiSelectionBookId, setAiSelectionBookId] = useState<string | null>(
    null,
  );
  const aiReturnFocusRef = useRef<HTMLElement | null>(null);
  const [lookupText, setLookupText] = useState('');
  const speech = useSpeech(dictionary.speech, book?.metadata.language);
  const isAnnotationSidebarOpen = rightSidebar === 'annotations';
  const isBookmarkSidebarOpen = rightSidebar === 'bookmarks';
  const isAiAssistantOpen = rightSidebar === 'ai';
  const activeAnnotation =
    annotations.find((annotation) => annotation.id === activeAnnotationId) ??
    null;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target) || phase !== 'ready') return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void previousPage();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void nextPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nextPage, phase, previousPage]);

  useEffect(() => {
    if (!isAiAssistantOpen || !selection) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setAiSelection(selection);
      setAiSelectionBookId(bookId);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, isAiAssistantOpen, selection]);

  function openAiAssistant() {
    aiReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setAiSelection(selection);
    setAiSelectionBookId(bookId);
    showRightSidebar('ai');
  }

  function closeAiAssistant() {
    showRightSidebar(null);
    queueMicrotask(() => {
      aiReturnFocusRef.current?.focus();
    });
  }

  const progress = Math.round((locator.progression ?? 0) * 100);
  const atEnd = (locator.progression ?? 0) >= FINISHED_PROGRESS;
  const nextVolume = useNextVolume(bookId, services.library, atEnd);

  return (
    <div className="bg-background text-foreground flex h-screen min-h-[32rem] flex-col overflow-hidden">
      <header className="bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/library">
            <ArrowLeft aria-hidden="true" size={16} />
            {t('reader.backToLibrary')}
          </Link>
        </Button>
        <IconButton
          aria-pressed={isTocOpen}
          icon={<ListTree aria-hidden="true" size={17} />}
          label={isTocOpen ? t('reader.hideToc') : t('reader.showToc')}
          onClick={() => {
            const opening = !isTocOpen;
            setIsTocOpen(opening);
            if (opening && layout.compact) setRightSidebar(null);
          }}
          variant="ghost"
        />
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-sm font-semibold">
            {book?.title ?? t('reader.opening')}
          </h1>
          {book ? (
            <p className="text-muted-foreground truncate text-xs">
              {book.author ?? t('common.unknownAuthor')}
            </p>
          ) : null}
        </div>
        <ReaderSettingsDialog
          bookOverride={bookOverride}
          disabled={phase !== 'ready'}
          effectiveSettings={effectiveSettings}
          onClear={clearBookSettings}
          onSave={saveBookSettings}
        />
        <IconButton
          aria-pressed={isChapterSearchOpen}
          icon={<Search aria-hidden="true" size={17} />}
          label={
            isChapterSearchOpen
              ? book?.format === 'pdf'
                ? t('reader.closeBookSearch')
                : t('reader.closeChapterSearch')
              : book?.format === 'pdf'
                ? t('reader.bookSearch')
                : t('reader.chapterSearch')
          }
          onClick={() => {
            setIsChapterSearchOpen((current) => {
              if (current) clearChapterSearch();
              return !current;
            });
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={isBookmarkSidebarOpen}
          icon={<Bookmark aria-hidden="true" size={17} />}
          label={
            isBookmarkSidebarOpen
              ? t('reader.hideBookmarks')
              : t('reader.showBookmarks')
          }
          onClick={() => {
            showRightSidebar((current) =>
              current === 'bookmarks' ? null : 'bookmarks',
            );
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={isAnnotationSidebarOpen}
          icon={<Highlighter aria-hidden="true" size={17} />}
          label={
            isAnnotationSidebarOpen
              ? t('reader.hideAnnotations')
              : t('reader.showAnnotations')
          }
          onClick={() => {
            showRightSidebar((current) =>
              current === 'annotations' ? null : 'annotations',
            );
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={isAiAssistantOpen}
          icon={<Sparkles aria-hidden="true" size={17} />}
          label={isAiAssistantOpen ? t('reader.hideAi') : t('reader.showAi')}
          onClick={() => {
            if (isAiAssistantOpen) closeAiAssistant();
            else openAiAssistant();
          }}
          variant="ghost"
        />
        <span
          aria-label={t('reader.progress', { percent: progress })}
          className="text-muted-foreground w-12 text-right text-xs tabular-nums"
        >
          {progress}%
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {isTocOpen ? (
          <aside className="bg-surface w-64 shrink-0 overflow-auto border-r p-3">
            <h2 className="mb-3 px-2 text-sm font-semibold">
              {t('reader.toc')}
            </h2>
            <ReaderTableOfContents
              currentHref={
                locator.format === 'epub' ? locator.chapterHref : undefined
              }
              items={toc}
              onSelect={(href) => {
                void goToChapter(href);
              }}
            />
          </aside>
        ) : null}

        <main className="relative min-w-0 flex-1">
          <section
            aria-label={t('reader.content', {
              format: bookFormatLabels[book?.format ?? 'epub'],
            })}
            className="reader-render-host bg-surface h-full"
            ref={hostRef}
          />

          <SelectionToolbar
            onCreate={async (color) => {
              await createHighlight(color);
              showRightSidebar('annotations');
            }}
            onLookup={() => {
              if (!selection) return;
              setLookupText(selection.text);
              showRightSidebar('dictionary');
            }}
            onOpenAi={openAiAssistant}
            selection={selection}
            speech={
              speech.available
                ? {
                    speaking: speech.speaking,
                    onToggle: () => {
                      if (speech.speaking) speech.stop();
                      else if (selection) void speech.speak(selection.text);
                    },
                  }
                : undefined
            }
          />

          {isChapterSearchOpen ? (
            <ReaderChapterSearch
              scope={book?.format === 'pdf' ? 'book' : 'chapter'}
              onClose={() => {
                clearChapterSearch();
                setIsChapterSearchOpen(false);
              }}
              onSearch={searchCurrentChapter}
              onSelect={(result) => {
                void goToLocator(result.locator);
              }}
            />
          ) : null}

          {phase === 'loading' ? (
            <div
              aria-live="polite"
              className="bg-background/90 absolute inset-0 grid place-items-center text-sm"
            >
              {t('reader.opening')}
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="bg-background absolute inset-0 grid place-items-center p-8">
              <EmptyState
                action={
                  <div className="flex gap-2">
                    <Button asChild variant="secondary">
                      <Link to="/library">{t('reader.backToLibrary')}</Link>
                    </Button>
                    <Button onClick={retry}>
                      <RotateCcw aria-hidden="true" size={16} />
                      {t('common.retry')}
                    </Button>
                  </div>
                }
                description={error ?? t('reader.openFailedDescription')}
                icon={<RotateCcw size={28} />}
                title={t('reader.openFailedTitle')}
              />
            </div>
          ) : null}

          {navigationError ? (
            <div
              className="border-destructive/30 bg-background text-destructive absolute top-3 left-1/2 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow"
              role="alert"
            >
              {navigationError}
            </div>
          ) : null}

          {persistenceError ? (
            <div
              className="border-destructive/30 bg-background text-destructive absolute top-3 left-1/2 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow"
              role="alert"
            >
              {persistenceError}
            </div>
          ) : null}

          {annotationError ? (
            <div
              className="border-destructive/30 bg-background text-destructive absolute top-16 left-1/2 z-20 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow"
              role="alert"
            >
              {annotationError}
            </div>
          ) : null}

          {atEnd && nextVolume ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4">
              <section
                aria-label={t('reader.nextVolumeLabel')}
                className="bg-surface pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow"
              >
                <span className="min-w-0 truncate">
                  {t('reader.nextVolume', { title: nextVolume.title })}
                </span>
                <Button
                  onClick={() => {
                    void navigate(
                      `/reader/${encodeURIComponent(nextVolume.id)}`,
                    );
                  }}
                  size="sm"
                >
                  {t('reader.openNextVolume')}
                </Button>
              </section>
            </div>
          ) : null}
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-4 flex justify-center gap-2 transition-opacity',
              phase === 'ready' ? 'opacity-100' : 'opacity-0',
            )}
          >
            <IconButton
              className="pointer-events-auto shadow"
              icon={<ChevronLeft aria-hidden="true" size={19} />}
              label={t('reader.previousPage')}
              onClick={() => {
                void previousPage();
              }}
              variant="secondary"
            />
            <IconButton
              className="pointer-events-auto shadow"
              icon={<ChevronRight aria-hidden="true" size={19} />}
              label={t('reader.nextPage')}
              onClick={() => {
                void nextPage();
              }}
              variant="secondary"
            />
          </div>
        </main>

        {isAnnotationSidebarOpen ? (
          <AnnotationSidebar
            activeId={activeAnnotationId}
            annotations={annotations}
            onSelect={(annotationId) => {
              void navigateToAnnotation(annotationId);
            }}
            onExport={async (format) => {
              if (!book) return;
              const platform =
                services.exportPlatform ?? readerServices.exportPlatform;
              if (!platform) throw new Error('Export platform is unavailable.');
              await new AnnotationExportService(platform).exportBook(
                book,
                annotations,
                format,
              );
            }}
            unresolvedIds={unresolvedAnnotationIds}
          />
        ) : null}
        {isBookmarkSidebarOpen ? (
          <ReaderBookmarkSidebar
            bookmarks={bookmarks}
            onCreate={createBookmark}
            onDelete={deleteBookmark}
            onRename={renameBookmark}
            onSelect={(bookmark) => {
              void navigateToBookmark(bookmark);
            }}
          />
        ) : null}
        {book && isAiAssistantOpen ? (
          <AiSelectionAssistant
            book={book}
            bookId={book.id}
            bookTitle={book.title}
            facade={agentFacade}
            onClose={closeAiAssistant}
            onNavigate={(target) => {
              void goToLocator(target);
            }}
            onCreateNote={async (draft: AiDraft) => {
              if (!services.noteRepository) {
                throw new Error('Note repository is unavailable.');
              }
              const note = await new NoteService(
                services.noteRepository,
              ).createFromPlainText(draft.title, draft.content);
              await navigate(`/notes?noteId=${encodeURIComponent(note.id)}`);
            }}
            selection={
              selection ?? (aiSelectionBookId === bookId ? aiSelection : null)
            }
          />
        ) : null}
        {rightSidebar === 'dictionary' && lookupText ? (
          <DictionaryPanel
            canSpeak={speech.available}
            dictionary={dictionary.dictionary}
            onClose={() => {
              showRightSidebar(null);
            }}
            onSpeak={(text) => void speech.speak(text)}
            text={lookupText}
          />
        ) : null}
      </div>

      {activeAnnotation ? (
        <AnnotationPopover
          annotation={activeAnnotation}
          key={activeAnnotation.id}
          onClose={() => {
            setActiveAnnotationId(null);
          }}
          onDelete={deleteAnnotation}
          onInsertIntoNote={async (annotationId) => {
            const note = await insertAnnotationIntoNote(annotationId);
            await navigate(`/notes?noteId=${encodeURIComponent(note.id)}`);
          }}
          onSave={updateAnnotationNote}
        />
      ) : null}
    </div>
  );
}

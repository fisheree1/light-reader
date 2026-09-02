import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Highlighter,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import { cn } from '../../lib/cn';
import { AnnotationPopover } from '../annotations/components/annotation-popover';
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

interface ReaderPageProps {
  services?: ReaderServices;
}

function isEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input, textarea, select, button, a'))
  );
}

export function ReaderPage({ services = readerServices }: ReaderPageProps) {
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
  const [isTocOpen, setIsTocOpen] = useState(true);
  const [isAnnotationSidebarOpen, setIsAnnotationSidebarOpen] = useState(true);
  const [isBookmarkSidebarOpen, setIsBookmarkSidebarOpen] = useState(false);
  const [isChapterSearchOpen, setIsChapterSearchOpen] = useState(false);
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

  const progress = Math.round((locator.progression ?? 0) * 100);

  return (
    <div className="bg-background text-foreground flex h-screen min-h-[32rem] flex-col overflow-hidden">
      <header className="bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/library">
            <ArrowLeft aria-hidden="true" size={16} />
            返回书架
          </Link>
        </Button>
        <IconButton
          aria-pressed={isTocOpen}
          icon={<ListTree aria-hidden="true" size={17} />}
          label={isTocOpen ? '隐藏目录' : '显示目录'}
          onClick={() => {
            setIsTocOpen((current) => !current);
          }}
          variant="ghost"
        />
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-sm font-semibold">
            {book?.title ?? '正在打开 EPUB…'}
          </h1>
          {book ? (
            <p className="text-muted-foreground truncate text-xs">
              {book.author ?? '未知作者'}
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
          label={isChapterSearchOpen ? '关闭章节内查找' : '章节内查找'}
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
          label={isBookmarkSidebarOpen ? '隐藏书签' : '显示书签'}
          onClick={() => {
            setIsBookmarkSidebarOpen((current) => !current);
          }}
          variant="ghost"
        />
        <IconButton
          aria-pressed={isAnnotationSidebarOpen}
          icon={<Highlighter aria-hidden="true" size={17} />}
          label={isAnnotationSidebarOpen ? '隐藏高亮与批注' : '显示高亮与批注'}
          onClick={() => {
            setIsAnnotationSidebarOpen((current) => !current);
          }}
          variant="ghost"
        />
        <span
          aria-label={`阅读进度 ${String(progress)}%`}
          className="text-muted-foreground w-12 text-right text-xs tabular-nums"
        >
          {progress}%
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {isTocOpen ? (
          <aside className="bg-surface w-64 shrink-0 overflow-auto border-r p-3">
            <h2 className="mb-3 px-2 text-sm font-semibold">目录</h2>
            <ReaderTableOfContents
              currentHref={locator.chapterHref}
              items={toc}
              onSelect={(href) => {
                void goToChapter(href);
              }}
            />
          </aside>
        ) : null}

        <main className="relative min-w-0 flex-1">
          <section
            aria-label="EPUB 正文"
            className="reader-render-host bg-surface h-full"
            ref={hostRef}
          />

          <SelectionToolbar onCreate={createHighlight} selection={selection} />

          {isChapterSearchOpen ? (
            <ReaderChapterSearch
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
              正在打开 EPUB…
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="bg-background absolute inset-0 grid place-items-center p-8">
              <EmptyState
                action={
                  <div className="flex gap-2">
                    <Button asChild variant="secondary">
                      <Link to="/library">返回书架</Link>
                    </Button>
                    <Button onClick={retry}>
                      <RotateCcw aria-hidden="true" size={16} />
                      重试
                    </Button>
                  </div>
                }
                description={error ?? '无法打开这本 EPUB。'}
                icon={<RotateCcw size={28} />}
                title="无法打开图书"
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

          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-4 flex justify-center gap-2 transition-opacity',
              phase === 'ready' ? 'opacity-100' : 'opacity-0',
            )}
          >
            <IconButton
              className="pointer-events-auto shadow"
              icon={<ChevronLeft aria-hidden="true" size={19} />}
              label="上一页"
              onClick={() => {
                void previousPage();
              }}
              variant="secondary"
            />
            <IconButton
              className="pointer-events-auto shadow"
              icon={<ChevronRight aria-hidden="true" size={19} />}
              label="下一页"
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

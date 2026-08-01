import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ListTree,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import { cn } from '../../lib/cn';
import { ReaderTableOfContents } from './components/reader-table-of-contents';
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
  const {
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
  } = useReader(bookId, services);
  const [isTocOpen, setIsTocOpen] = useState(true);

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
      </div>
    </div>
  );
}

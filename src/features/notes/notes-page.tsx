import { FilePlus2, NotebookPen, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { NoteEditor } from './components/note-editor';
import type { BookQuoteReference } from './domain/note';
import { useNotes } from './hooks/use-notes';
import { notesServices, type NotesServices } from './services/notes-services';

interface NotesPageProps {
  services?: NotesServices;
}

export function NotesPage({ services = notesServices }: NotesPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNoteId = searchParams.get('noteId');
  const {
    activeNote,
    createNote,
    deleteActiveNote,
    load,
    loading,
    loadError,
    mutationError,
    query,
    retrySave,
    saveStatus,
    selectNote,
    setQuery,
    updateDraft,
    visibleNotes,
  } = useNotes(services, requestedNoteId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});
  const [bookTitlesReady, setBookTitlesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void services.bookRepository.list().then(
      (books) => {
        if (!cancelled) {
          setBookTitles(
            Object.fromEntries(books.map((book) => [book.id, book.title])),
          );
          setBookTitlesReady(true);
        }
      },
      () => {
        if (!cancelled) setBookTitlesReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [services.bookRepository]);

  const resolveBookTitle = useCallback(
    (bookId: string) => bookTitles[bookId] ?? '未知书籍',
    [bookTitles],
  );
  const navigateToReference = useCallback(
    (reference: BookQuoteReference) => {
      void navigate(`/reader/${encodeURIComponent(reference.bookId)}`, {
        state: {
          readerNavigation: {
            annotationId: reference.annotationId,
            locator: reference.locator,
          },
        },
      });
    },
    [navigate],
  );

  if (loading) {
    return <p aria-live="polite">正在加载笔记…</p>;
  }

  if (loadError) {
    return (
      <EmptyState
        action={<Button onClick={() => void load()}>重试</Button>}
        description={loadError}
        icon={<NotebookPen size={28} />}
        title="无法加载笔记"
      />
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">笔记</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            用结构化笔记整理阅读想法和原文引用。
          </p>
        </div>
        <Button onClick={() => void createNote()}>
          <FilePlus2 aria-hidden="true" size={16} />
          新建笔记
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border lg:flex">
        <aside className="bg-surface flex w-full shrink-0 flex-col border-b lg:w-72 lg:border-r lg:border-b-0">
          <label className="relative m-3 block">
            <span className="sr-only">搜索笔记标题</span>
            <Search
              aria-hidden="true"
              className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              size={15}
            />
            <input
              aria-label="搜索笔记标题"
              className="bg-background h-9 w-full rounded-md border pr-3 pl-9 text-sm"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="搜索标题"
              type="search"
              value={query}
            />
          </label>

          <div className="max-h-56 flex-1 overflow-auto border-t lg:max-h-none">
            {visibleNotes.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">
                {query ? '没有匹配的笔记。' : '还没有笔记。'}
              </p>
            ) : (
              <ol className="space-y-1 p-2">
                {visibleNotes.map((note) => (
                  <li key={note.id}>
                    <button
                      aria-current={
                        activeNote?.id === note.id ? 'page' : undefined
                      }
                      className={cn(
                        'hover:bg-muted focus-visible:bg-muted w-full rounded-md px-3 py-2 text-left',
                        activeNote?.id === note.id && 'bg-muted',
                      )}
                      onClick={() => void selectNote(note.id)}
                      type="button"
                    >
                      <span className="block truncate text-sm font-medium">
                        {note.title}
                      </span>
                      <span className="text-muted-foreground mt-1 block truncate text-xs">
                        {note.plainText || '空白笔记'}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>

        <main className="bg-surface flex min-h-[36rem] min-w-0 flex-1 flex-col p-4">
          {activeNote ? (
            <>
              <div className="mb-3 flex items-center gap-3">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">笔记标题</span>
                  <input
                    aria-label="笔记标题"
                    className="focus-visible:ring-primary w-full truncate border-0 bg-transparent px-1 text-xl font-semibold outline-none focus-visible:ring-2"
                    maxLength={500}
                    onChange={(event) => {
                      updateDraft({ title: event.currentTarget.value });
                    }}
                    value={activeNote.title}
                  />
                </label>
                <span
                  aria-live="polite"
                  className={cn(
                    'text-muted-foreground text-xs',
                    saveStatus === 'error' && 'text-destructive',
                  )}
                >
                  {saveStatus === 'saving' ? '保存中…' : null}
                  {saveStatus === 'saved' ? '已保存' : null}
                  {saveStatus === 'error' ? '保存失败，内容已保留' : null}
                </span>
                {saveStatus === 'error' ? (
                  <Button
                    onClick={() => void retrySave()}
                    size="sm"
                    variant="secondary"
                  >
                    重试保存
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    void deleteActiveNote().then((deleted) => {
                      if (deleted) setConfirmDelete(false);
                    });
                  }}
                  size="sm"
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {confirmDelete ? '确认删除' : '删除笔记'}
                </Button>
              </div>

              {mutationError ? (
                <p className="text-destructive mb-3 text-sm" role="alert">
                  {mutationError}
                </p>
              ) : null}

              {bookTitlesReady ? (
                <NoteEditor
                  key={activeNote.id}
                  note={activeNote}
                  onChange={(document) => {
                    updateDraft({ document });
                  }}
                  onFlush={() => {
                    void retrySave();
                  }}
                  onNavigate={navigateToReference}
                  resolveBookTitle={resolveBookTitle}
                />
              ) : (
                <p aria-live="polite">正在准备编辑器…</p>
              )}
            </>
          ) : (
            <EmptyState
              className="h-full"
              description="创建一条独立笔记，或在阅读器中把高亮引用到新笔记。"
              icon={<NotebookPen size={28} />}
              title="暂无笔记"
            />
          )}
        </main>
      </div>
    </div>
  );
}

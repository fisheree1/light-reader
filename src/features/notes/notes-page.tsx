import {
  ChevronDown,
  Download,
  FilePlus2,
  NotebookPen,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { NoteEditor } from './components/note-editor';
import type { BookQuoteReference } from './domain/note';
import { useNotes } from './hooks/use-notes';
import { notesServices, type NotesServices } from './services/notes-services';
import {
  NoteExportService,
  type NoteExportFormat,
} from './services/note-export-service';
import { useI18n } from '../../i18n/use-i18n';

interface NotesPageProps {
  services?: NotesServices;
}

export function NotesPage({ services = notesServices }: NotesPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNoteId = searchParams.get('noteId');
  const {
    activeNote,
    createNote,
    deleteActiveNote,
    hasNotes,
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
  const [exportStatus, setExportStatus] = useState('');
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const exportService = useMemo(() => {
    const platform = services.exportPlatform ?? notesServices.exportPlatform;
    if (!platform) throw new Error('Note export platform is unavailable.');
    return new NoteExportService(
      services.noteRepository,
      services.bookRepository,
      platform,
    );
  }, [services]);

  async function runExport(scope: 'all' | 'one', format: NoteExportFormat) {
    if (scope === 'one' && !activeNote) return;
    setExportStatus(t('notes.exporting'));
    try {
      if (scope === 'one' && activeNote) {
        await exportService.exportOne(activeNote, format);
      } else {
        await exportService.exportAll(format);
      }
      setExportStatus(t('notes.exported'));
    } catch {
      setExportStatus(t('notes.exportFailed'));
    }
  }

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
    (bookId: string) => bookTitles[bookId] ?? t('common.unknownBook'),
    [bookTitles, t],
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
    return <p aria-live="polite">{t('notes.loading')}</p>;
  }

  if (loadError) {
    return (
      <EmptyState
        action={
          <Button onClick={() => void load()}>{t('common.retry')}</Button>
        }
        description={loadError}
        icon={<NotebookPen size={28} />}
        title={t('notes.loadFailed')}
      />
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('notes.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('notes.description')}
          </p>
        </div>
        {hasNotes ? (
          <div className="flex items-center gap-2">
            <details
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  event.currentTarget.open = false;
                }
              }}
              ref={exportMenuRef}
            >
              <summary
                aria-label={t('notes.export')}
                className="bg-muted text-foreground hover:bg-border inline-flex h-8 cursor-pointer list-none items-center justify-center gap-2 rounded-md px-3 text-xs font-medium transition-colors [&::-webkit-details-marker]:hidden"
                role="button"
              >
                <Download aria-hidden="true" size={15} />
                {t('notes.export')}
                <ChevronDown aria-hidden="true" size={14} />
              </summary>
              <div className="bg-surface absolute top-full right-0 z-50 mt-1.5 min-w-52 rounded-lg border p-1 shadow-lg">
                <p className="text-muted-foreground px-2 py-1.5 text-xs">
                  {t('notes.currentNote')}
                </p>
                {(['markdown', 'html'] as const).map((format) => (
                  <button
                    className="hover:bg-muted focus-visible:bg-muted w-full rounded-md px-2 py-2 text-left text-sm outline-none disabled:opacity-50"
                    disabled={!activeNote}
                    key={`one-${format}`}
                    onClick={() => {
                      exportMenuRef.current?.removeAttribute('open');
                      void runExport('one', format);
                    }}
                    type="button"
                  >
                    {t('notes.exportAs', {
                      format: format === 'markdown' ? 'Markdown' : 'HTML',
                    })}
                  </button>
                ))}
                <div className="bg-border my-1 h-px" />
                <p className="text-muted-foreground px-2 py-1.5 text-xs">
                  {t('notes.allNotes')}
                </p>
                {(['markdown', 'html'] as const).map((format) => (
                  <button
                    className="hover:bg-muted focus-visible:bg-muted w-full rounded-md px-2 py-2 text-left text-sm outline-none"
                    key={`all-${format}`}
                    onClick={() => {
                      exportMenuRef.current?.removeAttribute('open');
                      void runExport('all', format);
                    }}
                    type="button"
                  >
                    {t('notes.exportAllAs', {
                      format: format === 'markdown' ? 'Markdown' : 'HTML',
                    })}
                  </button>
                ))}
              </div>
            </details>
            <Button onClick={() => void createNote()}>
              <FilePlus2 aria-hidden="true" size={16} />
              {t('notes.newNote')}
            </Button>
          </div>
        ) : null}
      </header>

      {exportStatus ? (
        <p
          aria-live="polite"
          className="text-muted-foreground mb-3 text-right text-xs"
        >
          {exportStatus}
        </p>
      ) : null}

      {!hasNotes ? (
        <EmptyState
          action={
            <Button onClick={() => void createNote()}>
              <FilePlus2 aria-hidden="true" size={16} />
              {t('notes.newNote')}
            </Button>
          }
          className="min-h-[28rem] flex-1"
          description={t('notes.emptyDescription')}
          icon={<NotebookPen size={28} />}
          title={t('notes.emptyTitle')}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border lg:flex">
          <aside className="bg-surface flex w-full shrink-0 flex-col border-b lg:w-72 lg:border-r lg:border-b-0">
            <label className="relative m-3 block">
              <span className="sr-only">{t('notes.searchTitles')}</span>
              <Search
                aria-hidden="true"
                className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
                size={15}
              />
              <input
                aria-label={t('notes.searchTitles')}
                className="bg-background h-9 w-full rounded-md border pr-3 pl-9 text-sm"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                placeholder={t('notes.searchPlaceholder')}
                type="search"
                value={query}
              />
            </label>

            <div className="max-h-56 flex-1 overflow-auto border-t lg:max-h-none">
              {visibleNotes.length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">
                  {query ? t('notes.noMatches') : t('notes.noNotes')}
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
                          {note.plainText || t('notes.blankNote')}
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
                    <span className="sr-only">{t('notes.noteTitle')}</span>
                    <input
                      aria-label={t('notes.noteTitle')}
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
                    {saveStatus === 'saving' ? t('common.saving') : null}
                    {saveStatus === 'saved' ? t('notes.saved') : null}
                    {saveStatus === 'error' ? t('notes.saveFailed') : null}
                  </span>
                  {saveStatus === 'error' ? (
                    <Button
                      onClick={() => void retrySave()}
                      size="sm"
                      variant="secondary"
                    >
                      {t('notes.retrySave')}
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
                    {confirmDelete
                      ? t('notes.confirmDelete')
                      : t('notes.deleteNote')}
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
                  <p aria-live="polite">{t('notes.preparingEditor')}</p>
                )}
              </>
            ) : (
              <EmptyState
                className="h-full"
                description={t('notes.noSelectionDescription')}
                icon={<NotebookPen size={28} />}
                title={t('notes.noSelectionTitle')}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

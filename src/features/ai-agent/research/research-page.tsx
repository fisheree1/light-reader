import { BookOpenText, Search, Square, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../../components/ui/button';
import { asAppError } from '../../../lib/app-error';
import type { Book } from '../../library/domain/book';
import type { AiDraft } from '../domain/agent';
import { researchServices, type ResearchServices } from './research-services';
import { useI18n } from '../../../i18n/use-i18n';

interface ResearchPageProps {
  services?: ResearchServices;
}

export function ResearchPage({
  services = researchServices,
}: ResearchPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const controller = useRef<AbortController | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [status, setStatus] = useState(() => t('research.initial'));
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    services
      .listBooks()
      .then((items) => {
        if (active) setBooks(items);
      })
      .catch((value: unknown) => {
        if (active)
          setError(asAppError(value, 'DATABASE_READ_FAILED').userMessage);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [services]);

  const toggleBook = (bookId: string) => {
    setSelectedIds((current) =>
      current.includes(bookId)
        ? current.filter((id) => id !== bookId)
        : current.length < 8
          ? [...current, bookId]
          : current,
    );
  };

  const run = async () => {
    const selected = books.filter((book) => selectedIds.includes(book.id));
    if (selected.length < 2 || !question.trim()) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setRunning(true);
    setDraft(null);
    setError(null);
    setStatus(t('research.expanding'));
    try {
      const result = await services.agent.runResearch(
        selected,
        question,
        nextController.signal,
        (event) => {
          if (event.type === 'retrieval-progress') {
            setStatus(t('research.retrieving'));
          } else if (event.type === 'output-delta') {
            setStatus(t('research.drafting'));
          }
        },
      );
      setDraft(result.draft);
      setStatus(t('research.done', { count: result.draft.citations.length }));
    } catch (value) {
      const appError = asAppError(value, 'AI_REQUEST_FAILED');
      if (appError.code !== 'USER_CANCELLED') setError(appError.userMessage);
      setStatus(
        appError.code === 'USER_CANCELLED'
          ? t('research.stopped')
          : t('research.incomplete'),
      );
    } finally {
      setRunning(false);
      if (controller.current === nextController) controller.current = null;
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles aria-hidden="true" size={22} />
          {t('research.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('research.description')}
        </p>
      </header>

      <section
        aria-labelledby="research-scope"
        className="bg-surface rounded-lg border p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="research-scope" className="text-sm font-semibold">
            {t('research.scope')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t('research.selected', { count: selectedIds.length })}
          </span>
        </div>
        {books.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('research.needBooks')}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {books.map((book) => (
              <label
                key={book.id}
                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <input
                  checked={selectedIds.includes(book.id)}
                  disabled={
                    !selectedIds.includes(book.id) && selectedIds.length >= 8
                  }
                  onChange={() => {
                    toggleBook(book.id);
                  }}
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate">{book.title}</span>
                <span className="text-muted-foreground text-xs">
                  {book.format.toUpperCase()}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="research-question" className="mt-4">
        <label
          className="text-sm font-semibold"
          id="research-question"
          htmlFor="research-question-input"
        >
          {t('research.question')}
        </label>
        <textarea
          className="bg-surface mt-2 min-h-28 w-full resize-y rounded-lg border p-3 text-sm"
          id="research-question-input"
          maxLength={1000}
          onChange={(event) => {
            setQuestion(event.currentTarget.value);
          }}
          placeholder={t('research.questionPlaceholder')}
          value={question}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button
            disabled={
              running || selectedIds.length < 2 || question.trim().length < 2
            }
            onClick={() => void run()}
            type="button"
          >
            <Search aria-hidden="true" size={16} />
            {t('research.start')}
          </Button>
          {running ? (
            <Button
              onClick={() => controller.current?.abort()}
              type="button"
              variant="ghost"
            >
              <Square aria-hidden="true" size={14} />
              {t('research.stop')}
            </Button>
          ) : null}
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {status}
          </p>
        </div>
      </section>

      {error ? (
        <p
          className="border-destructive/30 bg-destructive/10 text-destructive mt-5 rounded-md border p-3 text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {draft ? (
        <section
          aria-labelledby="research-draft"
          className="bg-surface mt-6 rounded-lg border p-5"
        >
          <h2 id="research-draft" className="text-lg font-semibold">
            {t('research.draft')}
          </h2>
          <div className="mt-3 text-sm leading-7 whitespace-pre-wrap">
            {draft.content}
          </div>
          <h3 className="mt-6 text-sm font-semibold">
            {t('research.sources')}
          </h3>
          <ol className="mt-2 grid gap-2">
            {draft.citations.map((citation, index) => (
              <li key={citation.id}>
                <button
                  className="hover:bg-muted w-full rounded-md border p-3 text-left text-sm"
                  onClick={() =>
                    void navigate(
                      `/reader/${encodeURIComponent(citation.bookId)}`,
                      {
                        state: {
                          readerNavigation: { locator: citation.locator },
                        },
                      },
                    )
                  }
                  type="button"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <BookOpenText aria-hidden="true" size={15} />
                    [S{index + 1}] {citation.bookTitleSnapshot}
                  </span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 block">
                    {citation.chapterTitleSnapshot ??
                      t('research.untitledPlace')}{' '}
                    · {citation.quote}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

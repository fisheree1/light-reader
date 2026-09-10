import { BookOpenText, Search, Square, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../../components/ui/button';
import { asAppError } from '../../../lib/app-error';
import type { Book } from '../../library/domain/book';
import type { AiDraft } from '../domain/agent';
import { researchServices, type ResearchServices } from './research-services';

interface ResearchPageProps {
  services?: ResearchServices;
}

export function ResearchPage({
  services = researchServices,
}: ResearchPageProps) {
  const navigate = useNavigate();
  const controller = useRef<AbortController | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [status, setStatus] = useState(
    '选择 2 至 8 本书，然后提出一个比较或研究问题。',
  );
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
    setStatus('正在用本地模型扩展查询并建立图书索引…');
    try {
      const result = await services.agent.runResearch(
        selected,
        question,
        nextController.signal,
        (event) => {
          if (event.type === 'retrieval-progress') {
            setStatus('正在检索所选图书的本地正文…');
          } else if (event.type === 'output-delta') {
            setStatus('正在生成带来源的研究草稿…');
          }
        },
      );
      setDraft(result.draft);
      setStatus(
        `研究完成，共引用 ${String(result.draft.citations.length)} 个来源。`,
      );
    } catch (value) {
      const appError = asAppError(value, 'AI_REQUEST_FAILED');
      if (appError.code !== 'USER_CANCELLED') setError(appError.userMessage);
      setStatus(
        appError.code === 'USER_CANCELLED'
          ? '已停止本次研究。'
          : '研究未完成。',
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
          跨书研究
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          仅把你明确选择的图书片段发送给本机
          Ollama；查询扩展用于提高召回率，不等同于向量检索。
        </p>
      </header>

      <section
        aria-labelledby="research-scope"
        className="bg-surface rounded-lg border p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="research-scope" className="text-sm font-semibold">
            研究范围
          </h2>
          <span className="text-muted-foreground text-xs">
            已选 {selectedIds.length}/8
          </span>
        </div>
        {books.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            请先导入至少两本可提取正文的 EPUB 或 PDF。
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
          研究问题
        </label>
        <textarea
          className="bg-surface mt-2 min-h-28 w-full resize-y rounded-lg border p-3 text-sm"
          id="research-question-input"
          maxLength={1000}
          onChange={(event) => {
            setQuestion(event.currentTarget.value);
          }}
          placeholder="例如：比较这些书对离线阅读与隐私的观点，并指出共同点和分歧。"
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
            开始研究
          </Button>
          {running ? (
            <Button
              onClick={() => controller.current?.abort()}
              type="button"
              variant="ghost"
            >
              <Square aria-hidden="true" size={14} />
              停止
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
            研究草稿
          </h2>
          <div className="mt-3 text-sm leading-7 whitespace-pre-wrap">
            {draft.content}
          </div>
          <h3 className="mt-6 text-sm font-semibold">可验证来源</h3>
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
                    {citation.chapterTitleSnapshot ?? '未命名位置'} ·{' '}
                    {citation.quote}
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

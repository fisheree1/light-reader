import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { asAppError } from '../../../lib/app-error';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { Book } from '../../library/domain/book';
import type { BookLocator } from '../../../reader-engines/types';
import type { AiSettings } from '../domain/ai-settings';
import {
  selectionAiActionLabels,
  type AiDraft,
  type SelectionAiAction,
} from '../domain/agent';
import type { AgentFacade } from '../services/agent-facade';
import type { BookQaEvent } from '../services/book-qa-runner';
import {
  agentToolTraceEntrySchema,
  type AgentToolTraceEntry,
} from '../domain/agent-tool';
import type { BookIndexingProgress } from '../retrieval/book-indexing';
import { detectSensitiveContent } from '../services/sensitive-content';
import {
  AiCancelledStatus,
  AiDraftResult,
  AiErrorStatus,
  AiRebuildingStatus,
  AiRunningStatus,
} from './ai-assistant-status';

type Stage =
  | 'loading'
  | 'disabled'
  | 'empty'
  | 'consent'
  | 'running'
  | 'rebuilding'
  | 'completed'
  | 'cancelled'
  | 'error';

interface AiSelectionAssistantProps {
  book?: Book;
  bookId: string;
  bookTitle: string;
  facade: AgentFacade;
  onCreateNote: (draft: AiDraft) => Promise<void>;
  onClose: () => void;
  onNavigate?: (locator: BookLocator) => void;
  selection: ReaderTextSelection | null;
}

export function AiSelectionAssistant({
  book,
  bookId,
  bookTitle,
  facade,
  onCreateNote,
  onClose,
  onNavigate,
  selection,
}: AiSelectionAssistantProps) {
  const [mode, setMode] = useState<'book' | 'selection'>(
    selection ? 'selection' : 'book',
  );
  const [action, setAction] = useState<SelectionAiAction>('summarize');
  const [stage, setStage] = useState<Stage>('loading');
  const [customInstruction, setCustomInstruction] = useState('');
  const [question, setQuestion] = useState('');
  const [text, setText] = useState(selection?.text ?? '');
  const [output, setOutput] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [progress, setProgress] = useState<BookIndexingProgress | null>(null);
  const [trace, setTrace] = useState<AgentToolTraceEntry[]>([]);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);
  const [cancelledOperation, setCancelledOperation] = useState<
    'answer' | 'rebuild'
  >('answer');
  const controllerRef = useRef<AbortController | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const warnings = useMemo(() => detectSensitiveContent(text), [text]);

  useEffect(() => {
    let cancelled = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    queueMicrotask(() => {
      if (cancelled) return;
      setAction('summarize');
      setMode(selection ? 'selection' : 'book');
      setCustomInstruction('');
      setText(selection?.text ?? '');
      setOutput('');
      setDraft(null);
      setError(null);
      setCopied(false);
      setSettings(null);
      setProgress(null);
      setTrace([]);
      setIndexNotice(null);
      setStage('loading');
    });
    facade.getSettings().then(
      (settings) => {
        if (!cancelled) {
          setSettings(settings);
          setStage(settings.enabled ? 'consent' : 'disabled');
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(asAppError(reason, 'AI_SETTINGS_READ_FAILED').userMessage);
          setStage('error');
        }
      },
    );
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [facade, selection]);

  const handleClose = useCallback(() => {
    controllerRef.current?.abort();
    onClose();
    queueMicrotask(() => {
      returnFocusRef.current?.focus();
    });
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"]')
      ) {
        return;
      }
      event.preventDefault();
      handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  async function send() {
    if (mode === 'selection' && !selection) {
      setStage('empty');
      return;
    }
    if (mode === 'book' && !book) {
      setError('当前图书信息不可用，请重新打开阅读页。');
      setStage('error');
      return;
    }
    setError(null);
    setOutput('');
    setDraft(null);
    setProgress(null);
    setTrace([]);
    setIndexNotice(null);
    setCancelledOperation('answer');
    try {
      const controller = new AbortController();
      controllerRef.current = controller;
      setStage('running');
      const handleEvent = (event: BookQaEvent) => {
        if (event.type === 'retrieval-progress') {
          setProgress(event.progress);
          return;
        }
        if (event.type === 'output-delta') {
          setOutput((current) => current + event.delta);
        }
      };
      const result =
        mode === 'book' && book
          ? await facade.runBookQuestion(
              book,
              question,
              controller.signal,
              handleEvent,
            )
          : await (async () => {
              if (!selection) throw new Error('Selection is unavailable.');
              const prepared = await facade.prepareSelection({
                action,
                bookId,
                bookTitle,
                instruction:
                  action === 'custom' ? customInstruction : undefined,
                selection,
              });
              return facade.runSelection(
                prepared,
                text,
                controller.signal,
                handleEvent,
              );
            })();
      controllerRef.current = null;
      setOutput(result.draft.content);
      setDraft(result.draft);
      if ('trace' in result) {
        setTrace(agentToolTraceEntrySchema.array().parse(result.trace));
      }
      setStage('completed');
    } catch (reason) {
      controllerRef.current = null;
      const appError = asAppError(reason, 'AI_REQUEST_FAILED');
      if (appError.code === 'USER_CANCELLED') {
        setStage('cancelled');
        setError(null);
      } else {
        setError(appError.userMessage);
        setStage(appError.code === 'AI_DISABLED' ? 'disabled' : 'error');
      }
    }
  }

  async function rebuildIndex() {
    if (!book) return;
    setError(null);
    setIndexNotice(null);
    setProgress(null);
    setCancelledOperation('rebuild');
    const controller = new AbortController();
    controllerRef.current = controller;
    setStage('rebuilding');
    try {
      await facade.rebuildBookIndex(book, controller.signal, setProgress);
      controllerRef.current = null;
      setIndexNotice('本书 AI 索引已重新建立。');
      setStage('consent');
    } catch (reason) {
      controllerRef.current = null;
      const appError = asAppError(reason, 'SEARCH_INDEX_FAILED');
      if (appError.code === 'USER_CANCELLED') {
        setStage('cancelled');
        setError(null);
      } else {
        setError(appError.userMessage);
        setStage('error');
      }
    }
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.content);
    setCopied(true);
  }

  async function createNote() {
    if (!draft) return;
    setIsCreatingNote(true);
    setError(null);
    try {
      await onCreateNote(draft);
      handleClose();
    } catch (reason) {
      setError(asAppError(reason, 'NOTE_WRITE_FAILED').userMessage);
    } finally {
      setIsCreatingNote(false);
    }
  }

  return (
    <aside
      aria-label="本地 AI 阅读助手"
      className="bg-surface w-80 shrink-0 overflow-auto border-l p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">本地 AI 阅读助手</h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            内容只发送到本机
            Ollama。模型不能访问文件、数据库或未展示的书籍内容。
          </p>
        </div>
        <IconButton
          icon={<X aria-hidden="true" size={17} />}
          label="关闭 AI 阅读助手"
          onClick={handleClose}
          variant="ghost"
        />
      </div>

      {stage === 'loading' ? (
        <p aria-live="polite" className="mt-6 text-sm">
          正在加载 AI 设置…
        </p>
      ) : null}

      {stage === 'disabled' ? (
        <div className="mt-6 rounded-md border p-4">
          <p className="font-medium">AI 助手尚未启用</p>
          <p className="text-muted-foreground mt-1 text-sm">
            请前往设置启用本地 AI，并确认 Ollama 与模型可用。
          </p>
        </div>
      ) : null}

      {stage === 'empty' ? (
        <div className="mt-6 rounded-md border p-4">
          <p className="font-medium">当前没有正文选区</p>
          <p className="text-muted-foreground mt-1 text-sm">
            你可以返回“本书问答”，或在 EPUB/PDF 中选中一段文字。
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setMode('book');
              setStage('consent');
            }}
          >
            返回本书问答
          </Button>
        </div>
      ) : null}

      {stage === 'consent' ? (
        <div className="mt-5 space-y-4">
          <div aria-label="AI 使用范围" className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                setMode('book');
              }}
              variant={mode === 'book' ? 'default' : 'secondary'}
            >
              本书问答
            </Button>
            <Button
              onClick={() => {
                setMode('selection');
              }}
              variant={mode === 'selection' ? 'default' : 'secondary'}
            >
              处理选区
            </Button>
          </div>

          <div className="rounded-md border p-3 text-sm">
            <p>
              <span className="font-medium">来源：</span>《{bookTitle}》
            </p>
            {mode === 'selection' && selection ? (
              <p className="text-muted-foreground mt-1">
                {selection.locator.format === 'pdf'
                  ? `PDF 第 ${String(selection.locator.pageIndex + 1)} 页`
                  : 'EPUB 当前选区'}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-1">
              Provider：Ollama（本机） · 模型：
              {settings?.model ?? '未配置'}
            </p>
          </div>

          {mode === 'book' ? (
            <>
              <label className="block text-sm font-medium">
                向本书提问
                <textarea
                  aria-label="向本书提问"
                  autoFocus
                  className="bg-background mt-2 min-h-32 w-full rounded-md border px-3 py-2 text-sm"
                  maxLength={1_000}
                  onChange={(event) => {
                    setQuestion(event.currentTarget.value);
                  }}
                  placeholder="例如：作者如何解释这个观点？请列出书中依据。"
                  value={question}
                />
              </label>
              <p className="text-muted-foreground text-xs leading-relaxed">
                将在本机为当前图书建立文本索引，只向本机模型发送最相关的少量片段。首次使用可能需要稍等；扫描版
                PDF 暂不支持。
              </p>
              {indexNotice ? (
                <p className="text-sm" role="status">
                  {indexNotice}
                </p>
              ) : null}
              <Button
                onClick={() => {
                  void rebuildIndex();
                }}
                variant="secondary"
              >
                重建本书 AI 索引
              </Button>
            </>
          ) : selection ? (
            <>
              <label className="block text-sm font-medium">
                任务
                <select
                  className="bg-background mt-2 w-full rounded-md border px-3 py-2"
                  onChange={(event) => {
                    setAction(event.currentTarget.value as SelectionAiAction);
                  }}
                  value={action}
                >
                  {Object.entries(selectionAiActionLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              {action === 'custom' ? (
                <label className="block text-sm font-medium">
                  自定义需求
                  <textarea
                    aria-label="自定义需求"
                    autoFocus
                    className="bg-background mt-2 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
                    maxLength={1_000}
                    onChange={(event) => {
                      setCustomInstruction(event.currentTarget.value);
                    }}
                    placeholder="例如：分析作者的论证漏洞，并用三个要点回答。"
                    value={customInstruction}
                  />
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {String(customInstruction.length)} / 1000 个字符
                  </span>
                </label>
              ) : null}

              <label className="block text-sm font-medium">
                将发送的准确文本
                <textarea
                  className="bg-background mt-2 min-h-40 w-full rounded-md border px-3 py-2 font-mono text-sm"
                  maxLength={12_000}
                  onChange={(event) => {
                    setText(event.currentTarget.value);
                  }}
                  value={text}
                />
              </label>
              <p className="text-muted-foreground text-xs">
                {String(text.length)} / 12000
                个字符。你可以先编辑或遮盖敏感内容。
              </p>

              {warnings.length ? (
                <div
                  className="border-destructive/40 rounded-md border p-3 text-sm"
                  role="alert"
                >
                  <p className="font-medium">发送前请检查敏感内容</p>
                  <ul className="mt-1 list-disc pl-5">
                    {warnings.map((warning) => (
                      <li key={warning.kind}>{warning.label}</li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground mt-1 text-xs">
                    本地检测可能遗漏内容；请自行确认后再发送。
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-md border p-3 text-sm">
              当前没有正文选区。请先在阅读区选择文字，或使用“本书问答”。
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={handleClose} variant="secondary">
              取消
            </Button>
            <Button
              disabled={
                mode === 'book'
                  ? question.trim().length < 2
                  : !selection ||
                    !text.trim() ||
                    (action === 'custom' && !customInstruction.trim())
              }
              onClick={() => void send()}
            >
              {mode === 'book' ? '检索本书并提问' : '发送给本地模型'}
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'running' ? (
        <AiRunningStatus
          mode={mode}
          onCancel={() => {
            controllerRef.current?.abort();
            setOutput('');
            setStage('cancelled');
          }}
          output={output}
          progress={progress}
        />
      ) : null}

      {stage === 'rebuilding' ? (
        <AiRebuildingStatus
          onCancel={() => controllerRef.current?.abort()}
          progress={progress}
        />
      ) : null}

      {stage === 'cancelled' ? (
        <AiCancelledStatus
          onRestart={() => {
            setStage(mode === 'selection' && !selection ? 'empty' : 'consent');
          }}
          operation={cancelledOperation}
        />
      ) : null}

      {stage === 'completed' && draft ? (
        <AiDraftResult
          bookTitle={bookTitle}
          copied={copied}
          draft={draft}
          isCreatingNote={isCreatingNote}
          onClose={handleClose}
          onCopy={() => void copyDraft()}
          onCreateNote={() => void createNote()}
          onNavigate={onNavigate}
          trace={trace}
        />
      ) : null}

      {stage === 'error' ? (
        <AiErrorStatus
          error={error}
          onBack={() => {
            setStage(mode === 'selection' && !selection ? 'empty' : 'consent');
          }}
        />
      ) : null}

      {error && stage !== 'error' ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

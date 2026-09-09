import { Copy, FilePlus2, Square, X } from 'lucide-react';
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
import { detectSensitiveContent } from '../services/sensitive-content';

type Stage =
  | 'loading'
  | 'disabled'
  | 'empty'
  | 'consent'
  | 'running'
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
    try {
      const controller = new AbortController();
      controllerRef.current = controller;
      setStage('running');
      const handleEvent = (
        event: Parameters<
          NonNullable<Parameters<AgentFacade['runBookQuestion']>[3]>
        >[0],
      ) => {
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
        <div className="mt-5">
          <p aria-live="polite" className="text-sm font-medium">
            {mode === 'book'
              ? '正在检索本书并由本地模型生成…'
              : 'DeepSeek-R1 正在生成…'}
          </p>
          <pre className="bg-background mt-3 min-h-40 rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
            {output || '正在等待第一个结果…'}
          </pre>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => {
                controllerRef.current?.abort();
                setOutput('');
                setStage('cancelled');
              }}
              variant="secondary"
            >
              <Square aria-hidden="true" size={15} />
              停止生成
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'cancelled' ? (
        <div className="mt-5 rounded-md border p-4">
          <p className="font-medium">生成已取消</p>
          <p className="text-muted-foreground mt-1 text-sm">
            没有创建草稿或写入笔记。
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setStage(selection ? 'consent' : 'empty');
            }}
          >
            重新开始
          </Button>
        </div>
      ) : null}

      {stage === 'completed' && draft ? (
        <div className="mt-5">
          <p aria-live="polite" className="text-sm font-medium">
            已生成独立 AI 草稿
          </p>
          <pre className="bg-background mt-3 max-h-80 overflow-auto rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
            {draft.content}
          </pre>
          <p className="text-muted-foreground mt-2 text-xs">
            由本机 {draft.model} 生成。内容可能有误，请核对后使用。
          </p>
          {draft.citations.length ? (
            <div className="mt-4">
              <p className="text-xs font-medium">本地验证的依据</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {draft.citations.map((citation, index) => (
                  <Button
                    key={citation.id}
                    onClick={() => {
                      onNavigate?.(citation.locator);
                    }}
                    variant="secondary"
                  >
                    依据 {String(index + 1)} ·{' '}
                    {citation.locator.format === 'pdf'
                      ? `第 ${String(citation.locator.pageIndex + 1)} 页`
                      : (citation.chapterTitleSnapshot ?? '章节')}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                handleClose();
              }}
              variant="secondary"
            >
              丢弃
            </Button>
            <Button onClick={() => void copyDraft()} variant="secondary">
              <Copy aria-hidden="true" size={15} />
              {copied ? '已复制' : '复制'}
            </Button>
            <Button disabled={isCreatingNote} onClick={() => void createNote()}>
              <FilePlus2 aria-hidden="true" size={15} />
              {isCreatingNote ? '正在创建…' : '创建新笔记'}
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'error' ? (
        <div className="mt-5 rounded-md border p-4" role="alert">
          <p className="font-medium">无法完成生成</p>
          <p className="text-destructive mt-1 text-sm">{error}</p>
          <Button
            className="mt-4"
            onClick={() => {
              setStage(
                mode === 'selection' && !selection ? 'empty' : 'consent',
              );
            }}
          >
            返回发送预览
          </Button>
        </div>
      ) : null}

      {error && stage !== 'error' ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

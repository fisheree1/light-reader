import * as Dialog from '@radix-ui/react-dialog';
import { Copy, FilePlus2, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { asAppError } from '../../../lib/app-error';
import type { ReaderTextSelection } from '../../../reader-engines/types';
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
  | 'consent'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error';

interface AiSelectionAssistantProps {
  bookId: string;
  bookTitle: string;
  facade: AgentFacade;
  onCreateNote: (draft: AiDraft) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selection: ReaderTextSelection;
}

export function AiSelectionAssistant({
  bookId,
  bookTitle,
  facade,
  onCreateNote,
  onOpenChange,
  open,
  selection,
}: AiSelectionAssistantProps) {
  const [action, setAction] = useState<SelectionAiAction>('summarize');
  const [stage, setStage] = useState<Stage>('loading');
  const [text, setText] = useState(selection.text);
  const [output, setOutput] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const warnings = useMemo(() => detectSensitiveContent(text), [text]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    queueMicrotask(() => {
      if (cancelled) return;
      setAction('summarize');
      setText(selection.text);
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
    };
  }, [facade, open, selection]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) controllerRef.current?.abort();
    onOpenChange(nextOpen);
  }

  async function send() {
    setError(null);
    setOutput('');
    setDraft(null);
    try {
      const prepared = await facade.prepareSelection({
        action,
        bookId,
        bookTitle,
        selection,
      });
      const controller = new AbortController();
      controllerRef.current = controller;
      setStage('running');
      const result = await facade.runSelection(
        prepared,
        text,
        controller.signal,
        (event) => {
          if (event.type === 'output-delta') {
            setOutput((current) => current + event.delta);
          }
        },
      );
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
      handleOpenChange(false);
    } catch (reason) {
      setError(asAppError(reason, 'NOTE_WRITE_FAILED').userMessage);
    } finally {
      setIsCreatingNote(false);
    }
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="bg-surface fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border p-6 shadow-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">
                本地 AI 阅读助手
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                内容只发送到本机
                Ollama。模型不能访问文件、数据库或未展示的书籍内容。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton
                icon={<X aria-hidden="true" size={17} />}
                label="关闭 AI 阅读助手"
                variant="ghost"
              />
            </Dialog.Close>
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

          {stage === 'consent' ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium">来源：</span>《{bookTitle}》
                </p>
                <p className="text-muted-foreground mt-1">
                  {selection.locator.format === 'pdf'
                    ? `PDF 第 ${String(selection.locator.pageIndex + 1)} 页`
                    : 'EPUB 当前选区'}
                </p>
                <p className="text-muted-foreground mt-1">
                  Provider：Ollama（本机） · 模型：
                  {settings?.model ?? '未配置'}
                </p>
              </div>

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

              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="secondary">取消</Button>
                </Dialog.Close>
                <Button disabled={!text.trim()} onClick={() => void send()}>
                  发送给本地模型
                </Button>
              </div>
            </div>
          ) : null}

          {stage === 'running' ? (
            <div className="mt-5">
              <p aria-live="polite" className="text-sm font-medium">
                DeepSeek-R1 正在生成…
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
                  setStage('consent');
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
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => {
                    handleOpenChange(false);
                  }}
                  variant="secondary"
                >
                  丢弃
                </Button>
                <Button onClick={() => void copyDraft()} variant="secondary">
                  <Copy aria-hidden="true" size={15} />
                  {copied ? '已复制' : '复制'}
                </Button>
                <Button
                  disabled={isCreatingNote}
                  onClick={() => void createNote()}
                >
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
                  setStage('consent');
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

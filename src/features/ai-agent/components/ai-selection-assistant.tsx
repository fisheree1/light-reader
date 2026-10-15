import { X } from 'lucide-react';
import { useEffect } from 'react';

import { IconButton } from '../../../components/ui/icon-button';
import { Button } from '../../../components/ui/button';
import type {
  BookLocator,
  ReaderTextSelection,
} from '../../../reader-engines/types';
import type { Book } from '../../library/domain/book';
import type { AiDraft } from '../domain/agent';
import type { AgentFacade } from '../services/agent-facade';
import { useAiAssistant } from '../hooks/use-ai-assistant';
import { AiAssistantConsentForm } from './ai-assistant-consent-form';
import {
  AiCancelledStatus,
  AiDraftResult,
  AiErrorStatus,
  AiRebuildingStatus,
  AiRunningStatus,
} from './ai-assistant-status';

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
  const assistant = useAiAssistant({
    book,
    bookId,
    bookTitle,
    facade,
    onClose,
    onCreateNote,
    selection,
  });
  const { state, close } = assistant;
  const { stage, error } = state;

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
      close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [close]);

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
          onClick={close}
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
          <Button className="mt-4" onClick={assistant.chooseBookQuestion}>
            返回本书问答
          </Button>
        </div>
      ) : null}

      {stage === 'consent' ? (
        <AiAssistantConsentForm
          bookTitle={bookTitle}
          form={state}
          indexNotice={state.indexNotice}
          model={state.settings?.model ?? null}
          onCancel={close}
          onChange={assistant.edit}
          onRebuildIndex={() => void assistant.rebuildIndex()}
          onSend={() => void assistant.send()}
          selection={selection}
        />
      ) : null}

      {stage === 'running' ? (
        <AiRunningStatus
          mode={state.mode}
          onCancel={() => {
            assistant.cancel(true);
          }}
          output={state.output}
          progress={state.progress}
        />
      ) : null}

      {stage === 'rebuilding' ? (
        <AiRebuildingStatus
          onCancel={() => {
            assistant.cancel();
          }}
          progress={state.progress}
        />
      ) : null}

      {stage === 'cancelled' ? (
        <AiCancelledStatus
          onRestart={assistant.returnToForm}
          operation={state.cancelledOperation}
        />
      ) : null}

      {stage === 'completed' && state.draft ? (
        <AiDraftResult
          bookTitle={bookTitle}
          copied={state.copied}
          draft={state.draft}
          isCreatingNote={state.isCreatingNote}
          onClose={close}
          onCopy={() => void assistant.copyDraft()}
          onCreateNote={() => void assistant.createNote()}
          onNavigate={onNavigate}
          trace={state.trace}
        />
      ) : null}

      {stage === 'error' ? (
        <AiErrorStatus error={error} onBack={assistant.returnToForm} />
      ) : null}

      {error && stage !== 'error' ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

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
import { useI18n } from '../../../i18n/use-i18n';

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
  const { t } = useI18n();
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
      aria-label={t('aiAssistant.title')}
      className="bg-surface w-80 shrink-0 overflow-auto border-l p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('aiAssistant.title')}</h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {t('aiAssistant.privacy')}
          </p>
        </div>
        <IconButton
          icon={<X aria-hidden="true" size={17} />}
          label={t('aiAssistant.close')}
          onClick={close}
          variant="ghost"
        />
      </div>

      {stage === 'loading' ? (
        <p aria-live="polite" className="mt-6 text-sm">
          {t('aiAssistant.loading')}
        </p>
      ) : null}

      {stage === 'disabled' ? (
        <div className="mt-6 rounded-md border p-4">
          <p className="font-medium">{t('aiAssistant.disabled')}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('aiAssistant.disabledHint')}
          </p>
        </div>
      ) : null}

      {stage === 'empty' ? (
        <div className="mt-6 rounded-md border p-4">
          <p className="font-medium">{t('aiAssistant.noSelection')}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('aiAssistant.noSelectionHint')}
          </p>
          <Button className="mt-4" onClick={assistant.chooseBookQuestion}>
            {t('aiAssistant.backToQa')}
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

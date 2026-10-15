import { useCallback, useEffect, useReducer, useRef } from 'react';

import { asAppError } from '../../../lib/app-error';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { Book } from '../../library/domain/book';
import type { AiDraft } from '../domain/agent';
import { agentToolTraceEntrySchema } from '../domain/agent-tool';
import type { AgentFacade } from '../services/agent-facade';
import type { BookQaEvent } from '../services/book-qa-runner';
import {
  aiAssistantReducer,
  createAiAssistantState,
  type AiAssistantForm,
} from './ai-assistant-reducer';
import { translate } from '../../../i18n/i18n';

interface UseAiAssistantOptions {
  book?: Book;
  bookId: string;
  bookTitle: string;
  facade: AgentFacade;
  onClose: () => void;
  onCreateNote: (draft: AiDraft) => Promise<void>;
  selection: ReaderTextSelection | null;
}

/**
 * Owns the AI sidebar workflow: loading settings, running a book question or
 * a selection task, rebuilding the index, cancellation, and draft actions.
 */
export function useAiAssistant({
  book,
  bookId,
  bookTitle,
  facade,
  onClose,
  onCreateNote,
  selection,
}: UseAiAssistantOptions) {
  const [state, dispatch] = useReducer(
    aiAssistantReducer,
    selection,
    createAiAssistantState,
  );
  const controllerRef = useRef<AbortController | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    let cancelled = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    queueMicrotask(() => {
      if (!cancelled) dispatch({ type: 'reset', selection });
    });
    facade.getSettings().then(
      (settings) => {
        if (!cancelled) dispatch({ type: 'settingsLoaded', settings });
      },
      (reason: unknown) => {
        if (!cancelled) {
          dispatch({
            type: 'failed',
            error: asAppError(reason, 'AI_SETTINGS_READ_FAILED').userMessage,
          });
        }
      },
    );
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [facade, selection]);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    onClose();
    queueMicrotask(() => {
      returnFocusRef.current?.focus();
    });
  }, [onClose]);

  const startController = () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  };

  const handleEvent = (event: BookQaEvent) => {
    if (event.type === 'retrieval-progress') {
      dispatch({ type: 'progressed', progress: event.progress });
    } else if (event.type === 'output-delta') {
      dispatch({ type: 'outputReceived', delta: event.delta });
    }
  };

  async function runSelectionTask(signal: AbortSignal) {
    if (!selection) throw new Error('Selection is unavailable.');
    const prepared = await facade.prepareSelection({
      action: state.action,
      bookId,
      bookTitle,
      instruction:
        state.action === 'custom' ? state.customInstruction : undefined,
      selection,
    });
    return facade.runSelection(prepared, state.text, signal, handleEvent);
  }

  async function send() {
    if (state.mode === 'selection' && !selection) {
      dispatch({ type: 'selectionMissing' });
      return;
    }
    if (state.mode === 'book' && !book) {
      dispatch({
        type: 'failed',
        error: translate('ai.bookUnavailable'),
      });
      return;
    }
    dispatch({ type: 'runStarted' });
    try {
      const { signal } = startController();
      const result =
        state.mode === 'book' && book
          ? await facade.runBookQuestion(
              book,
              state.question,
              signal,
              handleEvent,
            )
          : await runSelectionTask(signal);
      controllerRef.current = null;
      dispatch({
        type: 'runCompleted',
        draft: result.draft,
        trace:
          'trace' in result
            ? agentToolTraceEntrySchema.array().parse(result.trace)
            : undefined,
      });
    } catch (reason) {
      controllerRef.current = null;
      const appError = asAppError(reason, 'AI_REQUEST_FAILED');
      if (appError.code === 'USER_CANCELLED') {
        dispatch({ type: 'cancelled' });
      } else {
        dispatch({
          type: 'failed',
          error: appError.userMessage,
          stage: appError.code === 'AI_DISABLED' ? 'disabled' : 'error',
        });
      }
    }
  }

  async function rebuildIndex() {
    if (!book) return;
    dispatch({ type: 'rebuildStarted' });
    try {
      const { signal } = startController();
      await facade.rebuildBookIndex(book, signal, (progress) => {
        dispatch({ type: 'progressed', progress });
      });
      controllerRef.current = null;
      dispatch({ type: 'rebuildCompleted' });
    } catch (reason) {
      controllerRef.current = null;
      const appError = asAppError(reason, 'SEARCH_INDEX_FAILED');
      if (appError.code === 'USER_CANCELLED') dispatch({ type: 'cancelled' });
      else dispatch({ type: 'failed', error: appError.userMessage });
    }
  }

  function cancel(clearOutput = false) {
    controllerRef.current?.abort();
    if (clearOutput) dispatch({ type: 'cancelled', clearOutput });
  }

  async function copyDraft() {
    if (!state.draft) return;
    await navigator.clipboard.writeText(state.draft.content);
    dispatch({ type: 'copied' });
  }

  async function createNote() {
    if (!state.draft) return;
    dispatch({ type: 'noteCreationStarted' });
    try {
      await onCreateNote(state.draft);
      dispatch({ type: 'noteCreationFinished' });
      close();
    } catch (reason) {
      dispatch({
        type: 'noteCreationFinished',
        error: asAppError(reason, 'NOTE_WRITE_FAILED').userMessage,
      });
    }
  }

  return {
    state,
    edit: (patch: Partial<AiAssistantForm>) => {
      dispatch({ type: 'edit', patch });
    },
    chooseBookQuestion: () => {
      dispatch({ type: 'bookQuestionChosen' });
    },
    returnToForm: () => {
      dispatch({ type: 'returnedToForm', hasSelection: selection !== null });
    },
    send,
    rebuildIndex,
    cancel,
    copyDraft,
    createNote,
    close,
  };
}

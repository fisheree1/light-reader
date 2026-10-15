import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AiDraft, SelectionAiAction } from '../domain/agent';
import type { AgentToolTraceEntry } from '../domain/agent-tool';
import type { AiSettings } from '../domain/ai-settings';
import type { BookIndexingProgress } from '../retrieval/book-indexing';
import { translate } from '../../../i18n/i18n';

export type AiAssistantStage =
  | 'loading'
  | 'disabled'
  | 'empty'
  | 'consent'
  | 'running'
  | 'rebuilding'
  | 'completed'
  | 'cancelled'
  | 'error';

export type AiAssistantMode = 'book' | 'selection';

/** Values the user edits before sending a request. */
export interface AiAssistantForm {
  action: SelectionAiAction;
  customInstruction: string;
  mode: AiAssistantMode;
  question: string;
  text: string;
}

export interface AiAssistantState extends AiAssistantForm {
  cancelledOperation: 'answer' | 'rebuild';
  copied: boolean;
  draft: AiDraft | null;
  error: string | null;
  indexNotice: string | null;
  isCreatingNote: boolean;
  output: string;
  progress: BookIndexingProgress | null;
  settings: AiSettings | null;
  stage: AiAssistantStage;
  trace: AgentToolTraceEntry[];
}

export type AiAssistantEvent =
  | { type: 'reset'; selection: ReaderTextSelection | null }
  | { type: 'settingsLoaded'; settings: AiSettings }
  | { type: 'edit'; patch: Partial<AiAssistantForm> }
  | { type: 'selectionMissing' }
  | { type: 'bookQuestionChosen' }
  | { type: 'returnedToForm'; hasSelection: boolean }
  | { type: 'failed'; error: string; stage?: 'disabled' | 'error' }
  | { type: 'runStarted' }
  | { type: 'rebuildStarted' }
  | { type: 'progressed'; progress: BookIndexingProgress | null }
  | { type: 'outputReceived'; delta: string }
  | { type: 'runCompleted'; draft: AiDraft; trace?: AgentToolTraceEntry[] }
  | { type: 'rebuildCompleted' }
  | { type: 'cancelled'; clearOutput?: boolean }
  | { type: 'copied' }
  | { type: 'noteCreationStarted' }
  | { type: 'noteCreationFinished'; error?: string };

export function createAiAssistantState(
  selection: ReaderTextSelection | null,
  question = '',
): AiAssistantState {
  return {
    action: 'summarize',
    cancelledOperation: 'answer',
    copied: false,
    customInstruction: '',
    draft: null,
    error: null,
    indexNotice: null,
    isCreatingNote: false,
    mode: selection ? 'selection' : 'book',
    output: '',
    progress: null,
    question,
    settings: null,
    stage: 'loading',
    text: selection?.text ?? '',
    trace: [],
  };
}

const clearedRun = {
  draft: null,
  error: null,
  indexNotice: null,
  output: '',
  progress: null,
  trace: [],
} satisfies Partial<AiAssistantState>;

export function aiAssistantReducer(
  state: AiAssistantState,
  event: AiAssistantEvent,
): AiAssistantState {
  switch (event.type) {
    case 'reset':
      // A new selection starts a fresh request but keeps the typed question.
      return createAiAssistantState(event.selection, state.question);
    case 'settingsLoaded':
      return {
        ...state,
        settings: event.settings,
        stage: event.settings.enabled ? 'consent' : 'disabled',
      };
    case 'edit':
      return { ...state, ...event.patch };
    case 'selectionMissing':
      return { ...state, stage: 'empty' };
    case 'bookQuestionChosen':
      return { ...state, mode: 'book', stage: 'consent' };
    case 'returnedToForm':
      return {
        ...state,
        stage:
          state.mode === 'selection' && !event.hasSelection
            ? 'empty'
            : 'consent',
      };
    case 'failed':
      return { ...state, error: event.error, stage: event.stage ?? 'error' };
    case 'runStarted':
      return {
        ...state,
        ...clearedRun,
        cancelledOperation: 'answer',
        stage: 'running',
      };
    case 'rebuildStarted':
      return {
        ...state,
        cancelledOperation: 'rebuild',
        error: null,
        indexNotice: null,
        progress: null,
        stage: 'rebuilding',
      };
    case 'progressed':
      return { ...state, progress: event.progress };
    case 'outputReceived':
      return { ...state, output: state.output + event.delta };
    case 'runCompleted':
      return {
        ...state,
        draft: event.draft,
        output: event.draft.content,
        stage: 'completed',
        trace: event.trace ?? state.trace,
      };
    case 'rebuildCompleted':
      return {
        ...state,
        indexNotice: translate('ai.indexRebuilt'),
        stage: 'consent',
      };
    case 'cancelled':
      return {
        ...state,
        error: null,
        output: event.clearOutput ? '' : state.output,
        stage: 'cancelled',
      };
    case 'copied':
      return { ...state, copied: true };
    case 'noteCreationStarted':
      return { ...state, error: null, isCreatingNote: true };
    case 'noteCreationFinished':
      return {
        ...state,
        error: event.error ?? state.error,
        isCreatingNote: false,
      };
  }
}

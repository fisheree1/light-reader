import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AiDraft } from '../domain/agent';
import { defaultAiSettings } from '../domain/ai-settings';
import {
  aiAssistantReducer,
  createAiAssistantState,
} from './ai-assistant-reducer';

const selection = {
  text: '选中的正文',
  locator: { version: 1, format: 'pdf', pageIndex: 0 },
} as ReaderTextSelection;

const draft = { content: '草稿内容' } as AiDraft;

describe('aiAssistantReducer', () => {
  it('starts in the mode implied by the current selection', () => {
    expect(createAiAssistantState(selection)).toMatchObject({
      mode: 'selection',
      stage: 'loading',
      text: '选中的正文',
    });
    expect(createAiAssistantState(null)).toMatchObject({
      mode: 'book',
      text: '',
    });
  });

  it('resets request state on a new selection but keeps the question', () => {
    const typed = aiAssistantReducer(createAiAssistantState(null), {
      type: 'edit',
      patch: { question: '作者的观点？', customInstruction: '旧需求' },
    });

    expect(
      aiAssistantReducer(typed, { type: 'reset', selection }),
    ).toMatchObject({
      question: '作者的观点？',
      customInstruction: '',
      mode: 'selection',
    });
  });

  it('moves through loading, running, streaming, and completion', () => {
    let state = aiAssistantReducer(createAiAssistantState(null), {
      type: 'settingsLoaded',
      settings: { ...defaultAiSettings, enabled: true },
    });
    expect(state.stage).toBe('consent');

    state = aiAssistantReducer(
      { ...state, error: '旧错误', output: '旧输出' },
      { type: 'runStarted' },
    );
    expect(state).toMatchObject({ stage: 'running', error: null, output: '' });

    state = aiAssistantReducer(state, { type: 'outputReceived', delta: '片' });
    state = aiAssistantReducer(state, { type: 'outputReceived', delta: '段' });
    expect(state.output).toBe('片段');

    state = aiAssistantReducer(state, { type: 'runCompleted', draft });
    expect(state).toMatchObject({
      stage: 'completed',
      output: '草稿内容',
      trace: [],
    });
  });

  it('shows disabled settings and failure stages', () => {
    const initial = createAiAssistantState(null);
    expect(
      aiAssistantReducer(initial, {
        type: 'settingsLoaded',
        settings: defaultAiSettings,
      }).stage,
    ).toBe('disabled');
    expect(
      aiAssistantReducer(initial, { type: 'failed', error: '失败' }),
    ).toMatchObject({ stage: 'error', error: '失败' });
    expect(
      aiAssistantReducer(initial, {
        type: 'failed',
        error: '未启用',
        stage: 'disabled',
      }).stage,
    ).toBe('disabled');
  });

  it('tracks index rebuilds and cancellation', () => {
    let state = aiAssistantReducer(createAiAssistantState(null), {
      type: 'rebuildStarted',
    });
    expect(state).toMatchObject({
      stage: 'rebuilding',
      cancelledOperation: 'rebuild',
    });
    state = aiAssistantReducer(state, { type: 'rebuildCompleted' });
    expect(state).toMatchObject({
      stage: 'consent',
      indexNotice: '本书 AI 索引已重新建立。',
    });

    state = aiAssistantReducer(
      { ...state, output: '部分输出' },
      { type: 'cancelled', clearOutput: true },
    );
    expect(state).toMatchObject({ stage: 'cancelled', output: '' });
  });

  it('returns to the form or the empty-selection notice', () => {
    const selectionMode = {
      ...createAiAssistantState(selection),
      stage: 'error' as const,
    };
    expect(
      aiAssistantReducer(selectionMode, {
        type: 'returnedToForm',
        hasSelection: false,
      }).stage,
    ).toBe('empty');
    expect(
      aiAssistantReducer(selectionMode, {
        type: 'returnedToForm',
        hasSelection: true,
      }).stage,
    ).toBe('consent');
    expect(
      aiAssistantReducer(
        aiAssistantReducer(selectionMode, { type: 'selectionMissing' }),
        { type: 'bookQuestionChosen' },
      ),
    ).toMatchObject({ stage: 'consent', mode: 'book' });
  });

  it('records clipboard and note creation status', () => {
    let state = aiAssistantReducer(createAiAssistantState(null), {
      type: 'copied',
    });
    expect(state.copied).toBe(true);
    state = aiAssistantReducer(state, { type: 'noteCreationStarted' });
    expect(state.isCreatingNote).toBe(true);
    state = aiAssistantReducer(state, {
      type: 'noteCreationFinished',
      error: '保存失败',
    });
    expect(state).toMatchObject({ isCreatingNote: false, error: '保存失败' });
  });
});

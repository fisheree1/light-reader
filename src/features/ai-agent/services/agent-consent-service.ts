import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AiSettings } from '../domain/ai-settings';
import {
  agentCapabilityGrantSchema,
  agentRunSchema,
  transitionAgentRun,
  type AgentCapabilityGrant,
  type AgentRun,
  type SelectionAiAction,
} from '../domain/agent';

type Clock = () => number;
type IdFactory = () => string;

export interface PreparedSelectionRun {
  bookId: string;
  bookTitle: string;
  grant: AgentCapabilityGrant;
  run: AgentRun;
  selection: ReaderTextSelection;
  text: string;
}

export class AgentConsentService {
  private readonly createId: IdFactory;
  private readonly now: Clock;

  constructor(
    createId: IdFactory = () => crypto.randomUUID(),
    now: Clock = () => Date.now(),
  ) {
    this.createId = createId;
    this.now = now;
  }

  prepare(input: {
    action: SelectionAiAction;
    bookId: string;
    bookTitle: string;
    selection: ReaderTextSelection;
    settings: AiSettings;
  }): PreparedSelectionRun {
    const text = input.selection.text.trim();
    if (!text || text.length > 12_000) {
      throw new Error(
        'Selection text is empty or exceeds the AI context budget.',
      );
    }
    const now = this.now();
    const runId = this.createId();
    const grantId = this.createId();
    const run = agentRunSchema.parse({
      schemaVersion: 1,
      id: runId,
      task: 'selection-assist',
      action: input.action,
      status: 'awaiting-consent',
      provider: 'ollama',
      model: input.settings.model,
      promptVersion: 'selection-assist-v1',
      scopeGrantId: grantId,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      inputTokens: null,
      outputTokens: null,
      toolCallCount: 0,
      errorCode: null,
    });
    const grant = agentCapabilityGrantSchema.parse({
      schemaVersion: 1,
      id: grantId,
      runId,
      provider: 'ollama',
      model: input.settings.model,
      remoteProcessingAllowed: false,
      allowedTools: ['get_current_selection', 'create_ai_draft'],
      allowedBookIds: [input.bookId],
      allowedNoteIds: [],
      allowedAnnotationIds: [],
      maxCharsPerToolResult: 12_000,
      maxTotalContextChars: 12_000,
      maxToolCalls: 2,
      expiresAt: now + 5 * 60_000,
      approvedAt: null,
    });
    return {
      bookId: input.bookId,
      bookTitle: input.bookTitle,
      grant,
      run,
      selection: input.selection,
      text,
    };
  }

  approve(
    prepared: PreparedSelectionRun,
    approvedText: string,
  ): PreparedSelectionRun {
    const now = this.now();
    const text = approvedText.trim();
    const grant = agentCapabilityGrantSchema.parse({
      ...prepared.grant,
      approvedAt: now,
      expiresAt: now + 5 * 60_000,
    });
    return {
      ...prepared,
      text,
      grant,
      run: transitionAgentRun(prepared.run, 'running', now),
    };
  }
}

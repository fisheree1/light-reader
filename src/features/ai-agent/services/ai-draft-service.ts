import {
  aiDraftSchema,
  hashAgentText,
  selectionAiActionLabels,
  type AgentCitation,
  type AiDraft,
  type AgentRun,
} from '../domain/agent';

type Clock = () => number;
type IdFactory = () => string;

export class AiDraftService {
  private readonly createId: IdFactory;
  private readonly now: Clock;

  constructor(
    createId: IdFactory = () => crypto.randomUUID(),
    now: Clock = () => Date.now(),
  ) {
    this.createId = createId;
    this.now = now;
  }

  create(
    run: AgentRun,
    sourceText: string,
    content: string,
    citations: AgentCitation[] = [],
  ): AiDraft {
    return aiDraftSchema.parse({
      schemaVersion: 1,
      id: this.createId(),
      runId: run.id,
      task: run.task,
      action: run.action,
      title:
        run.task === 'research'
          ? '跨书研究：AI 阅读草稿'
          : run.task === 'book-qa'
            ? '本书问答：AI 阅读草稿'
            : `${selectionAiActionLabels[run.action]}：AI 阅读草稿`,
      content,
      citations,
      sourceSnapshotHash: hashAgentText(sourceText),
      provider: run.provider,
      model: run.model,
      promptVersion: run.promptVersion,
      status: 'draft',
      createdAt: this.now(),
      decidedAt: null,
    });
  }

  decide(draft: AiDraft, status: 'accepted' | 'discarded'): AiDraft {
    return aiDraftSchema.parse({
      ...draft,
      status,
      decidedAt: this.now(),
    });
  }
}

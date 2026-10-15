import { createUuid } from '../../../lib/id';
import {
  aiDraftSchema,
  hashAgentText,
  selectionAiActionLabel,
  type AgentCitation,
  type AiDraft,
  type AgentRun,
} from '../domain/agent';
import { translate } from '../../../i18n/i18n';

type Clock = () => number;
type IdFactory = () => string;

export class AiDraftService {
  private readonly createId: IdFactory;
  private readonly now: Clock;

  constructor(createId: IdFactory = createUuid, now: Clock = () => Date.now()) {
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
          ? translate('ai.draftResearch')
          : run.task === 'book-qa'
            ? translate('ai.draftBookQa')
            : translate('ai.draftAction', {
                action: selectionAiActionLabel(run.action),
              }),
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

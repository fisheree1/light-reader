import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

export const selectionAiActionSchema = z.enum([
  'summarize',
  'explain',
  'translate',
  'outline',
  'questions',
]);

export type SelectionAiAction = z.infer<typeof selectionAiActionSchema>;

export const selectionAiActionLabels: Record<SelectionAiAction, string> = {
  summarize: '总结',
  explain: '解释',
  translate: '翻译为中文',
  outline: '生成提纲',
  questions: '生成阅读问题',
};

export const agentRunStatusSchema = z.enum([
  'preparing-context',
  'awaiting-consent',
  'running',
  'awaiting-tool-approval',
  'completed',
  'failed',
  'cancelled',
]);

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(128),
  task: z.literal('selection-assist'),
  action: selectionAiActionSchema,
  status: agentRunStatusSchema,
  provider: z.literal('ollama'),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100),
  scopeGrantId: z.string().trim().min(1).max(128),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  toolCallCount: z.number().int().nonnegative(),
  errorCode: z.string().trim().min(1).max(100).nullable(),
});

export type AgentRun = z.infer<typeof agentRunSchema>;

export const agentToolNameSchema = z.enum([
  'get_current_selection',
  'create_ai_draft',
]);

export type AgentToolName = z.infer<typeof agentToolNameSchema>;

export const agentCapabilityGrantSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(128),
  provider: z.literal('ollama'),
  model: z.string().trim().min(1).max(200),
  remoteProcessingAllowed: z.literal(false),
  allowedTools: z.array(agentToolNameSchema).max(2),
  allowedBookIds: z.array(z.string().trim().min(1).max(128)).max(1),
  allowedNoteIds: z.array(z.string().trim().min(1).max(128)).max(0),
  allowedAnnotationIds: z.array(z.string().trim().min(1).max(128)).max(0),
  maxCharsPerToolResult: z.number().int().positive().max(12_000),
  maxTotalContextChars: z.number().int().positive().max(12_000),
  maxToolCalls: z.number().int().nonnegative().max(2),
  expiresAt: z.number().int().nonnegative(),
  approvedAt: z.number().int().nonnegative().nullable(),
});

export type AgentCapabilityGrant = z.infer<typeof agentCapabilityGrantSchema>;

export const agentCitationSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(128),
  bookId: z.string().trim().min(1).max(128),
  bookTitleSnapshot: z.string().trim().min(1).max(500),
  chapterTitleSnapshot: z.string().trim().max(2_000).nullable(),
  locator: bookLocatorSchema,
  quote: z.string().trim().min(1).max(12_000),
  sourceChunkId: z.string().trim().min(1).max(128),
  sourceTextHash: z.string().trim().min(1).max(128),
  validation: z.enum(['verified', 'stale', 'unresolved']),
});

export type AgentCitation = z.infer<typeof agentCitationSchema>;

export const aiDraftSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(128),
  runId: z.string().trim().min(1).max(128),
  task: z.literal('selection-assist'),
  action: selectionAiActionSchema,
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(8_000),
  citations: z.array(agentCitationSchema),
  sourceSnapshotHash: z.string().trim().min(1).max(128),
  provider: z.literal('ollama'),
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(100),
  status: z.enum(['draft', 'accepted', 'discarded']),
  createdAt: z.number().int().nonnegative(),
  decidedAt: z.number().int().nonnegative().nullable(),
});

export type AiDraft = z.infer<typeof aiDraftSchema>;

export type AgentToolResult<T> =
  | {
      ok: true;
      data: T;
      truncated: boolean;
      returnedChars: number;
    }
  | {
      ok: false;
      code:
        | 'OUT_OF_SCOPE'
        | 'NOT_FOUND'
        | 'INVALID_LOCATOR'
        | 'BUDGET_EXCEEDED'
        | 'APPROVAL_REQUIRED'
        | 'UNAVAILABLE';
      message: string;
      retryable: boolean;
    };

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('output-delta'),
    runId: z.string().trim().min(1).max(128),
    delta: z.string().max(8_000),
  }),
  z.object({
    type: z.literal('usage'),
    runId: z.string().trim().min(1).max(128),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal('completed'),
    runId: z.string().trim().min(1).max(128),
  }),
  z.object({
    type: z.literal('failed'),
    runId: z.string().trim().min(1).max(128),
    code: z.string().trim().min(1).max(100),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

const allowedTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
  'preparing-context': ['awaiting-consent', 'failed', 'cancelled'],
  'awaiting-consent': ['running', 'cancelled'],
  running: ['awaiting-tool-approval', 'completed', 'failed', 'cancelled'],
  'awaiting-tool-approval': ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function transitionAgentRun(
  run: AgentRun,
  status: AgentRunStatus,
  now: number,
  errorCode: string | null = null,
): AgentRun {
  if (!allowedTransitions[run.status].includes(status)) {
    throw new Error(`Invalid agent run transition: ${run.status} -> ${status}`);
  }
  return agentRunSchema.parse({
    ...run,
    status,
    startedAt:
      status === 'running' && run.startedAt === null ? now : run.startedAt,
    completedAt: ['completed', 'failed', 'cancelled'].includes(status)
      ? now
      : run.completedAt,
    errorCode: status === 'failed' ? (errorCode ?? 'AI_REQUEST_FAILED') : null,
  });
}

export function hashAgentText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

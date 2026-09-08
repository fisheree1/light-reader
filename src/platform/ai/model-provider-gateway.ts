import { z } from 'zod';

import type { AiSettings } from '../../features/ai-agent/domain/ai-settings';

export const agentProviderEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('output-delta'),
    delta: z.string().max(8_000),
  }),
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  z.object({ type: z.literal('completed') }),
  z.object({
    type: z.literal('failed'),
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  }),
]);

export type AgentProviderEvent = z.infer<typeof agentProviderEventSchema>;

export const agentModelRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().trim().min(1).max(128),
  endpoint: z.url(),
  model: z.string().trim().min(1).max(200),
  systemPrompt: z.string().trim().min(1).max(4_000),
  prompt: z.string().trim().min(1).max(16_000),
  maxOutputChars: z.number().int().positive().max(8_000),
});

export type AgentModelRequest = z.infer<typeof agentModelRequestSchema>;

export interface ModelProviderStatus {
  available: boolean;
  errorCode: string | null;
  models: string[];
}

export interface ModelProviderGateway {
  readonly capabilities: {
    streaming: boolean;
    structuredOutput: boolean;
    functionTools: boolean;
  };
  getStatus(settings: AiSettings): Promise<ModelProviderStatus>;
  run(
    request: AgentModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentProviderEvent>;
}

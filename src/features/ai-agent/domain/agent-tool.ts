import { z } from 'zod';

import { agentToolNameSchema } from './agent';
import { bookQuestionSchema } from '../retrieval/book-retrieval';

const idSchema = z.string().trim().min(1).max(128);

const toolCallBase = z.object({
  schemaVersion: z.literal(1),
  callId: idSchema,
});

export const agentToolCallSchema = z.discriminatedUnion('name', [
  toolCallBase.extend({
    name: z.literal('search_books'),
    arguments: z.object({
      query: bookQuestionSchema,
      bookIds: z.array(idSchema).min(1).max(8),
      limit: z.number().int().min(1).max(8),
    }),
  }),
  toolCallBase.extend({
    name: z.literal('read_passage'),
    arguments: z.object({
      bookId: idSchema,
      chunkId: idSchema,
    }),
  }),
]);

export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const agentToolTraceEntrySchema = z.object({
  schemaVersion: z.literal(1),
  callId: idSchema,
  name: agentToolNameSchema,
  status: z.enum(['completed', 'rejected', 'failed']),
  returnedChars: z.number().int().nonnegative(),
  resultHash: z.string().trim().min(1).max(128).nullable(),
});

export type AgentToolTraceEntry = z.infer<typeof agentToolTraceEntrySchema>;

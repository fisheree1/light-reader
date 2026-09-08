import { z } from 'zod';

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

export const ollamaEndpointSchema = z
  .url()
  .refine(
    (value) =>
      value === DEFAULT_OLLAMA_ENDPOINT || value === 'http://localhost:11434',
    'Only the local Ollama endpoint is supported.',
  );

export const aiSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  provider: z.literal('ollama'),
  endpoint: ollamaEndpointSchema,
  model: z.string().trim().min(1).max(200),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const defaultAiSettings: AiSettings = {
  schemaVersion: 1,
  enabled: false,
  provider: 'ollama',
  endpoint: DEFAULT_OLLAMA_ENDPOINT,
  model: 'deepseek-r1:8b',
};

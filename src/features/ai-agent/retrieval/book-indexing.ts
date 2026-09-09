import { z } from 'zod';

import { AppError } from '../../../lib/app-error';

export const bookIndexingStageSchema = z.enum([
  'reading-source',
  'extracting-text',
  'chunking-text',
  'writing-index',
  'searching-index',
  'ready',
]);

export type BookIndexingStage = z.infer<typeof bookIndexingStageSchema>;

export const bookIndexingProgressSchema = z.object({
  stage: bookIndexingStageSchema,
  completed: z.number().int().nonnegative().nullable(),
  total: z.number().int().positive().nullable(),
});

export type BookIndexingProgress = z.infer<typeof bookIndexingProgressSchema>;

export interface BookRetrievalOptions {
  onProgress?: (progress: BookIndexingProgress) => void;
  signal?: AbortSignal;
}

export function emitBookIndexingProgress(
  options: BookRetrievalOptions,
  stage: BookIndexingStage,
  completed: number | null = null,
  total: number | null = null,
): void {
  options.onProgress?.(
    bookIndexingProgressSchema.parse({ stage, completed, total }),
  );
}

export function throwIfBookIndexingAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('USER_CANCELLED');
}

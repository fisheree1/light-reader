import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

export const readerNavigationTargetSchema = z.object({
  annotationId: z.string().trim().min(1).max(128).optional(),
  locator: bookLocatorSchema,
});

export type ReaderNavigationTarget = z.infer<
  typeof readerNavigationTargetSchema
>;

export function parseReaderNavigationState(
  value: unknown,
): ReaderNavigationTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const target = (value as Record<string, unknown>).readerNavigation;
  const parsed = readerNavigationTargetSchema.safeParse(target);
  return parsed.success ? parsed.data : null;
}

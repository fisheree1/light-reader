import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

const nullableText = (max: number) => z.string().max(max).nullable();

export const annotationColorSchema = z.enum(['yellow', 'blue', 'green', 'red']);

export const annotationLocatorSchema = bookLocatorSchema.refine(
  (locator) =>
    locator.format === 'epub'
      ? locator.cfi !== undefined
      : locator.textRange !== undefined,
  'An annotation locator must contain an EPUB CFI or PDF text range.',
);

export const annotationSchema = z.object({
  id: z.string().trim().min(1).max(128),
  bookId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(20_000),
  textBefore: nullableText(500),
  textAfter: nullableText(500),
  chapterHref: nullableText(2_000),
  locator: annotationLocatorSchema,
  color: annotationColorSchema,
  noteText: nullableText(10_000),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type AnnotationColor = z.infer<typeof annotationColorSchema>;
export type Annotation = z.infer<typeof annotationSchema>;

export function normalizeNoteText(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 10_000) : null;
}

import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

const entityIdSchema = z.string().trim().min(1).max(128);

export const bookTextBlockSchema = z.object({
  chapterHref: z.string().trim().min(1).max(4_000).nullable(),
  chapterTitle: z.string().trim().min(1).max(2_000).nullable(),
  locator: bookLocatorSchema,
  ordinal: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(10_000_000),
});

export type BookTextBlock = z.infer<typeof bookTextBlockSchema>;

export const bookChunkSchema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  bookId: entityIdSchema,
  sourceFileHash: z.string().regex(/^[a-f0-9]{64}$/),
  chapterHref: z.string().trim().min(1).max(4_000).nullable(),
  chapterTitle: z.string().trim().min(1).max(2_000).nullable(),
  startLocator: bookLocatorSchema,
  endLocator: bookLocatorSchema.nullable(),
  text: z.string().trim().min(1).max(1_500),
  textHash: z.string().trim().min(1).max(128),
  estimatedTokens: z.number().int().positive().max(2_000),
  ordinal: z.number().int().nonnegative(),
});

export type BookChunk = z.infer<typeof bookChunkSchema>;

export const bookChunkMatchSchema = z.object({
  chunk: bookChunkSchema,
  score: z.number().nonnegative(),
});

export type BookChunkMatch = z.infer<typeof bookChunkMatchSchema>;

export const retrievedPassageSchema = bookChunkSchema.extend({
  sourceChunkIds: z.array(entityIdSchema).min(1).max(3),
  score: z.number().nonnegative(),
});

export type RetrievedPassage = z.infer<typeof retrievedPassageSchema>;

export const bookQuestionSchema = z.string().trim().min(2).max(1_000);

export function extractBookQueryTerms(value: string): string[] {
  const normalized = bookQuestionSchema
    .parse(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms: string[] = [];
  for (const segment of normalized.split(' ')) {
    if (!segment) continue;
    if (/^[\p{Script=Han}]+$/u.test(segment) && segment.length > 4) {
      for (let index = 0; index <= segment.length - 3; index += 2) {
        terms.push(segment.slice(index, index + 3));
      }
    } else if (Array.from(segment).length >= 2) {
      terms.push(segment.slice(0, 32));
    }
  }
  return [...new Set(terms)].slice(0, 12);
}

export function scoreBookChunkTerms(text: string, terms: string[]): number {
  const normalized = text.toLocaleLowerCase();
  return terms.reduce(
    (total, term) => total + (normalized.includes(term) ? 1 : 0),
    0,
  );
}

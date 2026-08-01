import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

const entityIdSchema = z.string().trim().min(1).max(128);

export const searchQuerySchema = z.string().trim().max(200);

export const bookContentChapterSchema = z.object({
  chapterHref: z.string().trim().min(1).max(4_000),
  chapterTitle: z.string().trim().min(1).max(2_000),
  text: z.string().trim().min(1).max(10_000_000),
});

export type BookContentChapter = z.infer<typeof bookContentChapterSchema>;

export const noteSearchResultSchema = z.object({
  kind: z.literal('note'),
  id: entityIdSchema,
  title: z.string().trim().min(1).max(500),
  excerpt: z.string().max(4_000),
  updatedAt: z.number().int().nonnegative(),
});

export const annotationSearchResultSchema = z.object({
  kind: z.literal('annotation'),
  id: entityIdSchema,
  bookId: entityIdSchema,
  bookTitle: z.string().trim().min(1).max(2_000),
  text: z.string().trim().min(1).max(20_000),
  chapterHref: z.string().trim().max(4_000).nullable(),
  locator: bookLocatorSchema,
  createdAt: z.number().int().nonnegative(),
});

export const bookContentSearchResultSchema = z.object({
  kind: z.literal('book-content'),
  bookId: entityIdSchema,
  bookTitle: z.string().trim().min(1).max(2_000),
  chapterHref: z.string().trim().min(1).max(4_000),
  chapterTitle: z.string().trim().min(1).max(2_000),
  excerpt: z.string().max(4_000),
});

export type NoteSearchResult = z.infer<typeof noteSearchResultSchema>;
export type AnnotationSearchResult = z.infer<
  typeof annotationSearchResultSchema
>;
export type BookContentSearchResult = z.infer<
  typeof bookContentSearchResultSchema
>;

export interface LocalSearchResults {
  annotations: AnnotationSearchResult[];
  bookContent: BookContentSearchResult[];
  indexFailures: number;
  notes: NoteSearchResult[];
  query: string;
}

export function normalizeSearchQuery(value: string): string {
  return searchQuerySchema.parse(value).replace(/\s+/g, ' ');
}

import { z } from 'zod';

import {
  annotationSearchResultSchema,
  bookContentSearchResultSchema,
  noteSearchResultSchema,
  type AnnotationSearchResult,
  type BookContentSearchResult,
  type NoteSearchResult,
} from '../../features/search/domain/search';
import { bookLocatorSchema } from '../../reader-engines/types';

export const noteSearchRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().nullable(),
  updated_at: z.number().int().nonnegative(),
});

export const annotationSearchRecordSchema = z.object({
  id: z.string().min(1),
  book_id: z.string().min(1),
  book_title: z.string().min(1),
  text: z.string().min(1),
  chapter_href: z.string().nullable(),
  locator_json: z.string(),
  created_at: z.number().int().nonnegative(),
});

export const bookContentSearchRecordSchema = z.object({
  book_id: z.string().min(1),
  book_title: z.string().min(1),
  chapter_href: z.string().min(1),
  chapter_title: z.string().min(1),
  excerpt: z.string().nullable(),
});

export type NoteSearchRecord = z.infer<typeof noteSearchRecordSchema>;
export type AnnotationSearchRecord = z.infer<
  typeof annotationSearchRecordSchema
>;
export type BookContentSearchRecord = z.infer<
  typeof bookContentSearchRecordSchema
>;

export function mapNoteSearchRecord(value: unknown): NoteSearchResult {
  const row = noteSearchRecordSchema.parse(value);
  return noteSearchResultSchema.parse({
    kind: 'note',
    id: row.id,
    title: row.title,
    excerpt: row.excerpt ?? row.title,
    updatedAt: row.updated_at,
  });
}

export function mapAnnotationSearchRecord(
  value: unknown,
): AnnotationSearchResult {
  const row = annotationSearchRecordSchema.parse(value);
  return annotationSearchResultSchema.parse({
    kind: 'annotation',
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    text: row.text,
    chapterHref: row.chapter_href,
    locator: bookLocatorSchema.parse(JSON.parse(row.locator_json)),
    createdAt: row.created_at,
  });
}

export function mapBookContentSearchRecord(
  value: unknown,
): BookContentSearchResult {
  const row = bookContentSearchRecordSchema.parse(value);
  return bookContentSearchResultSchema.parse({
    kind: 'book-content',
    bookId: row.book_id,
    bookTitle: row.book_title,
    chapterHref: row.chapter_href,
    chapterTitle: row.chapter_title,
    excerpt: row.excerpt ?? row.chapter_title,
  });
}

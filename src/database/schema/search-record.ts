import { z } from 'zod';

import {
  annotationSearchResultSchema,
  bookSearchResultSchema,
  bookContentSearchResultSchema,
  noteSearchResultSchema,
  type AnnotationSearchResult,
  type BookSearchResult,
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
  book_format: z.enum(['epub', 'pdf']),
  excerpt: z.string().nullable(),
});

export const bookSearchRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().nullable(),
  format: z.enum(['epub', 'pdf']),
});

export type NoteSearchRecord = z.infer<typeof noteSearchRecordSchema>;
export type AnnotationSearchRecord = z.infer<
  typeof annotationSearchRecordSchema
>;
export type BookContentSearchRecord = z.infer<
  typeof bookContentSearchRecordSchema
>;
export type BookSearchRecord = z.infer<typeof bookSearchRecordSchema>;

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
    sectionLabel: row.chapter_title,
    locator:
      row.book_format === 'pdf'
        ? {
            version: 1,
            format: 'pdf',
            pageIndex: Number(row.chapter_href.replace('pdf-page:', '')),
          }
        : { version: 1, format: 'epub', chapterHref: row.chapter_href },
    excerpt: row.excerpt ?? row.chapter_title,
  });
}

export function mapBookSearchRecord(value: unknown): BookSearchResult {
  const row = bookSearchRecordSchema.parse(value);
  return bookSearchResultSchema.parse({ kind: 'book', ...row });
}

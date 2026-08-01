import { z } from 'zod';

import { noteDocumentSchema } from '../../notes/domain/note';
import { bookSchema } from './book';

export const bookTagSchema = z.string().trim().min(1).max(40);
export const bookSortSchema = z.enum(['recent', 'added', 'title']);
export type BookSort = z.infer<typeof bookSortSchema>;

export const bookListOptionsSchema = z.object({
  query: z.string().trim().max(200).default(''),
  sort: bookSortSchema.default('recent'),
  favoritesOnly: z.boolean().default(false),
});

export type BookListOptions = z.infer<typeof bookListOptionsSchema>;

export const libraryBookSchema = bookSchema.extend({
  favorite: z.boolean(),
  tags: z.array(bookTagSchema).max(20),
  lastReadAt: z.number().int().nonnegative().nullable(),
});

export type LibraryBook = z.infer<typeof libraryBookSchema>;

export const bookDeletionModeSchema = z.enum([
  'delete-all',
  'keep-note-references',
]);
export type BookDeletionMode = z.infer<typeof bookDeletionModeSchema>;

export const noteReferenceUpdateSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(500),
  document: noteDocumentSchema,
});

export type NoteReferenceUpdate = z.infer<typeof noteReferenceUpdateSchema>;

export function normalizeBookTags(values: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = bookTagSchema.parse(value);
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return z.array(bookTagSchema).max(20).parse(tags);
}

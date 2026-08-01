import { z } from 'zod';

import {
  libraryBookSchema,
  type LibraryBook,
} from '../../features/library/domain/library';
import { mapBookRecord, bookRecordSchema } from './book-record';

export const libraryBookRecordSchema = bookRecordSchema.extend({
  favorite: z.union([z.literal(0), z.literal(1), z.boolean()]),
  last_read_at: z.number().int().nonnegative().nullable(),
});

export const bookTagRecordSchema = z.object({
  book_id: z.string().min(1),
  tag: z.string().trim().min(1).max(40),
});

export type LibraryBookRecord = z.infer<typeof libraryBookRecordSchema>;
export type BookTagRecord = z.infer<typeof bookTagRecordSchema>;

export function mapLibraryBookRecord(
  value: unknown,
  tags: string[],
): LibraryBook {
  const row = libraryBookRecordSchema.parse(value);
  return libraryBookSchema.parse({
    ...mapBookRecord(row),
    favorite: row.favorite === true || row.favorite === 1,
    tags,
    lastReadAt: row.last_read_at,
  });
}

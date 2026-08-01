import { z } from 'zod';

import {
  annotationSchema,
  type Annotation,
} from '../../features/annotations/domain/annotation';
import { bookLocatorSchema } from '../../reader-engines/types';

export const annotationRecordSchema = z.object({
  id: z.string().min(1),
  book_id: z.string().min(1),
  text: z.string().min(1),
  text_before: z.string().nullable(),
  text_after: z.string().nullable(),
  chapter_href: z.string().nullable(),
  locator_json: z.string(),
  color: z.string(),
  note_text: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});

export type AnnotationRecord = z.infer<typeof annotationRecordSchema>;

export function mapAnnotationRecord(value: unknown): Annotation {
  const record = annotationRecordSchema.parse(value);
  const locator = bookLocatorSchema.parse(JSON.parse(record.locator_json));
  return annotationSchema.parse({
    id: record.id,
    bookId: record.book_id,
    text: record.text,
    textBefore: record.text_before,
    textAfter: record.text_after,
    chapterHref: record.chapter_href,
    locator,
    color: record.color,
    noteText: record.note_text,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

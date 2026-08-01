import { z } from 'zod';

import {
  createEmptyNoteDocument,
  noteDocumentSchema,
  noteSchema,
  type Note,
} from '../../features/notes/domain/note';

export const noteRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content_json: z.string(),
  plain_text: z.string(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});

export type NoteRecord = z.infer<typeof noteRecordSchema>;

export function mapNoteRecord(value: unknown): Note {
  const record = noteRecordSchema.parse(value);
  let document = createEmptyNoteDocument();
  let documentRecovered = false;

  try {
    const parsed: unknown = JSON.parse(record.content_json);
    document = noteDocumentSchema.parse(parsed);
  } catch {
    // Keep the note accessible without trusting corrupt persisted editor JSON.
    // The UI warns before a subsequent save replaces it with a valid document.
    documentRecovered = true;
  }

  return noteSchema.parse({
    id: record.id,
    title: record.title,
    document,
    plainText: record.plain_text,
    documentRecovered,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

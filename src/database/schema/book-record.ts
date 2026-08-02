import { z } from 'zod';

import {
  bookSchema,
  epubMetadataSchema,
  type Book,
} from '../../features/library/domain/book';

export const bookRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().nullable(),
  format: z.literal('epub'),
  file_path: z.string().min(1),
  file_hash: z.string().min(1),
  cover_path: z.string().nullable(),
  metadata_json: z.string(),
  file_size: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});

export type BookRecord = z.infer<typeof bookRecordSchema>;

export function mapBookRecord(value: unknown): Book {
  const record = bookRecordSchema.parse(value);
  let metadata;
  try {
    metadata = epubMetadataSchema.parse(JSON.parse(record.metadata_json));
  } catch {
    // Metadata is descriptive and must not make an otherwise valid managed book
    // disappear from the shelf. Preserve the authoritative columns and allow a
    // later metadata repair instead of crashing the whole list query.
    metadata = epubMetadataSchema.parse({
      title: record.title,
      creators: record.author ? [record.author] : [],
      language: null,
      publisher: null,
      description: null,
      identifier: null,
    });
  }

  return bookSchema.parse({
    id: record.id,
    title: record.title,
    author: record.author,
    format: record.format,
    filePath: record.file_path,
    fileHash: record.file_hash,
    coverPath: record.cover_path,
    metadata,
    fileSize: record.file_size,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

import { z } from 'zod';

const optionalMetadataText = z.string().trim().min(1).nullable();

export const epubMetadataSchema = z.object({
  title: z.string().trim().min(1),
  creators: z.array(z.string().trim().min(1)),
  language: optionalMetadataText,
  publisher: optionalMetadataText,
  description: optionalMetadataText,
  identifier: optionalMetadataText,
});

export type EpubMetadata = z.infer<typeof epubMetadataSchema>;

const controlledBookPath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').includes('..') &&
      path.startsWith('light-reader/books/'),
    'Book path must be inside the managed books directory.',
  );

const controlledCoverPath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').includes('..') &&
      path.startsWith('light-reader/covers/'),
    'Cover path must be inside the managed covers directory.',
  );

export const bookSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).nullable(),
  format: z.literal('epub'),
  filePath: controlledBookPath,
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  coverPath: controlledCoverPath.nullable(),
  metadata: epubMetadataSchema,
  fileSize: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Book = z.infer<typeof bookSchema>;

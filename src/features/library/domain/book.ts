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
export const bookMetadataSchema = epubMetadataSchema;
export type BookMetadata = z.infer<typeof bookMetadataSchema>;
export const bookFormatSchema = z.enum(['epub', 'pdf']);
export type BookFormat = z.infer<typeof bookFormatSchema>;

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

export const bookSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1),
    author: z.string().trim().min(1).nullable(),
    format: bookFormatSchema,
    filePath: controlledBookPath,
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    coverPath: controlledCoverPath.nullable(),
    metadata: bookMetadataSchema,
    fileSize: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .refine((book) => book.filePath.endsWith(`/book.${book.format}`), {
    message: 'Book format must match its managed file extension.',
    path: ['filePath'],
  });

export type Book = z.infer<typeof bookSchema>;

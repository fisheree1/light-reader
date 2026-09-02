import { z } from 'zod';

import { bookLocatorSchema } from '../../../reader-engines/types';

const noteNodeAttributeSchema = z.record(z.string(), z.json());

export interface NoteContentNode {
  attrs?: Record<string, unknown>;
  content?: NoteContentNode[];
  marks?: { attrs?: Record<string, unknown>; type: string }[];
  text?: string;
  type: string;
}

export const bookQuoteReferenceSchema = z.object({
  bookId: z.string().trim().min(1).max(128),
  annotationId: z.string().trim().min(1).max(128),
  quote: z.string().trim().min(1).max(20_000),
  chapter: z.string().trim().max(2_000).nullable(),
  locator: bookLocatorSchema.refine(
    (locator) =>
      locator.format === 'epub'
        ? locator.cfi !== undefined
        : locator.textRange !== undefined,
    'A book quote locator must contain an EPUB CFI or PDF text range.',
  ),
});

export type BookQuoteReference = z.infer<typeof bookQuoteReferenceSchema>;

export const noteContentNodeSchema: z.ZodType<NoteContentNode> = z.lazy(() =>
  z
    .object({
      attrs: noteNodeAttributeSchema.optional(),
      content: z.array(noteContentNodeSchema).optional(),
      marks: z
        .array(
          z.object({
            attrs: noteNodeAttributeSchema.optional(),
            type: z.string().trim().min(1).max(100),
          }),
        )
        .optional(),
      text: z.string().max(1_000_000).optional(),
      type: z.string().trim().min(1).max(100),
    })
    .superRefine((node, context) => {
      if (node.type !== 'bookQuote') return;
      const parsed = bookQuoteReferenceSchema.safeParse(node.attrs);
      if (!parsed.success) {
        context.addIssue({
          code: 'custom',
          message: 'Invalid book quote reference.',
          path: ['attrs'],
        });
      }
    }),
);

export const noteDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  content: noteContentNodeSchema.refine(
    (node) => node.type === 'doc',
    'The note document root must be a doc node.',
  ),
});

export type NoteDocument = z.infer<typeof noteDocumentSchema>;

export const noteSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(500),
  document: noteDocumentSchema,
  plainText: z.string().max(1_000_000),
  documentRecovered: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Note = z.infer<typeof noteSchema>;

export const noteSaveInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  document: noteDocumentSchema,
});

export type NoteSaveInput = z.infer<typeof noteSaveInputSchema>;

export function createEmptyNoteDocument(): NoteDocument {
  return {
    schemaVersion: 1,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
  };
}

export function createBookQuoteNode(
  reference: BookQuoteReference,
): NoteContentNode {
  return {
    type: 'bookQuote',
    attrs: bookQuoteReferenceSchema.parse(reference),
  };
}

export function createNoteDocument(content: unknown): NoteDocument {
  return noteDocumentSchema.parse({ schemaVersion: 1, content });
}

export function extractPlainText(document: NoteDocument): string {
  const parts: string[] = [];
  const visit = (node: NoteContentNode) => {
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (node.type === 'bookQuote') {
      const reference = bookQuoteReferenceSchema.safeParse(node.attrs);
      if (reference.success) parts.push(reference.data.quote);
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function findBookQuoteReferences(
  document: NoteDocument,
): BookQuoteReference[] {
  const references: BookQuoteReference[] = [];
  const visit = (node: NoteContentNode) => {
    if (node.type === 'bookQuote') {
      const reference = bookQuoteReferenceSchema.safeParse(node.attrs);
      if (reference.success) references.push(reference.data);
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return references;
}

export function removeBookQuoteReferences(
  document: NoteDocument,
  bookId: string,
): { document: NoteDocument; removedCount: number } {
  let removedCount = 0;
  const visit = (node: NoteContentNode): NoteContentNode | null => {
    if (node.type === 'bookQuote') {
      const reference = bookQuoteReferenceSchema.safeParse(node.attrs);
      if (reference.success && reference.data.bookId === bookId) {
        removedCount += 1;
        return null;
      }
    }
    if (!node.content) return node;
    const content = node.content.flatMap((child) => {
      const retained = visit(child);
      return retained ? [retained] : [];
    });
    return { ...node, content };
  };

  const content = visit(document.content);
  const safeContent =
    content?.type === 'doc'
      ? {
          ...content,
          content: content.content?.length
            ? content.content
            : [{ type: 'paragraph' }],
        }
      : { type: 'doc', content: [{ type: 'paragraph' }] };

  return {
    document: noteDocumentSchema.parse({
      schemaVersion: document.schemaVersion,
      content: safeContent,
    }),
    removedCount,
  };
}

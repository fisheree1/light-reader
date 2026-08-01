import { describe, expect, it } from 'vitest';

import {
  annotationColorSchema,
  annotationSchema,
  normalizeNoteText,
} from './annotation';

const locator = {
  version: 1 as const,
  format: 'epub' as const,
  chapterHref: 'EPUB/one.xhtml',
  cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
};

describe('Annotation domain', () => {
  it('preserves a versioned range locator and selected context', () => {
    expect(
      annotationSchema.parse({
        id: 'annotation-1',
        bookId: 'book-1',
        text: 'selected text',
        textBefore: 'before',
        textAfter: 'after',
        chapterHref: locator.chapterHref,
        locator,
        color: 'yellow',
        noteText: null,
        createdAt: 1,
        updatedAt: 1,
      }).locator,
    ).toEqual(locator);
  });

  it('validates the supported highlight palette', () => {
    expect(annotationColorSchema.options).toEqual([
      'yellow',
      'blue',
      'green',
      'red',
    ]);
    expect(() => annotationColorSchema.parse('purple')).toThrow();
  });

  it('requires a CFI range and normalizes note text', () => {
    expect(() =>
      annotationSchema.parse({
        id: 'annotation-1',
        bookId: 'book-1',
        text: 'selected text',
        textBefore: null,
        textAfter: null,
        chapterHref: null,
        locator: { version: 1, format: 'epub', progression: 0.2 },
        color: 'yellow',
        noteText: null,
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow();
    expect(normalizeNoteText('  my note  ')).toBe('my note');
    expect(normalizeNoteText('   ')).toBeNull();
  });
});

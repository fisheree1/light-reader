import {
  bookQuoteReferenceSchema,
  createBookQuoteNode,
  createNoteDocument,
  extractPlainText,
  findBookQuoteReferences,
} from './note';

const reference = {
  bookId: 'book-1',
  annotationId: 'annotation-1',
  quote: '保留下来的原文快照',
  chapter: '第一章',
  locator: {
    version: 1 as const,
    format: 'epub' as const,
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
  },
};

describe('note domain', () => {
  it('validates and round-trips a versioned quote locator', () => {
    expect(bookQuoteReferenceSchema.parse(reference)).toEqual(reference);
    const document = createNoteDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '想法' }] },
        createBookQuoteNode(reference),
      ],
    });

    expect(findBookQuoteReferences(document)).toEqual([reference]);
    expect(extractPlainText(document)).toBe('想法 保留下来的原文快照');
  });

  it('rejects quote blocks without a stable CFI', () => {
    expect(() =>
      createBookQuoteNode({
        ...reference,
        locator: { version: 1, format: 'epub', progression: 0.5 },
      }),
    ).toThrow();
  });

  it('keeps the quote snapshot independent from the annotation lifecycle', () => {
    const document = createNoteDocument({
      type: 'doc',
      content: [createBookQuoteNode(reference)],
    });
    // No Annotation object or Repository lookup is needed to render this data.
    expect(findBookQuoteReferences(document)[0]?.quote).toBe(
      '保留下来的原文快照',
    );
  });
});

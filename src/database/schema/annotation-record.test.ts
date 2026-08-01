import { describe, expect, it } from 'vitest';

import { mapAnnotationRecord } from './annotation-record';

describe('mapAnnotationRecord', () => {
  it('maps a database row without leaking SQL field names', () => {
    expect(
      mapAnnotationRecord({
        id: 'annotation-1',
        book_id: 'book-1',
        text: 'selected text',
        text_before: 'before',
        text_after: 'after',
        chapter_href: 'EPUB/one.xhtml',
        locator_json: JSON.stringify({
          version: 1,
          format: 'epub',
          chapterHref: 'EPUB/one.xhtml',
          cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
        }),
        color: 'green',
        note_text: 'remember this',
        created_at: 1,
        updated_at: 2,
      }),
    ).toEqual({
      id: 'annotation-1',
      bookId: 'book-1',
      text: 'selected text',
      textBefore: 'before',
      textAfter: 'after',
      chapterHref: 'EPUB/one.xhtml',
      locator: {
        version: 1,
        format: 'epub',
        chapterHref: 'EPUB/one.xhtml',
        cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      },
      color: 'green',
      noteText: 'remember this',
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it('rejects corrupted locator JSON', () => {
    expect(() =>
      mapAnnotationRecord({
        id: 'annotation-1',
        book_id: 'book-1',
        text: 'selected text',
        text_before: null,
        text_after: null,
        chapter_href: null,
        locator_json: '{"format":"epub"}',
        color: 'yellow',
        note_text: null,
        created_at: 1,
        updated_at: 1,
      }),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';

import { mapReadingStateRecord } from './reader-settings-record';

describe('mapReadingStateRecord', () => {
  it('maps versioned locator JSON into a safe domain state', () => {
    expect(
      mapReadingStateRecord({
        book_id: 'book-1',
        locator_json: JSON.stringify({
          version: 1,
          format: 'epub',
          cfi: 'epubcfi(/6/2)',
          progression: 0.25,
        }),
        updated_at: 10,
      }),
    ).toEqual({
      bookId: 'book-1',
      locator: {
        version: 1,
        format: 'epub',
        cfi: 'epubcfi(/6/2)',
        progression: 0.25,
      },
      updatedAt: 10,
    });
  });

  it('rejects malformed or unversioned locator JSON', () => {
    expect(() =>
      mapReadingStateRecord({
        book_id: 'book-1',
        locator_json: '{"progression":2}',
        updated_at: 10,
      }),
    ).toThrow();
  });
});

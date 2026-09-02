import { bookLocatorSchema } from './types';

describe('BookLocator', () => {
  it('round-trips a versioned EPUB locator', () => {
    const value = {
      version: 1,
      format: 'epub',
      chapterHref: 'chapter-2.xhtml#start',
      cfi: 'epubcfi(/6/4!/4/2)',
      progression: 0.42,
    } as const;

    expect(bookLocatorSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(
      value,
    );
  });

  it.each([-0.01, 1.01])('rejects progression outside 0..1: %s', (value) => {
    expect(() =>
      bookLocatorSchema.parse({
        version: 1,
        format: 'epub',
        progression: value,
      }),
    ).toThrow();
  });

  it('round-trips a versioned PDF page and text-range locator', () => {
    const value = {
      version: 1,
      format: 'pdf',
      pageIndex: 24,
      withinPageProgression: 0.35,
      textRange: { start: 80, end: 112 },
      progression: 0.5,
    } as const;

    expect(bookLocatorSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(
      value,
    );
  });

  it('rejects invalid PDF page indexes and empty text ranges', () => {
    expect(() =>
      bookLocatorSchema.parse({ version: 1, format: 'pdf', pageIndex: -1 }),
    ).toThrow();
    expect(() =>
      bookLocatorSchema.parse({
        version: 1,
        format: 'pdf',
        pageIndex: 0,
        textRange: { start: 12, end: 12 },
      }),
    ).toThrow();
  });
});

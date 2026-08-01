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
});

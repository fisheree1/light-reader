import { parseReaderNavigationState } from './reader-navigation';

describe('reader navigation state', () => {
  it('accepts a quote navigation target and rejects malformed state', () => {
    const target = {
      annotationId: 'annotation-1',
      locator: {
        version: 1,
        format: 'epub',
        chapterHref: 'one.xhtml',
        cfi: 'epubcfi(/6/2!/4/2)',
      },
    };

    expect(parseReaderNavigationState({ readerNavigation: target })).toEqual(
      target,
    );
    expect(parseReaderNavigationState({ readerNavigation: {} })).toBeNull();
  });
});

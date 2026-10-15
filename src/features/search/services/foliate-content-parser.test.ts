import type { FoliateBook } from '../../../reader-engines/foliate-book-loader';
import { createFb2Fixture } from '../../../test/fixtures/foliate-fixtures';
import { FoliateBookContentParser } from './foliate-content-parser';

function documentWith(text: string): Document {
  const document = window.document.implementation.createHTMLDocument('x');
  document.body.textContent = text;
  return document;
}

describe('FoliateBookContentParser', () => {
  it('extracts section text with TOC titles and section CFIs', async () => {
    const destroy = vi.fn();
    const book: FoliateBook = {
      sections: [
        { createDocument: () => documentWith('  封面  ') },
        { createDocument: () => documentWith('') },
        { createDocument: () => documentWith('第三节\n正文'), linear: 'yes' },
        { createDocument: () => documentWith('附录'), linear: 'no' },
        {},
      ],
      toc: [
        { label: '封面页', href: 'a' },
        { label: '', href: 'b', subitems: [{ label: '正文章', href: 'c' }] },
        { label: '损坏', href: 'broken' },
      ],
      resolveHref: (href) => {
        if (href === 'broken') throw new Error('bad href');
        return { index: { a: 0, b: 1, c: 2 }[href] ?? -1 };
      },
      destroy,
    };

    const chapters = await new FoliateBookContentParser(() =>
      Promise.resolve(book),
    ).parse(new Uint8Array(), 'mobi');

    expect(chapters).toEqual([
      { chapterHref: 'epubcfi(/6/2)', chapterTitle: '封面页', text: '封面' },
      {
        chapterHref: 'epubcfi(/6/6)',
        chapterTitle: '正文章',
        text: '第三节 正文',
      },
    ]);
    expect(destroy).toHaveBeenCalled();
  });

  it('returns no text for image-only comic books', async () => {
    const open = vi.fn();
    await expect(
      new FoliateBookContentParser(open).parse(new Uint8Array(), 'cbz'),
    ).resolves.toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('stops when indexing is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const parser = new FoliateBookContentParser(() =>
      Promise.resolve({
        sections: [{ createDocument: () => documentWith('x') }],
      }),
    );

    await expect(
      parser.parse(new Uint8Array(), 'fb2', controller.signal),
    ).rejects.toThrow();
  });

  it('indexes a real FB2 document', async () => {
    const chapters = await new FoliateBookContentParser().parse(
      createFb2Fixture(),
      'fb2',
    );

    expect(chapters.map((chapter) => chapter.text).join(' ')).toContain(
      '第二章包含关键词',
    );
    expect(chapters[0]?.chapterHref).toMatch(/^epubcfi\(\/6\/\d+\)$/);
  });
});

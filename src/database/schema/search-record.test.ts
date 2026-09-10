import {
  mapAnnotationSearchRecord,
  mapBookContentSearchRecord,
  mapNoteSearchRecord,
} from './search-record';

describe('search record mapping', () => {
  it('maps validated note, annotation, and EPUB rows', () => {
    expect(
      mapNoteSearchRecord({
        id: 'note-1',
        title: '本地笔记',
        excerpt: '中文搜索正文',
        updated_at: 2,
      }),
    ).toMatchObject({ kind: 'note', id: 'note-1' });

    expect(
      mapAnnotationSearchRecord({
        id: 'annotation-1',
        book_id: 'book-1',
        book_title: '测试 EPUB',
        text: 'selected local text',
        chapter_href: 'one.xhtml',
        locator_json: JSON.stringify({
          version: 1,
          format: 'epub',
          chapterHref: 'one.xhtml',
          cfi: 'epubcfi(/6/2!/4/2)',
        }),
        created_at: 3,
      }),
    ).toMatchObject({
      kind: 'annotation',
      locator: { chapterHref: 'one.xhtml' },
    });

    expect(
      mapBookContentSearchRecord({
        book_id: 'book-1',
        book_title: '测试 EPUB',
        book_format: 'epub',
        chapter_href: 'two.xhtml',
        chapter_title: '第二章',
        excerpt: '大量文本中的关键词',
      }),
    ).toMatchObject({
      kind: 'book-content',
      sectionLabel: '第二章',
      locator: { format: 'epub', chapterHref: 'two.xhtml' },
    });
  });

  it('rejects a corrupt annotation locator', () => {
    expect(() =>
      mapAnnotationSearchRecord({
        id: 'annotation-1',
        book_id: 'book-1',
        book_title: '测试 EPUB',
        text: '高亮',
        chapter_href: null,
        locator_json: '{broken',
        created_at: 3,
      }),
    ).toThrow();
  });
});

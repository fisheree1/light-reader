import type { Note } from '../domain/note';
import { renderNoteHtml, renderNoteMarkdown } from './note-export-service';

const note: Note = {
  id: 'note-1',
  title: '阅读摘录',
  document: {
    schemaVersion: 1,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '重要想法', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bookQuote',
          attrs: {
            bookId: 'book-1',
            annotationId: 'annotation-1',
            quote: '可读的原文快照',
            chapter: '第一章',
            locator: {
              version: 1,
              format: 'epub',
              chapterHref: 'one.xhtml',
              cfi: 'epubcfi(/6/2)',
            },
          },
        },
      ],
    },
  },
  plainText: '重要想法 可读的原文快照',
  documentRecovered: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('note export rendering', () => {
  it('preserves readable quote and book snapshots in Markdown', () => {
    const output = renderNoteMarkdown(note, new Map([['book-1', '测试书籍']]));

    expect(output).toContain('**重要想法**');
    expect(output).toContain('> 可读的原文快照');
    expect(output).toContain('测试书籍 · 第一章');
    expect(output).toContain('CFI epubcfi(/6/2)');
  });

  it('escapes note content in standalone HTML', () => {
    const unsafe: Note = {
      ...note,
      title: '<script>alert(1)</script>',
    };
    const output = renderNoteHtml(unsafe, new Map());

    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(output).toContain('<blockquote class="book-quote">');
  });
});

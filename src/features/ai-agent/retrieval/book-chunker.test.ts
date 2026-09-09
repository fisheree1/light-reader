import { describe, expect, it } from 'vitest';

import type { Book } from '../../library/domain/book';
import { BookChunker } from './book-chunker';

const book: Book = {
  id: 'book-1',
  title: '测试书',
  author: null,
  format: 'pdf',
  filePath: 'light-reader/books/book-1/book.pdf',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '测试书',
    creators: [],
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 100,
  createdAt: 1,
  updatedAt: 1,
};

describe('BookChunker', () => {
  it('creates stable bounded chunks and preserves PDF text offsets', () => {
    const text = `${'第一段内容。'.repeat(140)}${'第二段内容。'.repeat(140)}`;
    const blocks = [
      {
        chapterHref: null,
        chapterTitle: 'PDF 第 3 页',
        locator: {
          version: 1 as const,
          format: 'pdf' as const,
          pageIndex: 2,
          textRange: { start: 20, end: text.length + 20 },
        },
        ordinal: 2,
        text,
      },
    ];

    const first = new BookChunker().chunk(book, blocks);
    const second = new BookChunker().chunk(book, blocks);

    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
    expect(first.every((chunk) => chunk.text.length <= 1_500)).toBe(true);
    expect(first[0]?.startLocator).toMatchObject({
      format: 'pdf',
      pageIndex: 2,
      textRange: { start: 20 },
    });
    expect(first[1]?.startLocator.format).toBe('pdf');
    if (first[1]?.startLocator.format === 'pdf') {
      expect(first[1].startLocator.textRange?.start).toBeGreaterThan(20);
    }
  });
});

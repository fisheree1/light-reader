import { mapBookRecord } from './book-record';

describe('mapBookRecord', () => {
  it('validates and maps a database record to a domain book', () => {
    expect(
      mapBookRecord({
        id: 'book-1',
        title: '数据库图书',
        author: null,
        format: 'epub',
        file_path: 'light-reader/books/book-1/book.epub',
        file_hash: 'a'.repeat(64),
        cover_path: null,
        metadata_json: JSON.stringify({
          title: '数据库图书',
          creators: [],
          language: null,
          publisher: null,
          description: null,
          identifier: null,
        }),
        file_size: 12,
        created_at: 10,
        updated_at: 10,
      }),
    ).toMatchObject({
      id: 'book-1',
      title: '数据库图书',
      author: null,
      fileSize: 12,
    });
  });

  it('rejects paths outside the managed directory', () => {
    expect(() =>
      mapBookRecord({
        id: 'book-1',
        title: '不安全图书',
        author: null,
        format: 'epub',
        file_path: '/Users/example/book.epub',
        file_hash: 'a'.repeat(64),
        cover_path: null,
        metadata_json: JSON.stringify({
          title: '不安全图书',
          creators: [],
          language: null,
          publisher: null,
          description: null,
          identifier: null,
        }),
        file_size: 12,
        created_at: 10,
        updated_at: 10,
      }),
    ).toThrow();
  });

  it('keeps a valid managed book accessible when descriptive JSON is corrupt', () => {
    expect(
      mapBookRecord({
        id: 'book-1',
        title: '测试书',
        author: '作者',
        format: 'epub',
        file_path: 'light-reader/books/book-1/book.epub',
        file_hash: 'a'.repeat(64),
        cover_path: null,
        metadata_json: '{broken',
        file_size: 12,
        created_at: 10,
        updated_at: 10,
      }),
    ).toMatchObject({
      title: '测试书',
      author: '作者',
      metadata: { title: '测试书', creators: ['作者'] },
    });
  });

  it('maps a managed PDF record', () => {
    const book = mapBookRecord({
      id: 'pdf-1',
      title: 'PDF 文档',
      author: null,
      format: 'pdf',
      file_path: 'light-reader/books/pdf-1/book.pdf',
      file_hash: 'b'.repeat(64),
      cover_path: null,
      metadata_json: JSON.stringify({
        title: 'PDF 文档',
        creators: [],
        language: null,
        publisher: null,
        description: null,
        identifier: null,
      }),
      file_size: 42,
      created_at: 10,
      updated_at: 10,
    });
    expect(book.format).toBe('pdf');
    expect(book.filePath).toMatch(/pdf$/);
  });
});

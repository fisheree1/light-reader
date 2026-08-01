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
});

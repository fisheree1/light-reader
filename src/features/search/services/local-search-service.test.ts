import type { BookRepository } from '../../../database/repositories/book-repository';
import type { SearchRepository } from '../../../database/repositories/search-repository';
import type { Book } from '../../library/domain/book';
import type { ReaderBookSource } from '../../reader/services/reader-book-source';
import type {
  AnnotationSearchResult,
  BookContentChapter,
  BookContentSearchResult,
  NoteSearchResult,
} from '../domain/search';
import type { EpubContentParser } from './epub-content-parser';
import { LocalSearchService } from './local-search-service';

function book(id: string): Book {
  return {
    id,
    title: `Book ${id}`,
    author: null,
    format: 'epub',
    filePath: `light-reader/books/${id}/book.epub`,
    fileHash: id.padEnd(64, 'a'),
    coverPath: null,
    metadata: {
      title: `Book ${id}`,
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
}

class MemoryBookRepository implements BookRepository {
  readonly books: Book[];

  constructor(books: Book[]) {
    this.books = books;
  }
  create(value: Book): Promise<Book> {
    this.books.push(value);
    return Promise.resolve(value);
  }
  findById(id: string): Promise<Book | null> {
    return Promise.resolve(this.books.find((item) => item.id === id) ?? null);
  }
  findByHash(hash: string): Promise<Book | null> {
    return Promise.resolve(
      this.books.find((item) => item.fileHash === hash) ?? null,
    );
  }
  list(): Promise<Book[]> {
    return Promise.resolve([...this.books]);
  }
  delete(id: string): Promise<void> {
    const index = this.books.findIndex((item) => item.id === id);
    if (index >= 0) this.books.splice(index, 1);
    return Promise.resolve();
  }
}

class MemorySearchRepository implements SearchRepository {
  readonly indexed = new Map<string, BookContentChapter[]>();
  rebuildCount = 0;
  searchCount = 0;

  searchNotes(query: string): Promise<NoteSearchResult[]> {
    this.searchCount += 1;
    return Promise.resolve(
      query.includes('中文')
        ? [
            {
              kind: 'note',
              id: 'note-1',
              title: '中文搜索笔记',
              excerpt: '完全本地',
              updatedAt: 1,
            },
          ]
        : [],
    );
  }
  searchAnnotations(query: string): Promise<AnnotationSearchResult[]> {
    return Promise.resolve(
      query.toLowerCase().includes('local')
        ? [
            {
              kind: 'annotation',
              id: 'annotation-1',
              bookId: 'book-1',
              bookTitle: 'Book book-1',
              text: 'local highlight',
              chapterHref: 'one.xhtml',
              locator: {
                version: 1,
                format: 'epub',
                chapterHref: 'one.xhtml',
                cfi: 'epubcfi(/6/2!/4/2)',
              },
              createdAt: 1,
            },
          ]
        : [],
    );
  }
  searchBookContent(query: string): Promise<BookContentSearchResult[]> {
    const results = [...this.indexed.entries()].flatMap(([bookId, chapters]) =>
      chapters
        .filter((chapter) => chapter.text.includes(query))
        .map((chapter) => ({
          kind: 'book-content' as const,
          bookId,
          bookTitle: `Book ${bookId}`,
          chapterHref: chapter.chapterHref,
          chapterTitle: chapter.chapterTitle,
          excerpt: chapter.text,
        })),
    );
    return Promise.resolve(results);
  }
  findIndexedBookIds(): Promise<string[]> {
    return Promise.resolve([...this.indexed.keys()]);
  }
  replaceBookContent(
    bookId: string,
    chapters: BookContentChapter[],
  ): Promise<void> {
    this.indexed.set(bookId, chapters);
    return Promise.resolve();
  }
  clearBookContent(): Promise<void> {
    this.indexed.clear();
    return Promise.resolve();
  }
  rebuildTextIndexes(): Promise<void> {
    this.rebuildCount += 1;
    return Promise.resolve();
  }
}

class FakeSource implements ReaderBookSource {
  read(filePath: string): Promise<ArrayBuffer> {
    const marker = filePath.includes('broken') ? 0 : 1;
    return Promise.resolve(new Uint8Array([marker]).buffer);
  }
}

class FakeParser implements EpubContentParser {
  parse(data: Uint8Array): Promise<BookContentChapter[]> {
    if (data[0] === 0) return Promise.reject(new Error('broken epub'));
    return Promise.resolve([
      {
        chapterHref: 'one.xhtml',
        chapterTitle: '第一章',
        text: '中文正文 local content',
      },
    ]);
  }
}

describe('LocalSearchService', () => {
  it('returns an empty result without touching storage for a blank query', async () => {
    const repository = new MemorySearchRepository();
    const service = new LocalSearchService(
      repository,
      new MemoryBookRepository([book('book-1')]),
      new FakeSource(),
      new FakeParser(),
    );

    await expect(service.search('  ')).resolves.toEqual({
      annotations: [],
      bookContent: [],
      indexFailures: 0,
      notes: [],
      query: '',
    });
    expect(repository.searchCount).toBe(0);
    expect(repository.indexed.size).toBe(0);
  });

  it('indexes missing EPUB content and searches Chinese and English locally', async () => {
    const repository = new MemorySearchRepository();
    const service = new LocalSearchService(
      repository,
      new MemoryBookRepository([book('book-1')]),
      new FakeSource(),
      new FakeParser(),
    );

    const chinese = await service.search('中文');
    expect(chinese.notes).toHaveLength(1);
    expect(chinese.bookContent).toHaveLength(1);

    const english = await service.search('local');
    expect(english.annotations).toHaveLength(1);
    expect(english.bookContent).toHaveLength(1);
  });

  it('returns empty result groups for an unmatched query', async () => {
    const service = new LocalSearchService(
      new MemorySearchRepository(),
      new MemoryBookRepository([]),
      new FakeSource(),
      new FakeParser(),
    );
    await expect(service.search('没有匹配')).resolves.toMatchObject({
      annotations: [],
      bookContent: [],
      notes: [],
    });
  });

  it('rebuilds all indexes and reports an unreadable EPUB without failing others', async () => {
    const repository = new MemorySearchRepository();
    const broken = book('broken');
    broken.filePath = 'light-reader/books/broken/book.epub';
    const service = new LocalSearchService(
      repository,
      new MemoryBookRepository([book('book-1'), broken]),
      new FakeSource(),
      new FakeParser(),
    );

    await expect(service.rebuildIndex()).resolves.toEqual({
      failedBooks: 1,
      indexedBooks: 1,
    });
    expect(repository.rebuildCount).toBe(1);
    expect(repository.indexed.get('book-1')).toHaveLength(1);
    expect(repository.indexed.get('broken')).toEqual([]);
  });
});

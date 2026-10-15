import { IDBFactory } from 'fake-indexeddb';

import { IndexedDbWebDatabase } from '../../database/web/web-database';
import type { Annotation } from '../../features/annotations/domain/annotation';
import type { Book } from '../../features/library/domain/book';
import type { Note } from '../../features/notes/domain/note';

/** An isolated in-memory IndexedDB database for one Repository test. */
export function createTestWebDatabase(
  legacyStorage: Storage | null = null,
  factory: IDBFactory = new IDBFactory(),
): IndexedDbWebDatabase {
  return new IndexedDbWebDatabase({ factory, legacyStorage });
}

export function createTestBook(overrides: Partial<Book> = {}): Book {
  const id = overrides.id ?? 'book-1';
  const title = overrides.title ?? '测试图书';
  return {
    id,
    title,
    author: '作者',
    format: 'epub',
    filePath: `light-reader/books/${id}/book.epub`,
    fileHash: 'a'.repeat(64),
    coverPath: null,
    metadata: {
      title,
      creators: ['作者'],
      language: 'zh-CN',
      publisher: null,
      description: null,
      identifier: null,
    },
    fileSize: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function createTestNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: '读书笔记',
    document: {
      schemaVersion: 1,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '本地优先的笔记正文' }],
          },
        ],
      },
    },
    plainText: '',
    documentRecovered: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function createTestAnnotation(
  overrides: Partial<Annotation> = {},
): Annotation {
  return {
    id: 'annotation-1',
    bookId: 'book-1',
    text: '重要的高亮内容',
    textBefore: null,
    textAfter: null,
    chapterHref: 'one.xhtml',
    locator: {
      version: 1,
      format: 'epub',
      chapterHref: 'one.xhtml',
      cfi: 'epubcfi(/6/2!/4/2)',
    },
    color: 'yellow',
    noteText: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

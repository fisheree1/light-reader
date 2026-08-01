import type { BookRepository } from '../../../database/repositories/book-repository';
import type { LibraryRepository } from '../../../database/repositories/library-repository';
import type { NoteRepository } from '../../../database/repositories/note-repository';
import {
  createBookQuoteNode,
  createNoteDocument,
  findBookQuoteReferences,
  type Note,
} from '../../notes/domain/note';
import type {
  BookFileDeletionStorage,
  StagedBookDeletion,
} from '../../../storage/book-file-storage';
import { AppError } from '../../../lib/app-error';
import type { Book } from '../domain/book';
import type { LibraryBook, NoteReferenceUpdate } from '../domain/library';
import { LibraryManagementService } from './library-management-service';

const book: Book = {
  id: 'book-1',
  title: '待删除图书',
  author: '作者',
  format: 'epub',
  filePath: 'light-reader/books/book-1/book.epub',
  fileHash: 'a'.repeat(64),
  coverPath: 'light-reader/covers/book-1.webp',
  metadata: {
    title: '待删除图书',
    creators: ['作者'],
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 10,
  createdAt: 1,
  updatedAt: 1,
};

const libraryBook: LibraryBook = {
  ...book,
  favorite: false,
  tags: [],
  lastReadAt: null,
};

const reference = {
  bookId: book.id,
  annotationId: 'annotation-1',
  quote: '需要保护的引用快照',
  chapter: '第一章',
  locator: {
    version: 1 as const,
    format: 'epub' as const,
    chapterHref: 'one.xhtml',
    cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:8)',
  },
};

function createNote(): Note {
  const document = createNoteDocument({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '独立笔记正文' }],
      },
      createBookQuoteNode(reference),
    ],
  });
  return {
    id: 'note-1',
    title: '独立笔记',
    document,
    plainText: '独立笔记正文 需要保护的引用快照',
    documentRecovered: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

class FakeDeletionStorage implements BookFileDeletionStorage {
  readonly staged: StagedBookDeletion = {
    originalBookDirectory: 'light-reader/books/book-1',
    originalCoverPath: 'light-reader/covers/book-1.webp',
    quarantineBookDirectory: 'light-reader/trash/delete-1/book',
    quarantineCoverPath: 'light-reader/trash/delete-1/cover.webp',
    quarantineDirectory: 'light-reader/trash/delete-1',
    bookMoved: true,
    coverMoved: true,
  };
  commitCount = 0;
  restoreCount = 0;
  stageCount = 0;
  failCommit = false;
  failStage = false;

  stageDeletion(): Promise<StagedBookDeletion> {
    this.stageCount += 1;
    return this.failStage
      ? Promise.reject(new Error('file move failed'))
      : Promise.resolve(this.staged);
  }

  commitDeletion(): Promise<void> {
    this.commitCount += 1;
    return this.failCommit
      ? Promise.reject(new Error('cleanup failed'))
      : Promise.resolve();
  }

  restoreDeletion(): Promise<void> {
    this.restoreCount += 1;
    return Promise.resolve();
  }
}

function createSubject() {
  let persistedBook: Book | null = book;
  const note = createNote();
  const noteRepository: NoteRepository = {
    create: (value) => Promise.resolve(value),
    findById: (id) => Promise.resolve(id === note.id ? note : null),
    list: () => Promise.resolve([note]),
    update: () => Promise.reject(new Error('not used')),
    delete: () => Promise.resolve(),
  };
  const bookRepository: BookRepository = {
    create: (value) => Promise.resolve(value),
    findById: (id) =>
      Promise.resolve(persistedBook?.id === id ? persistedBook : null),
    findByHash: () => Promise.resolve(null),
    list: () => Promise.resolve(persistedBook ? [persistedBook] : []),
    delete: () => {
      persistedBook = null;
      return Promise.resolve();
    },
  };
  const deletionStorage = new FakeDeletionStorage();
  let receivedUpdates: NoteReferenceUpdate[] = [];
  let failDelete = false;
  const libraryRepository: LibraryRepository = {
    list: () => Promise.resolve(persistedBook ? [libraryBook] : []),
    setFavorite: () => Promise.resolve(libraryBook),
    replaceTags: () => Promise.resolve(libraryBook),
    deleteBook: (_id, updates) => {
      receivedUpdates = updates;
      if (failDelete) return Promise.reject(new AppError('BOOK_DELETE_FAILED'));
      persistedBook = null;
      return Promise.resolve();
    },
  };
  const service = new LibraryManagementService(
    libraryRepository,
    bookRepository,
    noteRepository,
    deletionStorage,
    () => 'delete-1',
  );
  return {
    deletionStorage,
    getBook: () => persistedBook,
    getUpdates: () => receivedUpdates,
    service,
    setFailDelete: () => {
      failDelete = true;
    },
  };
}

describe('LibraryManagementService', () => {
  it('deletes all book data and removes only its quote blocks from notes', async () => {
    const subject = createSubject();

    await expect(
      subject.service.deleteBook('book-1', 'delete-all'),
    ).resolves.toEqual({ cleanupPending: false, removedReferences: 1 });

    expect(subject.deletionStorage.stageCount).toBe(1);
    expect(subject.deletionStorage.commitCount).toBe(1);
    expect(subject.getBook()).toBeNull();
    const update = subject.getUpdates().at(0);
    expect(update).toBeDefined();
    if (!update) throw new Error('note reference update was not created');
    expect(update.document.content.content?.[0]).toMatchObject({
      type: 'paragraph',
    });
    expect(findBookQuoteReferences(update.document)).toEqual([]);
  });

  it('preserves independent note reference snapshots in keep mode', async () => {
    const subject = createSubject();

    await subject.service.deleteBook('book-1', 'keep-note-references');

    expect(subject.getUpdates()).toEqual([]);
    expect(subject.getBook()).toBeNull();
  });

  it('restores staged files if the database transaction fails', async () => {
    const subject = createSubject();
    subject.setFailDelete();

    await expect(
      subject.service.deleteBook('book-1', 'delete-all'),
    ).rejects.toMatchObject({ code: 'BOOK_DELETE_FAILED' });
    expect(subject.deletionStorage.restoreCount).toBe(1);
    expect(subject.deletionStorage.commitCount).toBe(0);
    expect(subject.getBook()).toEqual(book);
  });

  it('does not touch the database if files cannot be staged', async () => {
    const subject = createSubject();
    subject.deletionStorage.failStage = true;

    await expect(
      subject.service.deleteBook('book-1', 'delete-all'),
    ).rejects.toMatchObject({ code: 'BOOK_FILE_DELETE_FAILED' });
    expect(subject.getUpdates()).toEqual([]);
    expect(subject.getBook()).toEqual(book);
  });

  it('reports deferred quarantine cleanup without resurrecting deleted data', async () => {
    const subject = createSubject();
    subject.deletionStorage.failCommit = true;

    await expect(
      subject.service.deleteBook('book-1', 'delete-all'),
    ).resolves.toMatchObject({ cleanupPending: true });
    expect(subject.getBook()).toBeNull();
  });
});

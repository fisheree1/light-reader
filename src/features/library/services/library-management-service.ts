import type { BookRepository } from '../../../database/repositories/book-repository';
import type { LibraryRepository } from '../../../database/repositories/library-repository';
import type { NoteRepository } from '../../../database/repositories/note-repository';
import { AppError, asAppError } from '../../../lib/app-error';
import { createUuid } from '../../../lib/id';
import type { BookFileDeletionStorage } from '../../../storage/book-file-storage';
import {
  bookDeletionModeSchema,
  type BookDeletionMode,
  type BookListOptions,
  type LibraryBook,
  type NoteReferenceUpdate,
} from '../domain/library';
import { removeBookQuoteReferences } from '../../notes/domain/note';

export interface BookDeletionResult {
  cleanupPending: boolean;
  removedReferences: number;
}

export interface LibraryManagement {
  deleteBook(
    bookId: string,
    mode: BookDeletionMode,
  ): Promise<BookDeletionResult>;
  list(options: BookListOptions): Promise<LibraryBook[]>;
  replaceTags(bookId: string, tags: string[]): Promise<LibraryBook>;
  setFavorite(bookId: string, favorite: boolean): Promise<LibraryBook>;
}

export class LibraryManagementService implements LibraryManagement {
  private readonly libraryRepository: LibraryRepository;
  private readonly bookRepository: BookRepository;
  private readonly noteRepository: NoteRepository;
  private readonly fileStorage: BookFileDeletionStorage;
  private readonly createId: () => string;

  constructor(
    libraryRepository: LibraryRepository,
    bookRepository: BookRepository,
    noteRepository: NoteRepository,
    fileStorage: BookFileDeletionStorage,
    createId: () => string = createUuid,
  ) {
    this.libraryRepository = libraryRepository;
    this.bookRepository = bookRepository;
    this.noteRepository = noteRepository;
    this.fileStorage = fileStorage;
    this.createId = createId;
  }

  list(options: BookListOptions): Promise<LibraryBook[]> {
    return this.libraryRepository.list(options);
  }

  setFavorite(bookId: string, favorite: boolean): Promise<LibraryBook> {
    return this.libraryRepository.setFavorite(bookId, favorite);
  }

  replaceTags(bookId: string, tags: string[]): Promise<LibraryBook> {
    return this.libraryRepository.replaceTags(bookId, tags);
  }

  async deleteBook(
    bookId: string,
    valueMode: BookDeletionMode,
  ): Promise<BookDeletionResult> {
    const mode = bookDeletionModeSchema.parse(valueMode);
    const book = await this.bookRepository.findById(bookId);
    if (!book) throw new AppError('BOOK_NOT_FOUND');

    const updates: NoteReferenceUpdate[] = [];
    let removedReferences = 0;
    if (mode === 'delete-all') {
      const notes = await this.noteRepository.list();
      notes.forEach((note) => {
        const result = removeBookQuoteReferences(note.document, bookId);
        if (result.removedCount === 0) return;
        removedReferences += result.removedCount;
        updates.push({
          id: note.id,
          title: note.title,
          document: result.document,
        });
      });
    }

    let staged;
    try {
      staged = await this.fileStorage.stageDeletion(
        {
          bookId: book.id,
          bookPath: book.filePath,
          coverPath: book.coverPath,
        },
        this.createId(),
      );
    } catch (error) {
      throw new AppError('BOOK_FILE_DELETE_FAILED', { cause: error });
    }

    try {
      await this.libraryRepository.deleteBook(bookId, updates);
    } catch (error) {
      try {
        await this.fileStorage.restoreDeletion(staged);
      } catch (restoreError) {
        throw new AppError('BOOK_FILE_RESTORE_FAILED', {
          cause: { deletionError: error, restoreError },
        });
      }
      throw asAppError(error, 'BOOK_DELETE_FAILED');
    }

    let cleanupPending = false;
    try {
      await this.fileStorage.commitDeletion(staged);
    } catch {
      cleanupPending = true;
    }
    return { cleanupPending, removedReferences };
  }
}

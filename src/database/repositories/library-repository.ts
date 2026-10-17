import type {
  BookDetails,
  BookListOptions,
  LibraryBook,
  NoteReferenceUpdate,
} from '../../features/library/domain/library';

export interface LibraryRepository {
  list(options: BookListOptions): Promise<LibraryBook[]>;
  setFavorite(bookId: string, favorite: boolean): Promise<LibraryBook>;
  replaceTags(bookId: string, tags: string[]): Promise<LibraryBook>;
  updateDetails(bookId: string, details: BookDetails): Promise<LibraryBook>;
  deleteBook(bookId: string, noteUpdates: NoteReferenceUpdate[]): Promise<void>;
}

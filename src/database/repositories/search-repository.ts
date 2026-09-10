import type {
  AnnotationSearchResult,
  BookContentChapter,
  BookContentSearchResult,
  BookSearchResult,
  NoteSearchResult,
} from '../../features/search/domain/search';

export interface SearchRepository {
  searchBooks(query: string, limit?: number): Promise<BookSearchResult[]>;
  searchNotes(query: string, limit?: number): Promise<NoteSearchResult[]>;
  searchAnnotations(
    query: string,
    limit?: number,
  ): Promise<AnnotationSearchResult[]>;
  searchBookContent(
    query: string,
    limit?: number,
  ): Promise<BookContentSearchResult[]>;
  findIndexedBookIds(): Promise<string[]>;
  replaceBookContent(
    bookId: string,
    chapters: BookContentChapter[],
  ): Promise<void>;
  clearBookContent(): Promise<void>;
  rebuildTextIndexes(): Promise<void>;
}

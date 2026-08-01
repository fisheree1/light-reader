import type {
  AnnotationSearchResult,
  BookContentChapter,
  BookContentSearchResult,
  NoteSearchResult,
} from '../../features/search/domain/search';

export interface SearchRepository {
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

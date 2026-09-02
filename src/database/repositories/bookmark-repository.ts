import type { Bookmark } from '../../features/reader/domain/bookmark';

export interface BookmarkRepository {
  create(bookmark: Bookmark): Promise<Bookmark>;
  delete(id: string): Promise<void>;
  listByBook(bookId: string, query?: string): Promise<Bookmark[]>;
  rename(id: string, name: string): Promise<Bookmark>;
}

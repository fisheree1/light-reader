import type { Book } from '../../features/library/domain/book';

export interface BookRepository {
  create(book: Book): Promise<Book>;
  findById(id: string): Promise<Book | null>;
  findByHash(fileHash: string): Promise<Book | null>;
  list(): Promise<Book[]>;
  delete(id: string): Promise<void>;
}

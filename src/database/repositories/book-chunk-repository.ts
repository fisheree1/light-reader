import type {
  BookChunk,
  BookChunkMatch,
} from '../../features/ai-agent/retrieval/book-retrieval';

export interface BookChunkRepository {
  findById(bookId: string, chunkId: string): Promise<BookChunk | null>;
  getIndexedSourceHash(bookId: string): Promise<string | null>;
  replaceBookChunks(bookId: string, chunks: BookChunk[]): Promise<void>;
  searchBookChunks(
    bookId: string,
    terms: string[],
    limit: number,
  ): Promise<BookChunkMatch[]>;
}

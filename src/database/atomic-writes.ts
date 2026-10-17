import { invoke } from '@tauri-apps/api/core';

/*
 * Multi-statement writes run as Rust commands (src-tauri/src/transactions.rs
 * and library.rs). The SQL plugin sends each `execute` to any connection in
 * its pool, so a BEGIN/COMMIT issued from JavaScript is not one transaction.
 * The pool commands require `getDatabase()` to have loaded the database.
 */

export interface AtomicNoteReferenceUpdate {
  contentJson: string;
  id: string;
  plainText: string;
  updatedAt: number;
}

export interface AtomicBookContentChapter {
  chapterHref: string;
  chapterTitle: string;
  text: string;
}

export interface AtomicBookChunkRow {
  schemaVersion: number;
  chunkId: string;
  bookId: string;
  sourceFileHash: string;
  chapterHref: string | null;
  chapterTitle: string | null;
  startLocatorJson: string;
  endLocatorJson: string | null;
  text: string;
  textHash: string;
  estimatedTokens: number;
  ordinal: number;
}

export type AtomicBookDelete = (
  bookId: string,
  noteUpdates: AtomicNoteReferenceUpdate[],
) => Promise<void>;

export type AtomicTagReplace = (
  bookId: string,
  tags: string[],
  timestamp: number,
) => Promise<void>;

export interface AtomicSearchIndexWrites {
  replaceBookContent(
    bookId: string,
    chapters: AtomicBookContentChapter[],
  ): Promise<void>;
  rebuildTextIndexes(): Promise<void>;
}

export type AtomicChunkReplace = (
  bookId: string,
  chunks: AtomicBookChunkRow[],
) => Promise<void>;

export const deleteBookAtomically: AtomicBookDelete = (bookId, noteUpdates) =>
  invoke('delete_library_book', { bookId, noteUpdates });

export const replaceTagsAtomically: AtomicTagReplace = (
  bookId,
  tags,
  timestamp,
) => invoke('library_replace_book_tags', { bookId, tags, timestamp });

export const searchIndexWrites: AtomicSearchIndexWrites = {
  replaceBookContent: (bookId, chapters) =>
    invoke('search_replace_book_content', { bookId, chapters }),
  rebuildTextIndexes: () => invoke('search_rebuild_text_indexes'),
};

export const replaceChunksAtomically: AtomicChunkReplace = (bookId, chunks) =>
  invoke('ai_replace_book_chunks', { bookId, chunks });

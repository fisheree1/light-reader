import { isTauri } from '@tauri-apps/api/core';

import type { BookRepository } from '../../../database/repositories/book-repository';
import { SqliteLibraryRepository } from '../../../database/repositories/sqlite-library-repository';
import { SqliteBookRepository } from '../../../database/repositories/sqlite-book-repository';
import { SqliteNoteRepository } from '../../../database/repositories/sqlite-note-repository';
import { WebLibraryRepository } from '../../../database/repositories/web-library-repository';
import { WebNoteRepository } from '../../../database/repositories/web-note-repository';
import { WebReaderSettingsRepository } from '../../../database/repositories/web-reader-settings-repository';
import {
  removeWebBookChunks,
  WEB_AI_BOOK_CHUNKS_KEY,
} from '../../../database/repositories/web-book-chunk-repository';
import { bookmarkSchema } from '../../reader/domain/bookmark';
import { readingSessionSchema } from '../../reader/domain/reading-activity';
import { WEB_BOOKMARKS_KEY } from '../../../database/repositories/web-bookmark-repository';
import { WEB_READING_SESSIONS_KEY } from '../../../database/repositories/web-reading-activity-repository';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { TauriFileDialogAdapter } from '../../../platform/dialog/file-dialog-adapter';
import { WebFileDialogAdapter } from '../../../platform/dialog/web-file-dialog-adapter';
import { TauriBookFileStorage } from '../../../storage/book-file-storage';
import {
  webBookFileStorage,
  webSelectedBookSourceRegistry,
} from '../../../storage/web-book-file-storage';
import { bookSchema, type Book } from '../domain/book';
import { BookImportService, type BookImporter } from './book-import-service';
import { FflateEpubMetadataParser } from './epub-metadata-parser';
import {
  type LibraryManagement,
  LibraryManagementService,
} from './library-management-service';

export interface LibraryServices {
  importer: BookImporter;
  loadCoverUrl(path: string): Promise<string | null>;
  management: LibraryManagement;
  releaseCoverUrl(url: string): void;
  repository: BookRepository;
  storageDescription?: string;
}

const WEB_BOOKS_KEY = 'light-reader-web-books';

class WebBookRepository implements BookRepository {
  async create(book: Book): Promise<Book> {
    const books = await this.list();
    if (books.some((item) => item.fileHash === book.fileHash)) {
      throw new Error('UNIQUE constraint failed: books.file_hash');
    }
    this.save([book, ...books]);
    return book;
  }

  async findById(id: string): Promise<Book | null> {
    return (await this.list()).find((book) => book.id === id) ?? null;
  }

  async findByHash(fileHash: string): Promise<Book | null> {
    return (
      (await this.list()).find((book) => book.fileHash === fileHash) ?? null
    );
  }

  list(): Promise<Book[]> {
    const raw = localStorage.getItem(WEB_BOOKS_KEY);
    if (!raw) return Promise.resolve([]);
    const parsed: unknown = JSON.parse(raw);
    return Promise.resolve(bookSchema.array().parse(parsed));
  }

  async delete(id: string): Promise<void> {
    const bookmarks = localStorage.getItem(WEB_BOOKMARKS_KEY);
    const sessions = localStorage.getItem(WEB_READING_SESSIONS_KEY);
    try {
      if (bookmarks) {
        const retained = bookmarkSchema
          .array()
          .parse(JSON.parse(bookmarks))
          .filter((bookmark) => bookmark.bookId !== id);
        localStorage.setItem(WEB_BOOKMARKS_KEY, JSON.stringify(retained));
      }
      if (sessions) {
        const retained = readingSessionSchema
          .array()
          .parse(JSON.parse(sessions))
          .filter((session) => session.bookId !== id);
        localStorage.setItem(
          WEB_READING_SESSIONS_KEY,
          JSON.stringify(retained),
        );
      }
      this.save((await this.list()).filter((book) => book.id !== id));
      try {
        removeWebBookChunks(id);
      } catch {
        // The index is derived; discard a corrupt cache after canonical delete.
        localStorage.removeItem(WEB_AI_BOOK_CHUNKS_KEY);
      }
    } catch (error) {
      if (bookmarks === null) localStorage.removeItem(WEB_BOOKMARKS_KEY);
      else localStorage.setItem(WEB_BOOKMARKS_KEY, bookmarks);
      if (sessions === null) localStorage.removeItem(WEB_READING_SESSIONS_KEY);
      else localStorage.setItem(WEB_READING_SESSIONS_KEY, sessions);
      throw error;
    }
  }

  private save(books: Book[]) {
    localStorage.setItem(WEB_BOOKS_KEY, JSON.stringify(books));
  }
}

function createTauriLibraryServices(): LibraryServices {
  const repository = new SqliteBookRepository();
  const libraryRepository = new SqliteLibraryRepository();
  const fileStorage = new TauriBookFileStorage();
  return {
    repository,
    management: new LibraryManagementService(
      libraryRepository,
      repository,
      new SqliteNoteRepository(),
      fileStorage,
    ),
    importer: new BookImportService({
      dialog: new TauriFileDialogAdapter(),
      fileStorage,
      hasher: new WebCryptoContentHasher(),
      metadataParser: new FflateEpubMetadataParser(),
      repository,
    }),
    async loadCoverUrl(path) {
      const data = await fileStorage.readCover(path);
      return URL.createObjectURL(new Blob([Uint8Array.from(data).buffer]));
    },
    releaseCoverUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    storageDescription: '图书保存在桌面应用的受控目录中，支持 EPUB 和 PDF。',
  };
}

function createWebLibraryServices(): LibraryServices {
  const repository = new WebBookRepository();
  const noteRepository = new WebNoteRepository();
  const libraryRepository = new WebLibraryRepository(
    repository,
    noteRepository,
    new WebReaderSettingsRepository(),
  );
  const importer = new BookImportService({
    dialog: new WebFileDialogAdapter(webSelectedBookSourceRegistry),
    fileStorage: webBookFileStorage,
    hasher: new WebCryptoContentHasher(),
    metadataParser: new FflateEpubMetadataParser(),
    repository,
  });
  return {
    repository,
    management: new LibraryManagementService(
      libraryRepository,
      repository,
      noteRepository,
      webBookFileStorage,
    ),
    importer,
    async loadCoverUrl(path) {
      const data = await webBookFileStorage.readCover(path);
      const mediaType = path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.webp')
          ? 'image/webp'
          : path.endsWith('.gif')
            ? 'image/gif'
            : 'image/jpeg';
      return URL.createObjectURL(
        new Blob([Uint8Array.from(data).buffer], { type: mediaType }),
      );
    },
    releaseCoverUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    storageDescription: '图书保存在当前浏览器的本地存储中，不会上传到服务器。',
  };
}

export const libraryServices = isTauri()
  ? createTauriLibraryServices()
  : createWebLibraryServices();

export { WEB_BOOKS_KEY };

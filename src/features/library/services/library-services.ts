import { isTauri } from '@tauri-apps/api/core';

import type { BookRepository } from '../../../database/repositories/book-repository';
import { SqliteLibraryRepository } from '../../../database/repositories/sqlite-library-repository';
import { SqliteBookRepository } from '../../../database/repositories/sqlite-book-repository';
import { SqliteNoteRepository } from '../../../database/repositories/sqlite-note-repository';
import { WebLibraryRepository } from '../../../database/repositories/web-library-repository';
import { WebNoteRepository } from '../../../database/repositories/web-note-repository';
import { WebReaderSettingsRepository } from '../../../database/repositories/web-reader-settings-repository';
import { WebBookRepository } from '../../../database/repositories/web-book-repository';
import { WebCryptoContentHasher } from '../../../platform/crypto/content-hasher';
import { TauriFileDialogAdapter } from '../../../platform/dialog/file-dialog-adapter';
import { WebFileDialogAdapter } from '../../../platform/dialog/web-file-dialog-adapter';
import { TauriBookFileStorage } from '../../../storage/book-file-storage';
import {
  webBookFileStorage,
  webSelectedBookSourceRegistry,
} from '../../../storage/web-book-file-storage';
import { BookImportService, type BookImporter } from './book-import-service';
import { FflateEpubMetadataParser } from './epub-metadata-parser';
import {
  type LibraryManagement,
  LibraryManagementService,
} from './library-management-service';
import type { MessageKey } from '../../../i18n/i18n';

export interface LibraryServices {
  importer: BookImporter;
  loadCoverUrl(path: string): Promise<string | null>;
  management: LibraryManagement;
  releaseCoverUrl(url: string): void;
  repository: BookRepository;
  storageDescription?: MessageKey;
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
    storageDescription: 'library.storageDesktop',
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
    storageDescription: 'library.storageWeb',
  };
}

export const libraryServices = isTauri()
  ? createTauriLibraryServices()
  : createWebLibraryServices();

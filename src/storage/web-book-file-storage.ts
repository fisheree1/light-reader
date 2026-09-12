import type { SelectedBookFile } from '../platform/dialog/file-dialog-adapter';
import { createUuid } from '../lib/id';
import {
  createBookDeletionPaths,
  createBookStoragePaths,
  type ManagedBookExtension,
} from './book-paths';
import type {
  BookFileDeletionStorage,
  BookFileDeletionTarget,
  BookFileStorage,
  CommittedBookFiles,
  ExtractedCover,
  StagedBookDeletion,
  StagedBookFiles,
} from './book-file-storage';

export interface WebStoredBinary {
  data: ArrayBuffer;
  mediaType: string;
  path: string;
}

export interface WebBinaryStore {
  delete(path: string): Promise<void>;
  get(path: string): Promise<WebStoredBinary | null>;
  move(sourcePath: string, targetPath: string): Promise<void>;
  put(value: WebStoredBinary): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      'success',
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      'error',
      () => {
        reject(request.error ?? new Error('IndexedDB request failed.'));
      },
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      'complete',
      () => {
        resolve();
      },
      { once: true },
    );
    transaction.addEventListener(
      'abort',
      () => {
        reject(transaction.error ?? new Error('IndexedDB aborted.'));
      },
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => {
        reject(transaction.error ?? new Error('IndexedDB failed.'));
      },
      { once: true },
    );
  });
}

export class IndexedDbWebBinaryStore implements WebBinaryStore {
  private readonly database: Promise<IDBDatabase>;

  constructor(indexedDatabase: IDBFactory = indexedDB) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDatabase.open('light-reader-web-files', 1);
      request.addEventListener(
        'upgradeneeded',
        () => {
          if (!request.result.objectStoreNames.contains('files')) {
            request.result.createObjectStore('files', { keyPath: 'path' });
          }
        },
        { once: true },
      );
      request.addEventListener(
        'success',
        () => {
          resolve(request.result);
        },
        { once: true },
      );
      request.addEventListener(
        'error',
        () => {
          reject(request.error ?? new Error('IndexedDB open failed.'));
        },
        { once: true },
      );
    });
  }

  async put(value: WebStoredBinary): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction('files', 'readwrite');
    const completed = transactionDone(transaction);
    transaction.objectStore('files').put(value);
    await completed;
  }

  async get(path: string): Promise<WebStoredBinary | null> {
    const database = await this.database;
    const transaction = database.transaction('files', 'readonly');
    const result = await requestResult(
      transaction.objectStore('files').get(path) as IDBRequest<
        WebStoredBinary | undefined
      >,
    );
    return result ?? null;
  }

  async delete(path: string): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction('files', 'readwrite');
    const completed = transactionDone(transaction);
    transaction.objectStore('files').delete(path);
    await completed;
  }

  async move(sourcePath: string, targetPath: string): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction('files', 'readwrite');
    const completed = transactionDone(transaction);
    const store = transaction.objectStore('files');
    const source = await requestResult(
      store.get(sourcePath) as IDBRequest<WebStoredBinary | undefined>,
    );
    if (!source) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new Error('Stored browser book file is missing.');
    }
    store.put({ ...source, path: targetPath });
    store.delete(sourcePath);
    await completed;
  }
}

class LazyIndexedDbWebBinaryStore implements WebBinaryStore {
  private delegate: IndexedDbWebBinaryStore | null = null;

  delete(path: string): Promise<void> {
    return this.getDelegate().delete(path);
  }

  get(path: string): Promise<WebStoredBinary | null> {
    return this.getDelegate().get(path);
  }

  move(sourcePath: string, targetPath: string): Promise<void> {
    return this.getDelegate().move(sourcePath, targetPath);
  }

  put(value: WebStoredBinary): Promise<void> {
    return this.getDelegate().put(value);
  }

  private getDelegate(): IndexedDbWebBinaryStore {
    this.delegate ??= new IndexedDbWebBinaryStore(globalThis.indexedDB);
    return this.delegate;
  }
}

export class WebSelectedBookSourceRegistry {
  private readonly files = new Map<string, File>();

  register(files: File[]): SelectedBookFile[] {
    this.files.clear();
    return files.map((file) => {
      const path = `web-selection:${createUuid()}`;
      this.files.set(path, file);
      return { fileName: file.name, path };
    });
  }

  size(path: string): number {
    const file = this.files.get(path);
    if (!file) throw new Error('Selected browser file is no longer available.');
    return file.size;
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error('Selected browser file is no longer available.');
    try {
      return new Uint8Array(await file.arrayBuffer());
    } finally {
      this.files.delete(path);
    }
  }
}

function mediaTypeForBook(format: ManagedBookExtension): string {
  return format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
}

export class WebBookFileStorage
  implements BookFileStorage, BookFileDeletionStorage
{
  private readonly binaryStore: WebBinaryStore;
  private readonly originalBookPaths = new Map<string, string>();
  private readonly sourceRegistry: WebSelectedBookSourceRegistry;

  constructor(
    sourceRegistry: WebSelectedBookSourceRegistry,
    binaryStore: WebBinaryStore = new LazyIndexedDbWebBinaryStore(),
  ) {
    this.binaryStore = binaryStore;
    this.sourceRegistry = sourceRegistry;
  }

  getSourceSize(path: string): Promise<number> {
    return Promise.resolve(this.sourceRegistry.size(path));
  }

  readSource(path: string): Promise<Uint8Array> {
    return this.sourceRegistry.read(path);
  }

  async stage(
    bookId: string,
    bookData: Uint8Array,
    cover: ExtractedCover | null,
    format: ManagedBookExtension = 'epub',
  ): Promise<StagedBookFiles> {
    const paths = createBookStoragePaths(
      bookId,
      cover?.extension ?? null,
      format,
    );
    await this.binaryStore.put({
      path: paths.stagingBookPath,
      data: Uint8Array.from(bookData).buffer,
      mediaType: mediaTypeForBook(format),
    });
    let stagingCoverPath = paths.stagingCoverPath;
    let finalCoverPath = paths.finalCoverPath;
    if (cover && stagingCoverPath) {
      try {
        await this.binaryStore.put({
          path: stagingCoverPath,
          data: Uint8Array.from(cover.data).buffer,
          mediaType: cover.mediaType,
        });
      } catch {
        stagingCoverPath = null;
        finalCoverPath = null;
      }
    }
    return { ...paths, stagingCoverPath, finalCoverPath };
  }

  async commit(staged: StagedBookFiles): Promise<CommittedBookFiles> {
    await this.binaryStore.move(staged.stagingBookPath, staged.finalBookPath);
    let coverPath = staged.finalCoverPath;
    if (staged.stagingCoverPath && coverPath) {
      try {
        await this.binaryStore.move(staged.stagingCoverPath, coverPath);
      } catch {
        coverPath = null;
        await this.binaryStore
          .delete(staged.stagingCoverPath)
          .catch(() => undefined);
      }
    }
    return { bookPath: staged.finalBookPath, coverPath };
  }

  async rollback(staged: StagedBookFiles): Promise<void> {
    await Promise.allSettled(
      [
        staged.stagingBookPath,
        staged.finalBookPath,
        staged.stagingCoverPath,
        staged.finalCoverPath,
      ]
        .filter((path): path is string => path !== null)
        .map((path) => this.binaryStore.delete(path)),
    );
  }

  async readCover(path: string): Promise<Uint8Array> {
    return this.readStored(path);
  }

  async readManagedBook(path: string): Promise<Uint8Array> {
    return this.readStored(path);
  }

  async stageDeletion(
    target: BookFileDeletionTarget,
    deletionId: string,
  ): Promise<StagedBookDeletion> {
    const paths = createBookDeletionPaths(
      target.bookId,
      target.bookPath,
      target.coverPath,
      deletionId,
    );
    const staged: StagedBookDeletion = {
      ...paths,
      bookMoved: false,
      coverMoved: false,
    };
    this.originalBookPaths.set(paths.quarantineDirectory, target.bookPath);
    try {
      if (await this.binaryStore.get(target.bookPath)) {
        await this.binaryStore.move(
          target.bookPath,
          paths.quarantineBookDirectory,
        );
        staged.bookMoved = true;
      }
      if (
        target.coverPath &&
        paths.quarantineCoverPath &&
        (await this.binaryStore.get(target.coverPath))
      ) {
        await this.binaryStore.move(
          target.coverPath,
          paths.quarantineCoverPath,
        );
        staged.coverMoved = true;
      }
      return staged;
    } catch (error) {
      await this.restoreDeletion(staged).catch(() => undefined);
      throw error;
    }
  }

  async commitDeletion(staged: StagedBookDeletion): Promise<void> {
    await Promise.all([
      this.binaryStore.delete(staged.quarantineBookDirectory),
      ...(staged.quarantineCoverPath
        ? [this.binaryStore.delete(staged.quarantineCoverPath)]
        : []),
    ]);
    this.originalBookPaths.delete(staged.quarantineDirectory);
  }

  async restoreDeletion(staged: StagedBookDeletion): Promise<void> {
    if (staged.bookMoved) {
      const originalBookPath = this.originalBookPaths.get(
        staged.quarantineDirectory,
      );
      if (!originalBookPath)
        throw new Error('Browser deletion journal is missing.');
      await this.binaryStore.move(
        staged.quarantineBookDirectory,
        originalBookPath,
      );
    }
    if (
      staged.coverMoved &&
      staged.originalCoverPath &&
      staged.quarantineCoverPath
    ) {
      await this.binaryStore.move(
        staged.quarantineCoverPath,
        staged.originalCoverPath,
      );
    }
    this.originalBookPaths.delete(staged.quarantineDirectory);
  }

  private async readStored(path: string): Promise<Uint8Array> {
    const stored = await this.binaryStore.get(path);
    if (!stored) throw new Error('Stored browser book file is missing.');
    return new Uint8Array(stored.data);
  }
}

export const webSelectedBookSourceRegistry =
  new WebSelectedBookSourceRegistry();
export const webBookFileStorage = new WebBookFileStorage(
  webSelectedBookSourceRegistry,
);

import { migrateLegacyLocalStorage } from './web-legacy-migration';

export const WEB_DATABASE_NAME = 'light-reader-web-data';
export const WEB_DATABASE_VERSION = 1;

/**
 * Object stores of the browser database. Keys mirror the SQLite tables so the
 * Web adapters keep the same cascade and uniqueness semantics as the desktop.
 */
export const webStoreNames = [
  'books',
  'libraryMetadata',
  'notes',
  'annotations',
  'bookmarks',
  'readingSessions',
  'readerOverrides',
  'readingStates',
  'settings',
  'bookContent',
  'bookChunks',
] as const;

export type WebStoreName = (typeof webStoreNames)[number];

export type WebKey = string | [string, string | number];

export type WebWriteOperation =
  | { type: 'add'; store: WebStoreName; value: unknown; key?: WebKey }
  | { type: 'put'; store: WebStoreName; value: unknown; key?: WebKey }
  | { type: 'delete'; store: WebStoreName; key: WebKey }
  | { type: 'deleteByBook'; store: WebStoreName; bookId: string }
  | { type: 'clear'; store: WebStoreName };

/**
 * Asynchronous record storage used by every Web Repository. `write` applies
 * all operations in one IndexedDB transaction, so a failure leaves no partial
 * change behind.
 */
export interface WebDatabase {
  get(store: WebStoreName, key: WebKey): Promise<unknown>;
  getAll(store: WebStoreName): Promise<unknown[]>;
  getAllByBook(store: WebStoreName, bookId: string): Promise<unknown[]>;
  getAllKeys(store: WebStoreName): Promise<IDBValidKey[]>;
  /** Visits records in key order while `visit` returns `true`. */
  iterate(
    store: WebStoreName,
    visit: (value: unknown) => boolean,
  ): Promise<void>;
  write(operations: WebWriteOperation[]): Promise<void>;
}

export const BOOK_ID_INDEX = 'bookId';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve();
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
  });
  // Callers may fail before awaiting completion; never leak an unhandled abort.
  done.catch(() => undefined);
  return done;
}

function createStores(database: IDBDatabase): void {
  const byBook = (store: IDBObjectStore) => {
    store.createIndex(BOOK_ID_INDEX, 'bookId');
  };
  const books = database.createObjectStore('books', { keyPath: 'id' });
  books.createIndex('fileHash', 'fileHash', { unique: true });
  database.createObjectStore('libraryMetadata', { keyPath: 'bookId' });
  database.createObjectStore('notes', { keyPath: 'id' });
  byBook(database.createObjectStore('annotations', { keyPath: 'id' }));
  byBook(database.createObjectStore('bookmarks', { keyPath: 'id' }));
  byBook(database.createObjectStore('readingSessions', { keyPath: 'id' }));
  database.createObjectStore('readerOverrides', { keyPath: 'bookId' });
  database.createObjectStore('readingStates', { keyPath: 'bookId' });
  database.createObjectStore('settings');
  database.createObjectStore('bookContent', {
    keyPath: ['bookId', 'ordinal'],
  });
  byBook(
    database.createObjectStore('bookChunks', { keyPath: ['bookId', 'id'] }),
  );
}

function deleteByBook(store: IDBObjectStore, bookId: string): void {
  if (store.keyPath === 'bookId') {
    store.delete(bookId);
    return;
  }
  if (Array.isArray(store.keyPath) && store.keyPath[0] === 'bookId') {
    store.delete(IDBKeyRange.bound([bookId], [bookId, []]));
    return;
  }
  const cursorRequest = store.index(BOOK_ID_INDEX).openKeyCursor(bookId);
  cursorRequest.addEventListener('success', () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  });
}

function bookRange(store: IDBObjectStore, bookId: string) {
  if (store.keyPath === 'bookId') return { source: store, query: bookId };
  if (Array.isArray(store.keyPath) && store.keyPath[0] === 'bookId') {
    return {
      source: store,
      query: IDBKeyRange.bound([bookId], [bookId, []]),
    };
  }
  return { source: store.index(BOOK_ID_INDEX), query: bookId };
}

export interface IndexedDbWebDatabaseOptions {
  factory?: IDBFactory;
  /** Legacy localStorage data imported once when the database is created. */
  legacyStorage?: Storage | null;
}

export class IndexedDbWebDatabase implements WebDatabase {
  private database: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory | undefined;
  private readonly legacyStorage: Storage | null;

  constructor(options: IndexedDbWebDatabaseOptions = {}) {
    this.factory = options.factory;
    this.legacyStorage =
      options.legacyStorage === undefined
        ? typeof localStorage === 'undefined'
          ? null
          : localStorage
        : options.legacyStorage;
  }

  async get(store: WebStoreName, key: WebKey): Promise<unknown> {
    const transaction = (await this.open()).transaction(store, 'readonly');
    return requestResult(transaction.objectStore(store).get(key));
  }

  async getAll(store: WebStoreName): Promise<unknown[]> {
    const transaction = (await this.open()).transaction(store, 'readonly');
    return requestResult(transaction.objectStore(store).getAll());
  }

  async getAllByBook(store: WebStoreName, bookId: string): Promise<unknown[]> {
    const transaction = (await this.open()).transaction(store, 'readonly');
    const { source, query } = bookRange(transaction.objectStore(store), bookId);
    return requestResult(source.getAll(query));
  }

  async getAllKeys(store: WebStoreName): Promise<IDBValidKey[]> {
    const transaction = (await this.open()).transaction(store, 'readonly');
    return requestResult(transaction.objectStore(store).getAllKeys());
  }

  async iterate(
    store: WebStoreName,
    visit: (value: unknown) => boolean,
  ): Promise<void> {
    const transaction = (await this.open()).transaction(store, 'readonly');
    const completed = transactionDone(transaction);
    const request = transaction.objectStore(store).openCursor();
    await new Promise<void>((resolve, reject) => {
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        let keepGoing: boolean;
        try {
          keepGoing = visit(cursor.value);
        } catch (error) {
          transaction.abort();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (keepGoing) cursor.continue();
        else resolve();
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('IndexedDB cursor failed.'));
      });
    });
    await completed.catch(() => undefined);
  }

  async write(operations: WebWriteOperation[]): Promise<void> {
    if (operations.length === 0) return;
    const stores = [...new Set(operations.map((operation) => operation.store))];
    const transaction = (await this.open()).transaction(stores, 'readwrite');
    const completed = transactionDone(transaction);
    try {
      for (const operation of operations) {
        const store = transaction.objectStore(operation.store);
        if (operation.type === 'add') store.add(operation.value, operation.key);
        else if (operation.type === 'put') {
          store.put(operation.value, operation.key);
        } else if (operation.type === 'delete') store.delete(operation.key);
        else if (operation.type === 'deleteByBook') {
          deleteByBook(store, operation.bookId);
        } else store.clear();
      }
    } catch (error) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw error;
    }
    await completed;
  }

  /** Closes the connection; the next operation reopens the database. */
  async close(): Promise<void> {
    const database = this.database;
    this.database = null;
    (await database?.catch(() => null))?.close();
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= this.openDatabase().catch((error: unknown) => {
      this.database = null;
      throw error;
    });
    return this.database;
  }

  private openDatabase(): Promise<IDBDatabase> {
    const factory = this.factory ?? globalThis.indexedDB;
    const legacyStorage = this.legacyStorage;
    let migratedKeys: string[] = [];
    return new Promise((resolve, reject) => {
      const request = factory.open(WEB_DATABASE_NAME, WEB_DATABASE_VERSION);
      request.addEventListener('upgradeneeded', (event) => {
        const database = request.result;
        if (event.oldVersion < 1) {
          createStores(database);
          if (legacyStorage && request.transaction) {
            // The returned list fills in as the upgrade commits; it is read on
            // `success`, which always fires after the upgrade `complete`.
            migratedKeys = migrateLegacyLocalStorage(
              legacyStorage,
              request.transaction,
            );
          }
        }
      });
      request.addEventListener('success', () => {
        const database = request.result;
        database.addEventListener('versionchange', () => {
          database.close();
        });
        for (const key of migratedKeys) legacyStorage?.removeItem(key);
        resolve(database);
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('IndexedDB open failed.'));
      });
    });
  }
}

let sharedWebDatabase: IndexedDbWebDatabase | null = null;

/** The single browser database shared by all Web Repositories. */
export function getWebDatabase(): IndexedDbWebDatabase {
  sharedWebDatabase ??= new IndexedDbWebDatabase();
  return sharedWebDatabase;
}

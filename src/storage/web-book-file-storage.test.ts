import { describe, expect, it } from 'vitest';

import {
  WebBookFileStorage,
  WebSelectedBookSourceRegistry,
  type WebBinaryStore,
  type WebStoredBinary,
} from './web-book-file-storage';

class MemoryBinaryStore implements WebBinaryStore {
  readonly values = new Map<string, WebStoredBinary>();

  delete(path: string): Promise<void> {
    this.values.delete(path);
    return Promise.resolve();
  }

  get(path: string): Promise<WebStoredBinary | null> {
    return Promise.resolve(this.values.get(path) ?? null);
  }

  move(sourcePath: string, targetPath: string): Promise<void> {
    const source = this.values.get(sourcePath);
    if (!source) return Promise.reject(new Error('missing'));
    this.values.set(targetPath, { ...source, path: targetPath });
    this.values.delete(sourcePath);
    return Promise.resolve();
  }

  put(value: WebStoredBinary): Promise<void> {
    this.values.set(value.path, value);
    return Promise.resolve();
  }
}

describe('WebBookFileStorage', () => {
  it('commits and reads a browser-local book binary', async () => {
    const store = new MemoryBinaryStore();
    const storage = new WebBookFileStorage(
      new WebSelectedBookSourceRegistry(),
      store,
    );
    const staged = await storage.stage(
      'book-1',
      new Uint8Array([1, 2, 3]),
      null,
      'pdf',
    );

    const committed = await storage.commit(staged);

    expect(committed.bookPath).toBe('light-reader/books/book-1/book.pdf');
    await expect(storage.readManagedBook(committed.bookPath)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(store.values.has(staged.stagingBookPath)).toBe(false);
  });

  it('quarantines a browser binary and can restore or delete it', async () => {
    const store = new MemoryBinaryStore();
    const storage = new WebBookFileStorage(
      new WebSelectedBookSourceRegistry(),
      store,
    );
    const stagedBook = await storage.stage(
      'book-2',
      new Uint8Array([4, 5]),
      null,
      'epub',
    );
    const committed = await storage.commit(stagedBook);
    const deletion = await storage.stageDeletion(
      { bookId: 'book-2', bookPath: committed.bookPath, coverPath: null },
      'delete-1',
    );
    expect(store.values.has(committed.bookPath)).toBe(false);

    await storage.restoreDeletion(deletion);
    expect(store.values.has(committed.bookPath)).toBe(true);

    const finalDeletion = await storage.stageDeletion(
      { bookId: 'book-2', bookPath: committed.bookPath, coverPath: null },
      'delete-2',
    );
    await storage.commitDeletion(finalDeletion);
    expect(store.values.size).toBe(0);
  });
});

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
} from '@tauri-apps/plugin-fs';

import {
  LazyIndexedDbWebBinaryStore,
  type WebBinaryStore,
} from './web-book-file-storage';

const safeId = /^[a-zA-Z0-9-]+$/;
const safeFileName = /^[a-z.]+$/;

function dictionaryDirectory(id: string): string {
  if (!safeId.test(id))
    throw new Error('Dictionary ID contains unsafe characters.');
  return `light-reader/dictionaries/${id}`;
}

function dictionaryPath(id: string, fileName: string): string {
  if (!safeFileName.test(fileName)) {
    throw new Error('Dictionary file name contains unsafe characters.');
  }
  return `${dictionaryDirectory(id)}/${fileName}`;
}

/** Managed storage for imported dictionary files. */
export interface DictionaryFileStorage {
  read(id: string, fileName: string): Promise<Uint8Array>;
  remove(id: string, fileNames: readonly string[]): Promise<void>;
  write(id: string, fileName: string, data: Uint8Array): Promise<void>;
}

/** Desktop storage under `AppData/light-reader/dictionaries/<id>/`. */
export class TauriDictionaryFileStorage implements DictionaryFileStorage {
  async write(id: string, fileName: string, data: Uint8Array): Promise<void> {
    await mkdir(dictionaryDirectory(id), {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    await writeFile(dictionaryPath(id, fileName), data, {
      baseDir: BaseDirectory.AppData,
    });
  }

  read(id: string, fileName: string): Promise<Uint8Array> {
    return readFile(dictionaryPath(id, fileName), {
      baseDir: BaseDirectory.AppData,
    });
  }

  async remove(id: string): Promise<void> {
    const directory = dictionaryDirectory(id);
    if (await exists(directory, { baseDir: BaseDirectory.AppData })) {
      await remove(directory, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
  }
}

/** Browser storage in the same IndexedDB file store as book binaries. */
export class WebDictionaryFileStorage implements DictionaryFileStorage {
  private readonly store: WebBinaryStore;

  constructor(store: WebBinaryStore = new LazyIndexedDbWebBinaryStore()) {
    this.store = store;
  }

  write(id: string, fileName: string, data: Uint8Array): Promise<void> {
    return this.store.put({
      path: dictionaryPath(id, fileName),
      data: Uint8Array.from(data).buffer,
      mediaType: 'application/octet-stream',
    });
  }

  async read(id: string, fileName: string): Promise<Uint8Array> {
    const stored = await this.store.get(dictionaryPath(id, fileName));
    if (!stored) throw new Error('Stored dictionary file is missing.');
    return new Uint8Array(stored.data);
  }

  async remove(id: string, fileNames: readonly string[]): Promise<void> {
    await Promise.all(
      fileNames.map((fileName) =>
        this.store.delete(dictionaryPath(id, fileName)),
      ),
    );
  }
}

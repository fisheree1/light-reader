import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  rename,
  writeFile,
} from '@tauri-apps/plugin-fs';

import { createBookStoragePaths, type CoverExtension } from './book-paths';

export interface ExtractedCover {
  data: Uint8Array;
  extension: CoverExtension;
  mediaType: string;
}

export interface StagedBookFiles {
  finalBookPath: string;
  finalCoverPath: string | null;
  finalDirectory: string;
  stagingBookPath: string;
  stagingCoverPath: string | null;
  stagingDirectory: string;
}

export interface CommittedBookFiles {
  bookPath: string;
  coverPath: string | null;
}

export interface BookFileStorage {
  readSource(path: string): Promise<Uint8Array>;
  stage(
    bookId: string,
    bookData: Uint8Array,
    cover: ExtractedCover | null,
  ): Promise<StagedBookFiles>;
  commit(staged: StagedBookFiles): Promise<CommittedBookFiles>;
  rollback(staged: StagedBookFiles): Promise<void>;
  readCover(path: string): Promise<Uint8Array>;
}

async function removeIfPresent(path: string, recursive = false) {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await remove(path, { baseDir: BaseDirectory.AppData, recursive });
  }
}

export class TauriBookFileStorage implements BookFileStorage {
  async readSource(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async stage(
    bookId: string,
    bookData: Uint8Array,
    cover: ExtractedCover | null,
  ): Promise<StagedBookFiles> {
    const paths = createBookStoragePaths(bookId, cover?.extension ?? null);

    try {
      await mkdir(paths.stagingDirectory, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      await writeFile(paths.stagingBookPath, bookData, {
        baseDir: BaseDirectory.AppData,
      });

      let stagingCoverPath = paths.stagingCoverPath;
      let finalCoverPath = paths.finalCoverPath;
      if (cover && stagingCoverPath) {
        try {
          await writeFile(stagingCoverPath, cover.data, {
            baseDir: BaseDirectory.AppData,
          });
        } catch {
          stagingCoverPath = null;
          finalCoverPath = null;
        }
      }

      return { ...paths, stagingCoverPath, finalCoverPath };
    } catch (error) {
      await removeIfPresent(paths.stagingDirectory, true).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async commit(staged: StagedBookFiles): Promise<CommittedBookFiles> {
    await mkdir(staged.finalDirectory, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    await rename(staged.stagingBookPath, staged.finalBookPath, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });

    let coverPath = staged.finalCoverPath;
    if (staged.stagingCoverPath && coverPath) {
      try {
        await mkdir('light-reader/covers', {
          baseDir: BaseDirectory.AppData,
          recursive: true,
        });
        await rename(staged.stagingCoverPath, coverPath, {
          oldPathBaseDir: BaseDirectory.AppData,
          newPathBaseDir: BaseDirectory.AppData,
        });
      } catch {
        coverPath = null;
      }
    }

    await removeIfPresent(staged.stagingDirectory, true).catch(() => undefined);
    return { bookPath: staged.finalBookPath, coverPath };
  }

  async rollback(staged: StagedBookFiles): Promise<void> {
    await Promise.allSettled([
      removeIfPresent(staged.stagingDirectory, true),
      removeIfPresent(staged.finalDirectory, true),
      ...(staged.finalCoverPath
        ? [removeIfPresent(staged.finalCoverPath)]
        : []),
    ]);
  }

  async readCover(path: string): Promise<Uint8Array> {
    return readFile(path, { baseDir: BaseDirectory.AppData });
  }
}

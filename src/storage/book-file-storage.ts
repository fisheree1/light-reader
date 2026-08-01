import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  rename,
  writeFile,
} from '@tauri-apps/plugin-fs';

import {
  createBookDeletionPaths,
  createBookStoragePaths,
  type BookDeletionPaths,
  type CoverExtension,
} from './book-paths';

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

export interface BookFileDeletionTarget {
  bookId: string;
  bookPath: string;
  coverPath: string | null;
}

export interface StagedBookDeletion extends BookDeletionPaths {
  bookMoved: boolean;
  coverMoved: boolean;
}

export interface BookFileDeletionStorage {
  stageDeletion(
    target: BookFileDeletionTarget,
    deletionId: string,
  ): Promise<StagedBookDeletion>;
  commitDeletion(staged: StagedBookDeletion): Promise<void>;
  restoreDeletion(staged: StagedBookDeletion): Promise<void>;
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
  readManagedBook(path: string): Promise<Uint8Array>;
}

async function removeIfPresent(path: string, recursive = false) {
  if (await exists(path, { baseDir: BaseDirectory.AppData })) {
    await remove(path, { baseDir: BaseDirectory.AppData, recursive });
  }
}

export class TauriBookFileStorage
  implements BookFileStorage, BookFileDeletionStorage
{
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

  async readManagedBook(path: string): Promise<Uint8Array> {
    return readFile(path, { baseDir: BaseDirectory.AppData });
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
    try {
      await mkdir(paths.quarantineDirectory, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      if (
        await exists(paths.originalBookDirectory, {
          baseDir: BaseDirectory.AppData,
        })
      ) {
        await rename(
          paths.originalBookDirectory,
          paths.quarantineBookDirectory,
          {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData,
          },
        );
        staged.bookMoved = true;
      }
      if (
        paths.originalCoverPath &&
        paths.quarantineCoverPath &&
        (await exists(paths.originalCoverPath, {
          baseDir: BaseDirectory.AppData,
        }))
      ) {
        await rename(paths.originalCoverPath, paths.quarantineCoverPath, {
          oldPathBaseDir: BaseDirectory.AppData,
          newPathBaseDir: BaseDirectory.AppData,
        });
        staged.coverMoved = true;
      }
      return staged;
    } catch (error) {
      await this.restoreDeletion(staged).catch(() => undefined);
      throw error;
    }
  }

  async commitDeletion(staged: StagedBookDeletion): Promise<void> {
    await removeIfPresent(staged.quarantineDirectory, true);
  }

  async restoreDeletion(staged: StagedBookDeletion): Promise<void> {
    if (staged.bookMoved) {
      await mkdir('light-reader/books', {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      await rename(
        staged.quarantineBookDirectory,
        staged.originalBookDirectory,
        {
          oldPathBaseDir: BaseDirectory.AppData,
          newPathBaseDir: BaseDirectory.AppData,
        },
      );
    }
    if (
      staged.coverMoved &&
      staged.originalCoverPath &&
      staged.quarantineCoverPath
    ) {
      await mkdir('light-reader/covers', {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      await rename(staged.quarantineCoverPath, staged.originalCoverPath, {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      });
    }
    await removeIfPresent(staged.quarantineDirectory, true);
  }
}

export class WebBookFileDeletionStorage implements BookFileDeletionStorage {
  stageDeletion(
    target: BookFileDeletionTarget,
    deletionId: string,
  ): Promise<StagedBookDeletion> {
    return Promise.resolve({
      ...createBookDeletionPaths(
        target.bookId,
        target.bookPath,
        target.coverPath,
        deletionId,
      ),
      bookMoved: false,
      coverMoved: false,
    });
  }

  commitDeletion(): Promise<void> {
    return Promise.resolve();
  }

  restoreDeletion(): Promise<void> {
    return Promise.resolve();
  }
}

import type { BookRepository } from '../../../database/repositories/book-repository';
import type {
  FileDialogAdapter,
  SelectedBookFile,
} from '../../../platform/dialog/file-dialog-adapter';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type {
  BookFileStorage,
  StagedBookFiles,
} from '../../../storage/book-file-storage';
import { AppError, asAppError, isAppError } from '../../../lib/app-error';
import {
  bookMetadataSchema,
  bookSchema,
  type Book,
  type BookFormat,
} from '../domain/book';
import { fallbackTitleFromFileName } from '../../../storage/book-paths';
import type { EpubMetadataParser } from './epub-metadata-parser';
import { assertEpubFileSize, MAX_EPUB_FILE_SIZE } from './epub-limits';

export type ImportBookResult =
  | { status: 'cancelled' }
  | { status: 'created'; book: Book }
  | { status: 'duplicate'; book: Book };

export interface ImportBookFailure {
  fileName: string;
  message: string;
}

export type ImportBooksResult =
  | { status: 'cancelled' }
  | {
      status: 'completed';
      created: Book[];
      duplicates: Book[];
      failed: ImportBookFailure[];
    };

export interface BookImporter {
  importBook?(): Promise<ImportBookResult>;
  importBooks?(): Promise<ImportBooksResult>;
  importEpub(): Promise<ImportBookResult>;
}

interface BookImportDependencies {
  dialog: FileDialogAdapter;
  fileStorage: BookFileStorage;
  hasher: ContentHasher;
  idGenerator?: () => string;
  metadataParser: EpubMetadataParser;
  now?: () => number;
  repository: BookRepository;
  maxFileSize?: number;
}

function detectBookFormat(fileName: string): BookFormat {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.epub')) return 'epub';
  if (normalized.endsWith('.pdf')) return 'pdf';
  throw new AppError('UNSUPPORTED_FILE_TYPE');
}

export class BookImportService implements BookImporter {
  private readonly dependencies: BookImportDependencies;
  private readonly idGenerator: () => string;
  private readonly maxFileSize: number;
  private readonly now: () => number;

  constructor(dependencies: BookImportDependencies) {
    this.dependencies = dependencies;
    this.idGenerator = dependencies.idGenerator ?? (() => crypto.randomUUID());
    this.maxFileSize = dependencies.maxFileSize ?? MAX_EPUB_FILE_SIZE;
    this.now = dependencies.now ?? Date.now;
  }

  async importEpub(): Promise<ImportBookResult> {
    return this.importBook();
  }

  async importBook(): Promise<ImportBookResult> {
    let selected;
    try {
      selected = this.dependencies.dialog.selectBook
        ? await this.dependencies.dialog.selectBook()
        : await this.dependencies.dialog.selectEpub();
    } catch (error) {
      throw new AppError('UNKNOWN', { cause: error });
    }
    if (!selected) return { status: 'cancelled' };
    return this.importSelectedBook(selected);
  }

  async importBooks(): Promise<ImportBooksResult> {
    let selected: SelectedBookFile[] | null;
    try {
      if (this.dependencies.dialog.selectBooks) {
        selected = await this.dependencies.dialog.selectBooks();
      } else {
        const single = this.dependencies.dialog.selectBook
          ? await this.dependencies.dialog.selectBook()
          : await this.dependencies.dialog.selectEpub();
        selected = single ? [single] : null;
      }
    } catch (error) {
      throw new AppError('UNKNOWN', { cause: error });
    }
    if (!selected) return { status: 'cancelled' };

    const created: Book[] = [];
    const duplicates: Book[] = [];
    const failed: ImportBookFailure[] = [];
    for (const file of selected) {
      try {
        const result = await this.importSelectedBook(file);
        if (result.status === 'created') created.push(result.book);
        else duplicates.push(result.book);
      } catch (error) {
        failed.push({
          fileName: file.fileName,
          message: asAppError(error, 'UNKNOWN').userMessage,
        });
      }
    }
    return { status: 'completed', created, duplicates, failed };
  }

  private async importSelectedBook(
    selected: SelectedBookFile,
  ): Promise<Exclude<ImportBookResult, { status: 'cancelled' }>> {
    const format = detectBookFormat(selected.fileName);

    let source: Uint8Array;
    try {
      assertEpubFileSize(
        await this.dependencies.fileStorage.getSourceSize(selected.path),
        this.maxFileSize,
      );
      source = await this.dependencies.fileStorage.readSource(selected.path);
      assertEpubFileSize(source.byteLength, this.maxFileSize);
    } catch (error) {
      if (isAppError(error)) {
        if (format === 'pdf' && error.code === 'EPUB_TOO_LARGE') {
          throw new AppError('PDF_TOO_LARGE', { cause: error });
        }
        throw error;
      }
      throw new AppError('FILE_READ_FAILED', { cause: error });
    }
    if (
      format === 'pdf' &&
      new TextDecoder('latin1').decode(source.subarray(0, 5)) !== '%PDF-'
    ) {
      throw new AppError('INVALID_PDF');
    }

    const fileHash = await this.dependencies.hasher.sha256(source);
    const duplicate = await this.dependencies.repository.findByHash(fileHash);
    if (duplicate) return { status: 'duplicate', book: duplicate };

    const parsed =
      format === 'epub'
        ? await this.dependencies.metadataParser.parse(
            source,
            selected.fileName,
          )
        : {
            metadata: bookMetadataSchema.parse({
              title: fallbackTitleFromFileName(selected.fileName),
              creators: [],
              language: null,
              publisher: null,
              description: null,
              identifier: null,
            }),
            cover: null,
          };
    const id = this.idGenerator();
    const timestamp = this.now();

    let staged: StagedBookFiles;
    try {
      staged = await this.dependencies.fileStorage.stage(
        id,
        source,
        parsed.cover,
        format,
      );
    } catch (error) {
      throw new AppError('FILE_WRITE_FAILED', { cause: error });
    }

    let committed;
    try {
      // Finalize files before inserting the row so the database never points at
      // a missing book. A crash can leave an orphan, never a broken shelf row.
      committed = await this.dependencies.fileStorage.commit(staged);
    } catch (error) {
      await this.dependencies.fileStorage.rollback(staged);
      throw new AppError('FILE_WRITE_FAILED', { cause: error });
    }

    let book: Book;
    try {
      book = bookSchema.parse({
        id,
        title: parsed.metadata.title,
        author: parsed.metadata.creators.join(', ') || null,
        format,
        filePath: committed.bookPath,
        fileHash,
        coverPath: committed.coverPath,
        metadata: parsed.metadata,
        fileSize: source.byteLength,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      await this.dependencies.fileStorage.rollback(staged);
      throw new AppError('UNKNOWN', { cause: error });
    }

    try {
      return {
        status: 'created',
        book: await this.dependencies.repository.create(book),
      };
    } catch (error) {
      if (isAppError(error) && error.code === 'DUPLICATE_BOOK') {
        const racedDuplicate =
          await this.dependencies.repository.findByHash(fileHash);
        if (racedDuplicate) {
          await this.dependencies.fileStorage.rollback(staged);
          return { status: 'duplicate', book: racedDuplicate };
        }
      }

      let persisted: Book | null;
      try {
        persisted = await this.dependencies.repository.findById(id);
      } catch (verificationError) {
        // The insert outcome is unknown. Retain the managed files because a row
        // may exist; an orphan is recoverable, a missing referenced book is not.
        throw new AppError('DATABASE_WRITE_FAILED', {
          cause: { createError: error, verificationError },
        });
      }
      if (persisted) {
        try {
          await this.dependencies.repository.delete(id);
        } catch (cleanupError) {
          // Keep finalized files paired with the row when compensation fails.
          throw new AppError('DATABASE_WRITE_FAILED', {
            cause: { cleanupError, createError: error },
          });
        }
      }
      await this.dependencies.fileStorage.rollback(staged);
      throw asAppError(error, 'DATABASE_WRITE_FAILED');
    }
  }
}

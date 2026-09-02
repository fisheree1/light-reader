import type { BookRepository } from '../../../database/repositories/book-repository';
import { AppError } from '../../../lib/app-error';
import type { ContentHasher } from '../../../platform/crypto/content-hasher';
import type {
  FileDialogAdapter,
  SelectedBookFile,
} from '../../../platform/dialog/file-dialog-adapter';
import type {
  BookFileStorage,
  CommittedBookFiles,
  StagedBookFiles,
} from '../../../storage/book-file-storage';
import type { Book } from '../domain/book';
import { BookImportService } from './book-import-service';
import type { EpubMetadataParser, ParsedEpub } from './epub-metadata-parser';
import { MAX_EPUB_FILE_SIZE } from './epub-limits';

const HASH = 'a'.repeat(64);
const STAGED: StagedBookFiles = {
  stagingDirectory: 'light-reader/tmp/book-1',
  stagingBookPath: 'light-reader/tmp/book-1/book.epub',
  stagingCoverPath: null,
  finalDirectory: 'light-reader/books/book-1',
  finalBookPath: 'light-reader/books/book-1/book.epub',
  finalCoverPath: null,
};

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'existing-book',
    title: '已有图书',
    author: '作者',
    format: 'epub',
    filePath: 'light-reader/books/existing-book/book.epub',
    fileHash: HASH,
    coverPath: null,
    metadata: {
      title: '已有图书',
      creators: ['作者'],
      language: null,
      publisher: null,
      description: null,
      identifier: null,
    },
    fileSize: 3,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

class FakeRepository implements BookRepository {
  books: Book[] = [];
  commitThenFail = false;
  failDelete = false;
  failCreate = false;

  create(book: Book): Promise<Book> {
    if (this.commitThenFail) {
      this.books.push(book);
      return Promise.reject(new AppError('DATABASE_WRITE_FAILED'));
    }
    if (this.failCreate) {
      return Promise.reject(new AppError('DATABASE_WRITE_FAILED'));
    }
    if (this.books.some((item) => item.fileHash === book.fileHash)) {
      return Promise.reject(new AppError('DUPLICATE_BOOK'));
    }
    this.books.push(book);
    return Promise.resolve(book);
  }

  findById(id: string): Promise<Book | null> {
    return Promise.resolve(this.books.find((book) => book.id === id) ?? null);
  }

  findByHash(hash: string): Promise<Book | null> {
    return Promise.resolve(
      this.books.find((book) => book.fileHash === hash) ?? null,
    );
  }

  list(): Promise<Book[]> {
    return Promise.resolve([...this.books]);
  }

  delete(id: string): Promise<void> {
    if (this.failDelete) return Promise.reject(new Error('delete failed'));
    this.books = this.books.filter((book) => book.id !== id);
    return Promise.resolve();
  }
}

class FakeStorage implements BookFileStorage {
  commitFailure = false;
  readFailure: Error | null = null;
  readCount = 0;
  rollbackCount = 0;
  sourceSize = 3;
  sourceSizeFailure: Error | null = null;
  source = new Uint8Array([1, 2, 3]);
  stageFailure: Error | null = null;
  stageCount = 0;
  staged = STAGED;

  getSourceSize(): Promise<number> {
    if (this.sourceSizeFailure) return Promise.reject(this.sourceSizeFailure);
    return Promise.resolve(this.sourceSize);
  }

  readSource(): Promise<Uint8Array> {
    this.readCount += 1;
    if (this.readFailure) return Promise.reject(this.readFailure);
    return Promise.resolve(this.source);
  }

  stage(
    _bookId: string,
    _bookData: Uint8Array,
    _cover: null,
    format: 'epub' | 'pdf' = 'epub',
  ): Promise<StagedBookFiles> {
    this.stageCount += 1;
    if (this.stageFailure) return Promise.reject(this.stageFailure);
    this.staged =
      format === 'pdf'
        ? {
            ...STAGED,
            stagingBookPath: 'light-reader/tmp/book-1/book.pdf',
            finalBookPath: 'light-reader/books/book-1/book.pdf',
          }
        : STAGED;
    return Promise.resolve(this.staged);
  }

  commit(): Promise<CommittedBookFiles> {
    if (this.commitFailure) return Promise.reject(new Error('copy failed'));
    return Promise.resolve({
      bookPath: this.staged.finalBookPath,
      coverPath: null,
    });
  }

  rollback(): Promise<void> {
    this.rollbackCount += 1;
    return Promise.resolve();
  }

  readCover(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  readManagedBook(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
}

class FakeDialog implements FileDialogAdapter {
  selection: SelectedBookFile | null = {
    fileName: 'source.epub',
    path: '/selected/source.epub',
  };

  selectEpub(): Promise<SelectedBookFile | null> {
    return Promise.resolve(this.selection);
  }
}

class FakeHasher implements ContentHasher {
  sha256(): Promise<string> {
    return Promise.resolve(HASH);
  }
}

class FakeParser implements EpubMetadataParser {
  failure: AppError | null = null;
  parsed: ParsedEpub = {
    cover: null,
    metadata: {
      title: '新图书',
      creators: ['新作者'],
      language: 'zh-CN',
      publisher: null,
      description: null,
      identifier: null,
    },
  };

  parse(): Promise<ParsedEpub> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.parsed);
  }
}

function createSubject() {
  const dialog = new FakeDialog();
  const fileStorage = new FakeStorage();
  const metadataParser = new FakeParser();
  const repository = new FakeRepository();
  const subject = new BookImportService({
    dialog,
    fileStorage,
    hasher: new FakeHasher(),
    idGenerator: () => 'book-1',
    metadataParser,
    now: () => 100,
    repository,
  });
  return { dialog, fileStorage, metadataParser, repository, subject };
}

describe('BookImportService', () => {
  it('imports a valid EPUB and creates its repository record', async () => {
    const { repository, subject } = createSubject();

    await expect(subject.importEpub()).resolves.toMatchObject({
      status: 'created',
      book: { id: 'book-1', title: '新图书', fileHash: HASH, fileSize: 3 },
    });
    expect(repository.books).toHaveLength(1);
  });

  it('imports a valid PDF without sending it through the EPUB parser', async () => {
    const { dialog, fileStorage, metadataParser, subject } = createSubject();
    dialog.selection = {
      fileName: 'PDF Reference.pdf',
      path: '/selected/PDF Reference.pdf',
    };
    fileStorage.source = new TextEncoder().encode('%PDF-1.7 fixture');
    fileStorage.sourceSize = fileStorage.source.byteLength;
    const parse = vi.spyOn(metadataParser, 'parse');

    await expect(subject.importBook()).resolves.toMatchObject({
      status: 'created',
      book: {
        format: 'pdf',
        title: 'PDF Reference',
        filePath: 'light-reader/books/book-1/book.pdf',
      },
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects a PDF extension with a missing PDF signature', async () => {
    const { dialog, subject } = createSubject();
    dialog.selection = { fileName: 'broken.pdf', path: '/selected/broken.pdf' };

    await expect(subject.importBook()).rejects.toMatchObject({
      code: 'INVALID_PDF',
    } satisfies Partial<AppError>);
  });

  it('returns quietly when the user cancels', async () => {
    const { dialog, fileStorage, subject } = createSubject();
    dialog.selection = null;

    await expect(subject.importEpub()).resolves.toEqual({
      status: 'cancelled',
    });
    expect(fileStorage.stageCount).toBe(0);
  });

  it('maps an existing hash to the duplicate result without copying', async () => {
    const { fileStorage, repository, subject } = createSubject();
    repository.books.push(createBook());

    await expect(subject.importEpub()).resolves.toMatchObject({
      status: 'duplicate',
      book: { id: 'existing-book' },
    });
    expect(fileStorage.stageCount).toBe(0);
  });

  it('rejects an oversized EPUB before reading it into memory', async () => {
    const { fileStorage, subject } = createSubject();
    fileStorage.sourceSize = MAX_EPUB_FILE_SIZE + 1;

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'EPUB_TOO_LARGE',
    } satisfies Partial<AppError>);
    expect(fileStorage.readCount).toBe(0);
    expect(fileStorage.stageCount).toBe(0);
  });

  it('maps a missing selected file to the file-read state', async () => {
    const { fileStorage, subject } = createSubject();
    fileStorage.sourceSizeFailure = new Error('No such file or directory');

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'FILE_READ_FAILED',
    } satisfies Partial<AppError>);
    expect(fileStorage.readCount).toBe(0);
  });

  it('maps a denied application-directory write to the file-write state', async () => {
    const { fileStorage, subject } = createSubject();
    fileStorage.stageFailure = new Error('Permission denied');

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'FILE_WRITE_FAILED',
    } satisfies Partial<AppError>);
    expect(fileStorage.stageCount).toBe(1);
  });

  it('imports metadata with a missing author', async () => {
    const { metadataParser, subject } = createSubject();
    metadataParser.parsed.metadata.creators = [];

    await expect(subject.importEpub()).resolves.toMatchObject({
      status: 'created',
      book: { author: null },
    });
  });

  it('preserves the EPUB parser error type', async () => {
    const { metadataParser, subject } = createSubject();
    metadataParser.failure = new AppError('INVALID_EPUB');

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'INVALID_EPUB',
    } satisfies Partial<AppError>);
  });

  it('rolls back staged files when finalizing the copy fails', async () => {
    const { fileStorage, subject } = createSubject();
    fileStorage.commitFailure = true;

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'FILE_WRITE_FAILED',
    } satisfies Partial<AppError>);
    expect(fileStorage.rollbackCount).toBeGreaterThan(0);
  });

  it('removes finalized and temporary files when the database write fails', async () => {
    const { fileStorage, repository, subject } = createSubject();
    repository.failCreate = true;

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'DATABASE_WRITE_FAILED',
    } satisfies Partial<AppError>);
    expect(fileStorage.rollbackCount).toBeGreaterThan(0);
    expect(repository.books).toEqual([]);
  });

  it('retains finalized files when an inserted row cannot be compensated', async () => {
    const { fileStorage, repository, subject } = createSubject();
    repository.commitThenFail = true;
    repository.failDelete = true;

    await expect(subject.importEpub()).rejects.toMatchObject({
      code: 'DATABASE_WRITE_FAILED',
    } satisfies Partial<AppError>);
    expect(repository.books).toHaveLength(1);
    expect(fileStorage.rollbackCount).toBe(0);
  });
});

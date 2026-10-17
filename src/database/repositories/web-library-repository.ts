import type { ReaderSettingsRepository } from './reader-settings-repository';
import type { BookRepository } from './book-repository';
import type { NoteRepository } from './note-repository';
import type { LibraryRepository } from './library-repository';
import {
  bookSchema,
  bookMetadataSchema,
} from '../../features/library/domain/book';
import {
  bookDetailsSchema,
  bookListOptionsSchema,
  libraryBookSchema,
  normalizeBookTags,
  noteReferenceUpdateSchema,
  type BookDetails,
  type BookListOptions,
  type LibraryBook,
  type NoteReferenceUpdate,
} from '../../features/library/domain/library';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import {
  webLibraryMetadataSchema,
  type WebLibraryMetadata,
} from '../web/web-records';
import { parseRecords } from '../web/web-repository-support';

export class WebLibraryRepository implements LibraryRepository {
  private readonly bookRepository: BookRepository;
  private readonly noteRepository: NoteRepository;
  private readonly settingsRepository: ReaderSettingsRepository;
  private readonly database: WebDatabase;

  constructor(
    bookRepository: BookRepository,
    noteRepository: NoteRepository,
    settingsRepository: ReaderSettingsRepository,
    database: WebDatabase = getWebDatabase(),
  ) {
    this.bookRepository = bookRepository;
    this.noteRepository = noteRepository;
    this.settingsRepository = settingsRepository;
    this.database = database;
  }

  async list(value: BookListOptions): Promise<LibraryBook[]> {
    const options = bookListOptionsSchema.parse(value);
    try {
      const books = await this.bookRepository.list();
      const metadata = new Map(
        (await this.readMetadata()).map((item) => [item.bookId, item]),
      );
      const results = await Promise.all(
        books.map(async (book) => {
          const stored = metadata.get(book.id);
          const state = await this.settingsRepository
            .getReadingState(book.id)
            .catch(() => null);
          return libraryBookSchema.parse({
            ...book,
            favorite: stored?.favorite ?? false,
            tags: stored?.tags ?? [],
            lastReadAt: state?.updatedAt ?? null,
          });
        }),
      );
      const query = options.query.toLocaleLowerCase();
      return results
        .filter(
          (book) =>
            (!options.favoritesOnly || book.favorite) &&
            (!query ||
              book.title.toLocaleLowerCase().includes(query) ||
              (book.author ?? '').toLocaleLowerCase().includes(query) ||
              book.tags.some((tag) => tag.toLocaleLowerCase().includes(query))),
        )
        .sort((left, right) => this.compare(left, right, options.sort));
    } catch (error) {
      throw new AppError('DATABASE_READ_FAILED', { cause: error });
    }
  }

  async setFavorite(bookId: string, favorite: boolean): Promise<LibraryBook> {
    await this.updateMetadata(bookId, (current) => ({ ...current, favorite }));
    return this.requireBook(bookId);
  }

  async replaceTags(bookId: string, values: string[]): Promise<LibraryBook> {
    const tags = normalizeBookTags(values);
    await this.updateMetadata(bookId, (current) => ({ ...current, tags }));
    return this.requireBook(bookId);
  }

  async updateDetails(
    bookId: string,
    value: BookDetails,
  ): Promise<LibraryBook> {
    const details = bookDetailsSchema.parse(value);
    const book = await this.requireExistingBook(bookId);
    try {
      await this.database.write([
        {
          type: 'put',
          store: 'books',
          value: bookSchema.parse({
            ...book,
            title: details.title,
            author: details.author,
            metadata: bookMetadataSchema.parse({
              ...book.metadata,
              series: details.series,
            }),
            updatedAt: Date.now(),
          }),
        },
      ]);
    } catch (error) {
      throw new AppError('BOOK_UPDATE_FAILED', { cause: error });
    }
    return this.requireBook(bookId);
  }

  async deleteBook(
    bookId: string,
    values: NoteReferenceUpdate[],
  ): Promise<void> {
    const updates = noteReferenceUpdateSchema.array().parse(values);
    await this.requireExistingBook(bookId);
    const originals = (
      await Promise.all(
        updates.map((update) => this.noteRepository.findById(update.id)),
      )
    ).filter((note) => note !== null);
    try {
      for (const update of updates) {
        await this.noteRepository.update(update.id, {
          title: update.title,
          document: update.document,
        });
      }
      // Removes tags, favorites, and other dependent records in one transaction.
      await this.bookRepository.delete(bookId);
    } catch (error) {
      await Promise.allSettled(
        originals.map((note) =>
          this.noteRepository.update(note.id, {
            title: note.title,
            document: note.document,
          }),
        ),
      );
      throw new AppError('BOOK_DELETE_FAILED', { cause: error });
    }
  }

  private async requireBook(bookId: string): Promise<LibraryBook> {
    const book = (
      await this.list({
        query: '',
        sort: 'added',
        favoritesOnly: false,
      })
    ).find((item) => item.id === bookId);
    if (!book) throw new AppError('BOOK_NOT_FOUND');
    return book;
  }

  private async requireExistingBook(bookId: string) {
    const book = await this.bookRepository.findById(bookId);
    if (!book) throw new AppError('BOOK_NOT_FOUND');
    return book;
  }

  private compare(
    left: LibraryBook,
    right: LibraryBook,
    sort: BookListOptions['sort'],
  ): number {
    if (sort === 'title') return left.title.localeCompare(right.title);
    if (sort === 'added') return right.createdAt - left.createdAt;
    if (left.lastReadAt === null && right.lastReadAt === null) {
      return right.createdAt - left.createdAt;
    }
    if (left.lastReadAt === null) return 1;
    if (right.lastReadAt === null) return -1;
    return right.lastReadAt - left.lastReadAt;
  }

  private async readMetadata(): Promise<WebLibraryMetadata[]> {
    return parseRecords(
      webLibraryMetadataSchema,
      await this.database.getAll('libraryMetadata'),
    );
  }

  private async updateMetadata(
    bookId: string,
    transform: (current: WebLibraryMetadata) => WebLibraryMetadata,
  ): Promise<void> {
    await this.requireExistingBook(bookId);
    try {
      const stored = await this.database.get('libraryMetadata', bookId);
      const current =
        stored === undefined
          ? { bookId, favorite: false, tags: [] }
          : webLibraryMetadataSchema.parse(stored);
      await this.database.write([
        {
          type: 'put',
          store: 'libraryMetadata',
          value: webLibraryMetadataSchema.parse(transform(current)),
        },
      ]);
    } catch (error) {
      throw new AppError('BOOK_UPDATE_FAILED', { cause: error });
    }
  }
}

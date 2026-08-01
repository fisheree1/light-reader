import { z } from 'zod';

import type { ReaderSettingsRepository } from './reader-settings-repository';
import type { BookRepository } from './book-repository';
import type { NoteRepository } from './note-repository';
import type { LibraryRepository } from './library-repository';
import {
  bookListOptionsSchema,
  libraryBookSchema,
  normalizeBookTags,
  noteReferenceUpdateSchema,
  type BookListOptions,
  type LibraryBook,
  type NoteReferenceUpdate,
} from '../../features/library/domain/library';
import { AppError } from '../../lib/app-error';

const storageKey = 'light-reader-web-library-metadata';
const metadataSchema = z.record(
  z.string(),
  z.object({
    favorite: z.boolean(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
  }),
);
type StoredMetadata = z.infer<typeof metadataSchema>;

export class WebLibraryRepository implements LibraryRepository {
  private readonly bookRepository: BookRepository;
  private readonly noteRepository: NoteRepository;
  private readonly settingsRepository: ReaderSettingsRepository;

  constructor(
    bookRepository: BookRepository,
    noteRepository: NoteRepository,
    settingsRepository: ReaderSettingsRepository,
  ) {
    this.bookRepository = bookRepository;
    this.noteRepository = noteRepository;
    this.settingsRepository = settingsRepository;
  }

  async list(value: BookListOptions): Promise<LibraryBook[]> {
    const options = bookListOptionsSchema.parse(value);
    try {
      const books = await this.bookRepository.list();
      const metadata = this.readMetadata();
      const results = await Promise.all(
        books.map(async (book) => {
          const stored = metadata[book.id] ?? { favorite: false, tags: [] };
          const state = await this.settingsRepository
            .getReadingState(book.id)
            .catch(() => null);
          return libraryBookSchema.parse({
            ...book,
            ...stored,
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
    await this.requireExistingBook(bookId);
    const metadata = this.readMetadata();
    const current = metadata[bookId] ?? { favorite: false, tags: [] };
    metadata[bookId] = { ...current, favorite };
    this.writeMetadata(metadata);
    return this.requireBook(bookId);
  }

  async replaceTags(bookId: string, values: string[]): Promise<LibraryBook> {
    await this.requireExistingBook(bookId);
    const metadata = this.readMetadata();
    const current = metadata[bookId] ?? { favorite: false, tags: [] };
    metadata[bookId] = { ...current, tags: normalizeBookTags(values) };
    this.writeMetadata(metadata);
    return this.requireBook(bookId);
  }

  async deleteBook(
    bookId: string,
    values: NoteReferenceUpdate[],
  ): Promise<void> {
    const updates = noteReferenceUpdateSchema.array().parse(values);
    const book = await this.requireExistingBook(bookId);
    const originalMetadata = this.readMetadata();
    const originals = (
      await Promise.all(
        updates.map((update) => this.noteRepository.findById(update.id)),
      )
    ).filter((note) => note !== null);
    let bookDeleted = false;
    try {
      for (const update of updates) {
        await this.noteRepository.update(update.id, {
          title: update.title,
          document: update.document,
        });
      }
      await this.bookRepository.delete(bookId);
      bookDeleted = true;
      this.writeMetadata(
        Object.fromEntries(
          Object.entries(originalMetadata).filter(([id]) => id !== bookId),
        ),
      );
    } catch (error) {
      if (bookDeleted) {
        await this.bookRepository.create(book).catch(() => undefined);
      }
      try {
        this.writeMetadata(originalMetadata);
      } catch {
        // The original failure remains the actionable error.
      }
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

  private readMetadata(): StoredMetadata {
    const value = localStorage.getItem(storageKey);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    return metadataSchema.parse(parsed);
  }

  private writeMetadata(value: StoredMetadata): void {
    localStorage.setItem(storageKey, JSON.stringify(value));
  }
}

export { storageKey as WEB_LIBRARY_METADATA_KEY };

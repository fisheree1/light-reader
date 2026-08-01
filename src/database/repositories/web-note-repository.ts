import {
  extractPlainText,
  noteSaveInputSchema,
  noteSchema,
  type Note,
  type NoteSaveInput,
} from '../../features/notes/domain/note';
import { AppError } from '../../lib/app-error';
import type { NoteRepository } from './note-repository';

const storageKey = 'light-reader-web-notes';

export class WebNoteRepository implements NoteRepository {
  create(value: Note): Promise<Note> {
    return this.writeResult(() => {
      const note = noteSchema.parse(value);
      const notes = this.read();
      if (notes.some((item) => item.id === note.id)) {
        throw new Error('Duplicate note id');
      }
      const created = {
        ...note,
        documentRecovered: false,
        plainText: extractPlainText(note.document),
      };
      this.write([created, ...notes]);
      return created;
    });
  }

  findById(id: string): Promise<Note | null> {
    return this.readResult(
      () => this.read().find((note) => note.id === id) ?? null,
    );
  }

  list(titleQuery = ''): Promise<Note[]> {
    return this.readResult(() => {
      const query = titleQuery.trim().toLocaleLowerCase();
      return this.read()
        .filter((note) => note.title.toLocaleLowerCase().includes(query))
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        );
    });
  }

  update(id: string, value: NoteSaveInput): Promise<Note> {
    return this.writeResult(() => {
      const input = noteSaveInputSchema.parse(value);
      const notes = this.read();
      const current = notes.find((note) => note.id === id);
      if (!current) throw new AppError('NOTE_NOT_FOUND');
      const updated = noteSchema.parse({
        ...current,
        ...input,
        plainText: extractPlainText(input.document),
        documentRecovered: false,
        updatedAt: Date.now(),
      });
      this.write(notes.map((note) => (note.id === id ? updated : note)));
      return updated;
    });
  }

  delete(id: string): Promise<void> {
    return this.writeResult(() => {
      this.write(this.read().filter((note) => note.id !== id));
    });
  }

  private read(): Note[] {
    const value = localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return noteSchema.array().parse(parsed);
  }

  private write(notes: Note[]): void {
    localStorage.setItem(storageKey, JSON.stringify(notes));
  }

  private readResult<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('NOTE_READ_FAILED', { cause: error });
      });
  }

  private writeResult<T>(action: () => T): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError('NOTE_WRITE_FAILED', { cause: error });
      });
  }
}

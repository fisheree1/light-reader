import {
  extractPlainText,
  noteSaveInputSchema,
  noteSchema,
  type Note,
  type NoteSaveInput,
} from '../../features/notes/domain/note';
import { AppError } from '../../lib/app-error';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { parseRecords, withAppError } from '../web/web-repository-support';
import type { NoteRepository } from './note-repository';

export class WebNoteRepository implements NoteRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  create(value: Note): Promise<Note> {
    return withAppError('NOTE_WRITE_FAILED', async () => {
      const note = noteSchema.parse(value);
      const created = {
        ...note,
        documentRecovered: false,
        plainText: extractPlainText(note.document),
      };
      await this.database.write([
        { type: 'add', store: 'notes', value: created },
      ]);
      return created;
    });
  }

  findById(id: string): Promise<Note | null> {
    return withAppError('NOTE_READ_FAILED', async () => {
      const value = await this.database.get('notes', id);
      return value === undefined ? null : noteSchema.parse(value);
    });
  }

  list(titleQuery = ''): Promise<Note[]> {
    return withAppError('NOTE_READ_FAILED', async () => {
      const query = titleQuery.trim().toLocaleLowerCase();
      return parseRecords(noteSchema, await this.database.getAll('notes'))
        .filter((note) => note.title.toLocaleLowerCase().includes(query))
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        );
    });
  }

  update(id: string, value: NoteSaveInput): Promise<Note> {
    return withAppError('NOTE_WRITE_FAILED', async () => {
      const input = noteSaveInputSchema.parse(value);
      const current = await this.findById(id);
      if (!current) throw new AppError('NOTE_NOT_FOUND');
      const updated = noteSchema.parse({
        ...current,
        ...input,
        plainText: extractPlainText(input.document),
        documentRecovered: false,
        updatedAt: Date.now(),
      });
      await this.database.write([
        { type: 'put', store: 'notes', value: updated },
      ]);
      return updated;
    });
  }

  delete(id: string): Promise<void> {
    return withAppError('NOTE_WRITE_FAILED', () =>
      this.database.write([{ type: 'delete', store: 'notes', key: id }]),
    );
  }
}

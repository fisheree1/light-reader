import {
  extractPlainText,
  noteSaveInputSchema,
  noteSchema,
  type Note,
  type NoteSaveInput,
} from '../../features/notes/domain/note';
import { AppError, isAppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import { mapNoteRecord, type NoteRecord } from '../schema/note-record';
import type { NoteRepository } from './note-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const noteColumns =
  'id, title, content_json, plain_text, created_at, updated_at';

function validId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new AppError('NOTE_NOT_FOUND');
  return id;
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

export class SqliteNoteRepository implements NoteRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async create(value: Note): Promise<Note> {
    const note = noteSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO notes (
          id, title, content_json, plain_text, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          note.id,
          note.title,
          JSON.stringify(note.document),
          extractPlainText(note.document),
          note.createdAt,
          note.updatedAt,
        ],
      );
      return { ...note, plainText: extractPlainText(note.document) };
    } catch (error) {
      throw new AppError('NOTE_WRITE_FAILED', { cause: error });
    }
  }

  async findById(id: string): Promise<Note | null> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<NoteRecord[]>(
        `SELECT ${noteColumns} FROM notes WHERE id = $1 LIMIT 1`,
        [validId(id)],
      );
      return rows[0] ? mapNoteRecord(rows[0]) : null;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('NOTE_READ_FAILED', { cause: error });
    }
  }

  async list(titleQuery = ''): Promise<Note[]> {
    try {
      const database = await this.databaseProvider();
      const query = titleQuery.trim();
      const rows = await database.select<NoteRecord[]>(
        query
          ? `SELECT ${noteColumns} FROM notes
             WHERE title LIKE $1 ESCAPE '\\' COLLATE NOCASE
             ORDER BY updated_at DESC, id ASC`
          : `SELECT ${noteColumns} FROM notes
             ORDER BY updated_at DESC, id ASC`,
        query ? [`%${escapeLike(query)}%`] : [],
      );
      return rows.map(mapNoteRecord);
    } catch (error) {
      throw new AppError('NOTE_READ_FAILED', { cause: error });
    }
  }

  async update(id: string, value: NoteSaveInput): Promise<Note> {
    const input = noteSaveInputSchema.parse(value);
    const noteId = validId(id);
    const now = Date.now();
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `UPDATE notes
         SET title = $1, content_json = $2, plain_text = $3, updated_at = $4
         WHERE id = $5`,
        [
          input.title,
          JSON.stringify(input.document),
          extractPlainText(input.document),
          now,
          noteId,
        ],
      );
      const note = await this.findById(noteId);
      if (!note) throw new AppError('NOTE_NOT_FOUND');
      return note;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('NOTE_WRITE_FAILED', { cause: error });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute('DELETE FROM notes WHERE id = $1', [validId(id)]);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('NOTE_WRITE_FAILED', { cause: error });
    }
  }
}

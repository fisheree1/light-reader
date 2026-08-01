import type { Note, NoteSaveInput } from '../../features/notes/domain/note';

export interface NoteRepository {
  create(note: Note): Promise<Note>;
  findById(id: string): Promise<Note | null>;
  list(titleQuery?: string): Promise<Note[]>;
  update(id: string, input: NoteSaveInput): Promise<Note>;
  delete(id: string): Promise<void>;
}

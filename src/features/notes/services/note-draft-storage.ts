import { z } from 'zod';

import {
  extractPlainText,
  noteDocumentSchema,
  noteSchema,
  type Note,
} from '../domain/note';

const draftPrefix = 'light-reader-note-draft:';
const noteDraftSchema = z
  .object({
    baseUpdatedAt: z.number().int().nonnegative(),
    document: noteDocumentSchema,
    draftedAt: z.number().int().nonnegative(),
    noteId: z.string().trim().min(1).max(128),
    title: z.string().max(500),
    version: z.literal(1),
  })
  .strict();

export interface NoteDraftStorage {
  clear(noteId: string): void;
  recover(note: Note): Note | null;
  write(note: Note, baseUpdatedAt: number): void;
}

function keyFor(noteId: string): string {
  return `${draftPrefix}${encodeURIComponent(noteId)}`;
}

export class LocalNoteDraftStorage implements NoteDraftStorage {
  clear(noteId: string): void {
    try {
      localStorage.removeItem(keyFor(noteId));
    } catch {
      // A successful SQLite write remains authoritative if browser storage is
      // unavailable. A stale draft is rejected later by baseUpdatedAt.
    }
  }

  recover(note: Note): Note | null {
    const key = keyFor(note.id);
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;
      const draft = noteDraftSchema.parse(JSON.parse(value) as unknown);
      if (draft.noteId !== note.id || draft.baseUpdatedAt !== note.updatedAt) {
        localStorage.removeItem(key);
        return null;
      }
      return noteSchema.parse({
        ...note,
        title: draft.title.trim() || '未命名笔记',
        document: draft.document,
        plainText: extractPlainText(draft.document),
        documentRecovered: false,
      });
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // Recovery still safely falls back to SQLite.
      }
      return null;
    }
  }

  write(note: Note, baseUpdatedAt: number): void {
    const draft = noteDraftSchema.parse({
      baseUpdatedAt,
      document: note.document,
      draftedAt: Date.now(),
      noteId: note.id,
      title: note.title,
      version: 1,
    });
    localStorage.setItem(keyFor(note.id), JSON.stringify(draft));
  }
}

export { draftPrefix as NOTE_DRAFT_STORAGE_PREFIX };

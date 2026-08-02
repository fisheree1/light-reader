import { isTauri } from '@tauri-apps/api/core';

import type { NoteRepository } from '../../../database/repositories/note-repository';
import { SqliteNoteRepository } from '../../../database/repositories/sqlite-note-repository';
import { WebNoteRepository } from '../../../database/repositories/web-note-repository';
import type { BookRepository } from '../../../database/repositories/book-repository';
import { libraryServices } from '../../library/services/library-services';
import { NoteService } from './note-service';
import {
  LocalNoteDraftStorage,
  type NoteDraftStorage,
} from './note-draft-storage';

export interface NotesServices {
  bookRepository: BookRepository;
  draftStorage?: NoteDraftStorage;
  noteRepository: NoteRepository;
}

const noteRepository = isTauri()
  ? new SqliteNoteRepository()
  : new WebNoteRepository();

export const notesServices: NotesServices = {
  bookRepository: libraryServices.repository,
  draftStorage: new LocalNoteDraftStorage(),
  noteRepository,
};

export const noteService = new NoteService(noteRepository);

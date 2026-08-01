import { isTauri } from '@tauri-apps/api/core';

import type { BookRepository } from '../../../database/repositories/book-repository';
import type { NoteRepository } from '../../../database/repositories/note-repository';
import type { AnnotationRepository } from '../../../database/repositories/annotation-repository';
import { SqliteAnnotationRepository } from '../../../database/repositories/sqlite-annotation-repository';
import { WebAnnotationRepository } from '../../../database/repositories/web-annotation-repository';
import type { ReaderSettingsRepository } from '../../../database/repositories/reader-settings-repository';
import { SqliteReaderSettingsRepository } from '../../../database/repositories/sqlite-reader-settings-repository';
import { WebReaderSettingsRepository } from '../../../database/repositories/web-reader-settings-repository';
import { FoliateEbookReader } from '../../../reader-engines/foliate-ebook-reader';
import type { EbookReader } from '../../../reader-engines/types';
import { libraryServices } from '../../library/services/library-services';
import { notesServices } from '../../notes/services/notes-services';
import {
  TauriReaderBookSource,
  type ReaderBookSource,
} from './reader-book-source';
import { WebReaderBookSource } from './web-reader-book-source';

export interface ReaderServices {
  annotationRepository: AnnotationRepository;
  createReader(): EbookReader;
  noteRepository?: NoteRepository;
  repository: BookRepository;
  settingsRepository: ReaderSettingsRepository;
  source: ReaderBookSource;
}

export const readerServices: ReaderServices = {
  annotationRepository: isTauri()
    ? new SqliteAnnotationRepository()
    : new WebAnnotationRepository(),
  repository: libraryServices.repository,
  noteRepository: notesServices.noteRepository,
  settingsRepository: isTauri()
    ? new SqliteReaderSettingsRepository()
    : new WebReaderSettingsRepository(),
  source: isTauri() ? new TauriReaderBookSource() : new WebReaderBookSource(),
  createReader: () => new FoliateEbookReader(),
};

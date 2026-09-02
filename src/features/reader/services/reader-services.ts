import { isTauri } from '@tauri-apps/api/core';

import type { BookRepository } from '../../../database/repositories/book-repository';
import type { NoteRepository } from '../../../database/repositories/note-repository';
import type { AnnotationRepository } from '../../../database/repositories/annotation-repository';
import type { BookmarkRepository } from '../../../database/repositories/bookmark-repository';
import type { ReadingActivityRepository } from '../../../database/repositories/reading-activity-repository';
import { SqliteAnnotationRepository } from '../../../database/repositories/sqlite-annotation-repository';
import { SqliteBookmarkRepository } from '../../../database/repositories/sqlite-bookmark-repository';
import { SqliteReadingActivityRepository } from '../../../database/repositories/sqlite-reading-activity-repository';
import { WebAnnotationRepository } from '../../../database/repositories/web-annotation-repository';
import { WebBookmarkRepository } from '../../../database/repositories/web-bookmark-repository';
import { WebReadingActivityRepository } from '../../../database/repositories/web-reading-activity-repository';
import type { ReaderSettingsRepository } from '../../../database/repositories/reader-settings-repository';
import { SqliteReaderSettingsRepository } from '../../../database/repositories/sqlite-reader-settings-repository';
import { WebReaderSettingsRepository } from '../../../database/repositories/web-reader-settings-repository';
import { FoliateEbookReader } from '../../../reader-engines/foliate-ebook-reader';
import { PdfEbookReader } from '../../../reader-engines/pdf-ebook-reader';
import type { EbookReader } from '../../../reader-engines/types';
import type { BookFormat } from '../../library/domain/book';
import type { FileExportPlatform } from '../../../platform/export/file-export-platform';
import {
  TauriFileExportPlatform,
  WebFileExportPlatform,
} from '../../../platform/export/file-export-platform';
import { libraryServices } from '../../library/services/library-services';
import { notesServices } from '../../notes/services/notes-services';
import {
  TauriReaderBookSource,
  type ReaderBookSource,
} from './reader-book-source';
import { WebReaderBookSource } from './web-reader-book-source';

export interface ReaderServices {
  annotationRepository: AnnotationRepository;
  bookmarkRepository?: BookmarkRepository;
  createReader(format: BookFormat): EbookReader;
  exportPlatform?: FileExportPlatform;
  noteRepository?: NoteRepository;
  repository: BookRepository;
  readingActivityRepository?: ReadingActivityRepository;
  settingsRepository: ReaderSettingsRepository;
  source: ReaderBookSource;
}

export const readerServices: ReaderServices = {
  annotationRepository: isTauri()
    ? new SqliteAnnotationRepository()
    : new WebAnnotationRepository(),
  bookmarkRepository: isTauri()
    ? new SqliteBookmarkRepository()
    : new WebBookmarkRepository(),
  repository: libraryServices.repository,
  readingActivityRepository: isTauri()
    ? new SqliteReadingActivityRepository()
    : new WebReadingActivityRepository(libraryServices.repository),
  noteRepository: notesServices.noteRepository,
  settingsRepository: isTauri()
    ? new SqliteReaderSettingsRepository()
    : new WebReaderSettingsRepository(),
  source: isTauri() ? new TauriReaderBookSource() : new WebReaderBookSource(),
  createReader: (format) =>
    format === 'pdf' ? new PdfEbookReader() : new FoliateEbookReader(),
  exportPlatform: isTauri()
    ? new TauriFileExportPlatform()
    : new WebFileExportPlatform(),
};

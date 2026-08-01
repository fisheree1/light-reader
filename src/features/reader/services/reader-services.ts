import { isTauri } from '@tauri-apps/api/core';

import type { BookRepository } from '../../../database/repositories/book-repository';
import { FoliateEbookReader } from '../../../reader-engines/foliate-ebook-reader';
import type { EbookReader } from '../../../reader-engines/types';
import { libraryServices } from '../../library/services/library-services';
import {
  TauriReaderBookSource,
  type ReaderBookSource,
} from './reader-book-source';
import { WebReaderBookSource } from './web-reader-book-source';

export interface ReaderServices {
  createReader(): EbookReader;
  repository: BookRepository;
  source: ReaderBookSource;
}

export const readerServices: ReaderServices = {
  repository: libraryServices.repository,
  source: isTauri() ? new TauriReaderBookSource() : new WebReaderBookSource(),
  createReader: () => new FoliateEbookReader(),
};

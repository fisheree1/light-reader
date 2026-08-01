import { isTauri } from '@tauri-apps/api/core';

import type { SearchRepository } from '../../../database/repositories/search-repository';
import { SqliteSearchRepository } from '../../../database/repositories/sqlite-search-repository';
import { WebAnnotationRepository } from '../../../database/repositories/web-annotation-repository';
import { WebSearchRepository } from '../../../database/repositories/web-search-repository';
import { libraryServices } from '../../library/services/library-services';
import { notesServices } from '../../notes/services/notes-services';
import { TauriReaderBookSource } from '../../reader/services/reader-book-source';
import { WebReaderBookSource } from '../../reader/services/web-reader-book-source';
import { FflateEpubContentParser } from './epub-content-parser';
import { LocalSearchService } from './local-search-service';

export interface SearchServices {
  localSearch: LocalSearchService;
  repository: SearchRepository;
}

function createSearchServices(): SearchServices {
  const repository = isTauri()
    ? new SqliteSearchRepository()
    : new WebSearchRepository(
        notesServices.noteRepository,
        new WebAnnotationRepository(),
        libraryServices.repository,
      );
  return {
    repository,
    localSearch: new LocalSearchService(
      repository,
      libraryServices.repository,
      isTauri() ? new TauriReaderBookSource() : new WebReaderBookSource(),
      new FflateEpubContentParser(),
    ),
  };
}

export const searchServices = createSearchServices();

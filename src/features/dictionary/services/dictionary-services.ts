import { isTauri } from '@tauri-apps/api/core';

import { SqliteDictionaryRepository } from '../../../database/repositories/sqlite-dictionary-repository';
import { WebDictionaryRepository } from '../../../database/repositories/web-dictionary-repository';
import {
  TauriDictionaryFilePicker,
  WebDictionaryFilePicker,
  type DictionaryFilePicker,
} from '../../../platform/dialog/dictionary-file-picker';
import { WebFileDialogAdapter } from '../../../platform/dialog/web-file-dialog-adapter';
import {
  BrowserSpeechPlatform,
  type SpeechPlatform,
} from '../../../platform/speech/speech-platform';
import {
  TauriDictionaryFileStorage,
  WebDictionaryFileStorage,
} from '../../../storage/dictionary-file-storage';
import { webSelectedBookSourceRegistry } from '../../../storage/web-book-file-storage';
import { DictionaryService } from './dictionary-service';

export interface DictionaryServices {
  dictionary: DictionaryService;
  picker: DictionaryFilePicker;
  speech: SpeechPlatform;
}

export const dictionaryServices: DictionaryServices = isTauri()
  ? {
      dictionary: new DictionaryService({
        files: new TauriDictionaryFileStorage(),
        repository: new SqliteDictionaryRepository(),
      }),
      picker: new TauriDictionaryFilePicker(),
      speech: new BrowserSpeechPlatform(),
    }
  : {
      dictionary: new DictionaryService({
        files: new WebDictionaryFileStorage(),
        repository: new WebDictionaryRepository(),
      }),
      picker: new WebDictionaryFilePicker(
        new WebFileDialogAdapter(webSelectedBookSourceRegistry),
      ),
      speech: new BrowserSpeechPlatform(),
    };

import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

import type { DictionarySourceFile } from '../../features/dictionary/services/dictionary-service';
import { fileNameFromPath } from '../../storage/book-paths';
import type { WebFileDialogAdapter } from './web-file-dialog-adapter';
import { translate } from '../../i18n/i18n';

const extensions = ['ifo', 'idx', 'dz', 'syn'];

/** Lets the user pick the files of one StarDict dictionary. */
export interface DictionaryFilePicker {
  pick(): Promise<DictionarySourceFile[] | null>;
}

export class TauriDictionaryFilePicker implements DictionaryFilePicker {
  async pick(): Promise<DictionarySourceFile[] | null> {
    const paths = await open({
      directory: false,
      multiple: true,
      filters: [{ name: translate('dialogs.stardict'), extensions }],
      title: translate('dialogs.pickDictionary'),
    });
    if (!Array.isArray(paths) || paths.length === 0) return null;
    return Promise.all(
      paths.map(async (path) => ({
        fileName: fileNameFromPath(path),
        data: await readFile(path),
      })),
    );
  }
}

export class WebDictionaryFilePicker implements DictionaryFilePicker {
  private readonly dialog: Pick<WebFileDialogAdapter, 'selectFiles'>;

  constructor(dialog: Pick<WebFileDialogAdapter, 'selectFiles'>) {
    this.dialog = dialog;
  }

  async pick(): Promise<DictionarySourceFile[] | null> {
    const files = await this.dialog.selectFiles(
      extensions.map((extension) => `.${extension}`).join(','),
      true,
    );
    if (files.length === 0) return null;
    return Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      })),
    );
  }
}

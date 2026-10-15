import { open } from '@tauri-apps/plugin-dialog';

import { supportedBookFormats } from '../../features/library/domain/book';

import { fileNameFromPath } from '../../storage/book-paths';
import { translate } from '../../i18n/i18n';

export interface SelectedBookFile {
  fileName: string;
  path: string;
}

export interface FileDialogAdapter {
  selectEpub(): Promise<SelectedBookFile | null>;
  selectBook?(): Promise<SelectedBookFile | null>;
  selectBooks?(): Promise<SelectedBookFile[] | null>;
}

export class TauriFileDialogAdapter implements FileDialogAdapter {
  async selectBooks(): Promise<SelectedBookFile[] | null> {
    const paths = await open({
      directory: false,
      multiple: true,
      filters: [
        {
          name: translate('dialogs.ebooks'),
          extensions: [...supportedBookFormats],
        },
      ],
      title: translate('dialogs.importBooks'),
    });
    if (!Array.isArray(paths) || paths.length === 0) return null;
    return paths.map((path) => ({
      fileName: fileNameFromPath(path),
      path,
    }));
  }

  async selectBook(): Promise<SelectedBookFile | null> {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [
        {
          name: translate('dialogs.ebooks'),
          extensions: [...supportedBookFormats],
        },
      ],
      title: translate('dialogs.importBook'),
    });

    return typeof path === 'string'
      ? { fileName: fileNameFromPath(path), path }
      : null;
  }

  async selectEpub(): Promise<SelectedBookFile | null> {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: translate('dialogs.epubBooks'), extensions: ['epub'] }],
      title: translate('dialogs.importEpub'),
    });

    return typeof path === 'string'
      ? { fileName: fileNameFromPath(path), path }
      : null;
  }
}

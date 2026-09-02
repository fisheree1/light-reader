import { open } from '@tauri-apps/plugin-dialog';

import { fileNameFromPath } from '../../storage/book-paths';

export interface SelectedBookFile {
  fileName: string;
  path: string;
}

export interface FileDialogAdapter {
  selectEpub(): Promise<SelectedBookFile | null>;
  selectBook?(): Promise<SelectedBookFile | null>;
}

export class TauriFileDialogAdapter implements FileDialogAdapter {
  async selectBook(): Promise<SelectedBookFile | null> {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: '电子书', extensions: ['epub', 'pdf'] }],
      title: '导入电子书',
    });

    return typeof path === 'string'
      ? { fileName: fileNameFromPath(path), path }
      : null;
  }

  async selectEpub(): Promise<SelectedBookFile | null> {
    const path = await open({
      directory: false,
      multiple: false,
      filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
      title: '导入 EPUB',
    });

    return typeof path === 'string'
      ? { fileName: fileNameFromPath(path), path }
      : null;
  }
}

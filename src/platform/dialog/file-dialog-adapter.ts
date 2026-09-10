import { open } from '@tauri-apps/plugin-dialog';

import { fileNameFromPath } from '../../storage/book-paths';

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
      filters: [{ name: '电子书', extensions: ['epub', 'pdf'] }],
      title: '批量导入电子书',
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

import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

export interface ExportFile {
  data: Uint8Array;
  defaultFileName: string;
  extension: string;
  mediaType: string;
}

export interface FileExportPlatform {
  save(file: ExportFile): Promise<'cancelled' | 'saved'>;
}

export class TauriFileExportPlatform implements FileExportPlatform {
  async save(file: ExportFile): Promise<'cancelled' | 'saved'> {
    const path = await save({
      defaultPath: file.defaultFileName,
      filters: [{ name: '导出文件', extensions: [file.extension] }],
      title: '导出',
    });
    if (!path) return 'cancelled';
    await writeFile(path, file.data);
    return 'saved';
  }
}

export class WebFileExportPlatform implements FileExportPlatform {
  save(file: ExportFile): Promise<'cancelled' | 'saved'> {
    const blob = new Blob([Uint8Array.from(file.data).buffer], {
      type: file.mediaType,
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.defaultFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return Promise.resolve('saved');
  }
}

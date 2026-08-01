import { AppError } from '../../../lib/app-error';
import { TauriBookFileStorage } from '../../../storage/book-file-storage';

export interface ReaderBookSource {
  read(filePath: string): Promise<ArrayBuffer>;
}

export class TauriReaderBookSource implements ReaderBookSource {
  private readonly storage: TauriBookFileStorage;

  constructor(storage = new TauriBookFileStorage()) {
    this.storage = storage;
  }

  async read(filePath: string): Promise<ArrayBuffer> {
    try {
      const data = await this.storage.readManagedBook(filePath);
      return Uint8Array.from(data).buffer;
    } catch (error) {
      throw new AppError('READER_OPEN_FAILED', { cause: error });
    }
  }
}

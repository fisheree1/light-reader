import { AppError } from '../../../lib/app-error';
import { webBookFileStorage } from '../../../storage/web-book-file-storage';
import type { ReaderBookSource } from './reader-book-source';

export class WebReaderBookSource implements ReaderBookSource {
  private readonly storage: Pick<typeof webBookFileStorage, 'readManagedBook'>;

  constructor(
    storage: Pick<
      typeof webBookFileStorage,
      'readManagedBook'
    > = webBookFileStorage,
  ) {
    this.storage = storage;
  }

  async read(filePath: string): Promise<ArrayBuffer> {
    try {
      const source = await this.storage.readManagedBook(filePath);
      return Uint8Array.from(source).buffer;
    } catch (error) {
      throw new AppError('READER_OPEN_FAILED', { cause: error });
    }
  }
}

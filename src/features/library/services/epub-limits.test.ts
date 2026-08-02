import { strToU8, unzipSync, zipSync } from 'fflate';

import { AppError } from '../../../lib/app-error';
import {
  assertEpubFileSize,
  createLimitedEpubZipFilter,
  MAX_EPUB_COMPRESSION_RATIO,
  MAX_EPUB_FILE_SIZE,
} from './epub-limits';

describe('EPUB resource limits', () => {
  it('validates the compressed EPUB file size without allocating it', () => {
    expect(() => assertEpubFileSize(MAX_EPUB_FILE_SIZE)).not.toThrow();
    expect(() => assertEpubFileSize(MAX_EPUB_FILE_SIZE + 1)).toThrowError(
      expect.objectContaining({ code: 'EPUB_TOO_LARGE' }) as AppError,
    );
  });

  it('rejects a selected ZIP entry with an excessive compression ratio', () => {
    const archive = zipSync({
      'chapter.xhtml': strToU8('a'.repeat(2 * 1024 * 1024)),
    });
    expect(() =>
      unzipSync(archive, {
        filter: createLimitedEpubZipFilter({
          include: () => true,
          maxEntrySize: () => 4 * 1024 * 1024,
          maxSelectedBytes: 4 * 1024 * 1024,
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'EPUB_TOO_LARGE' }));
    expect(MAX_EPUB_COMPRESSION_RATIO).toBeGreaterThan(1);
  });
});

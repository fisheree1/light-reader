import { z } from 'zod';

import { bookTagSchema } from '../../features/library/domain/library';
import { bookContentChapterSchema } from '../../features/search/domain/search';

const bookIdSchema = z.string().trim().min(1).max(128);

/** Per-book favorite/tag state, the Web counterpart of `book_tags`. */
export const webLibraryMetadataSchema = z.object({
  bookId: bookIdSchema,
  favorite: z.boolean(),
  tags: z.array(bookTagSchema).max(20),
});

export type WebLibraryMetadata = z.infer<typeof webLibraryMetadataSchema>;

/** One derived full-text chapter; `ordinal` keeps duplicate hrefs distinct. */
export const webBookContentRecordSchema = bookContentChapterSchema.extend({
  bookId: bookIdSchema,
  ordinal: z.number().int().nonnegative(),
});

export type WebBookContentRecord = z.infer<typeof webBookContentRecordSchema>;

/** Out-of-line keys inside the `settings` store. */
export const webSettingKeys = {
  readerGlobal: 'reader-global',
  ai: 'ai',
  readingGoal: 'reading-goal',
  dictionaries: 'dictionaries',
} as const;

/** localStorage keys written by releases before the IndexedDB migration. */
export const legacyWebStorageKeys = {
  books: 'light-reader-web-books',
  libraryMetadata: 'light-reader-web-library-metadata',
  notes: 'light-reader-web-notes',
  annotations: 'light-reader-web-annotations',
  bookmarks: 'light-reader-web-bookmarks',
  readingSessions: 'light-reader-web-reading-sessions',
  readerSettings: 'light-reader-reader-settings',
  aiSettings: 'light-reader-ai-settings',
  bookContent: 'light-reader-web-book-content-index',
  bookChunks: 'light-reader-web-ai-book-chunks',
} as const;

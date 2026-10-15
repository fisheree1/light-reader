import type { z } from 'zod';

import { aiSettingsSchema } from '../../features/ai-agent/domain/ai-settings';
import { annotationSchema } from '../../features/annotations/domain/annotation';
import { bookSchema } from '../../features/library/domain/book';
import { noteSchema } from '../../features/notes/domain/note';
import { bookmarkSchema } from '../../features/reader/domain/bookmark';
import { readingSessionSchema } from '../../features/reader/domain/reading-activity';
import {
  readerDisplaySettingsSchema,
  readerSettingsOverrideSchema,
  readingStateSchema,
} from '../../features/reader/domain/reader-settings';
import {
  legacyWebStorageKeys,
  webLibraryMetadataSchema,
  webSettingKeys,
} from './web-records';

interface MigrationContext {
  storage: Storage;
  transaction: IDBTransaction;
  /** Keys whose every record reached IndexedDB and may now be removed. */
  completed: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLegacy(context: MigrationContext, key: string): unknown {
  const raw = context.storage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Queues a put that never aborts the upgrade transaction. A rejected record
 * keeps its legacy key in localStorage so no user data is silently dropped.
 */
function put(
  context: MigrationContext,
  store: string,
  value: unknown,
  onFailure: () => void,
  key?: IDBValidKey,
): void {
  try {
    const request = context.transaction.objectStore(store).put(value, key);
    request.addEventListener('error', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onFailure();
    });
  } catch {
    onFailure();
  }
}

function migrateList<T>(
  context: MigrationContext,
  key: string,
  store: string,
  schema: z.ZodType<T>,
  accept: (value: T) => boolean = () => true,
): void {
  const parsed = readLegacy(context, key);
  if (parsed === undefined) return;
  let complete = Array.isArray(parsed);
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const result = schema.safeParse(item);
    if (!result.success || !accept(result.data)) {
      complete = false;
      continue;
    }
    put(context, store, result.data, () => {
      complete = false;
    });
  }
  context.transaction.addEventListener('complete', () => {
    if (complete) context.completed.push(key);
  });
}

function migrateReaderSettings(context: MigrationContext): void {
  const key = legacyWebStorageKeys.readerSettings;
  const parsed = readLegacy(context, key);
  if (parsed === undefined) return;
  let complete = isRecord(parsed);
  const fail = () => {
    complete = false;
  };
  if (isRecord(parsed)) {
    if (parsed.global !== undefined) {
      const global = readerDisplaySettingsSchema.safeParse(parsed.global);
      if (global.success) {
        put(
          context,
          'settings',
          global.data,
          fail,
          webSettingKeys.readerGlobal,
        );
      } else fail();
    }
    const overrides = isRecord(parsed.bookOverrides)
      ? parsed.bookOverrides
      : {};
    for (const [bookId, value] of Object.entries(overrides)) {
      const override = readerSettingsOverrideSchema.safeParse(value);
      if (override.success) {
        put(
          context,
          'readerOverrides',
          { bookId, settings: override.data },
          fail,
        );
      } else fail();
    }
    const states = isRecord(parsed.readingStates) ? parsed.readingStates : {};
    for (const value of Object.values(states)) {
      const state = readingStateSchema.safeParse(value);
      if (state.success) put(context, 'readingStates', state.data, fail);
      else fail();
    }
  }
  context.transaction.addEventListener('complete', () => {
    if (complete) context.completed.push(key);
  });
}

function migrateLibraryMetadata(context: MigrationContext): void {
  const key = legacyWebStorageKeys.libraryMetadata;
  const parsed = readLegacy(context, key);
  if (parsed === undefined) return;
  let complete = isRecord(parsed);
  for (const [bookId, value] of Object.entries(
    isRecord(parsed) ? parsed : {},
  )) {
    const metadata = webLibraryMetadataSchema.safeParse({
      ...(isRecord(value) ? value : {}),
      bookId,
    });
    if (!metadata.success) {
      complete = false;
      continue;
    }
    put(context, 'libraryMetadata', metadata.data, () => {
      complete = false;
    });
  }
  context.transaction.addEventListener('complete', () => {
    if (complete) context.completed.push(key);
  });
}

function migrateAiSettings(context: MigrationContext): void {
  const key = legacyWebStorageKeys.aiSettings;
  const parsed = readLegacy(context, key);
  if (parsed === undefined) return;
  const settings = aiSettingsSchema.safeParse(parsed);
  if (!settings.success) return;
  let complete = true;
  put(
    context,
    'settings',
    settings.data,
    () => {
      complete = false;
    },
    webSettingKeys.ai,
  );
  context.transaction.addEventListener('complete', () => {
    if (complete) context.completed.push(key);
  });
}

/**
 * Copies pre-IndexedDB Web data into the freshly created stores inside the
 * upgrade transaction. Derived search and AI indexes are not copied; they are
 * rebuilt from book files on demand. Returns the legacy keys that are safe to
 * delete once the upgrade has committed.
 */
export function migrateLegacyLocalStorage(
  storage: Storage,
  transaction: IDBTransaction,
): string[] {
  const context: MigrationContext = { storage, transaction, completed: [] };
  const seenHashes = new Set<string>();
  migrateList(
    context,
    legacyWebStorageKeys.books,
    'books',
    bookSchema,
    (book) => {
      if (seenHashes.has(book.fileHash)) return false;
      seenHashes.add(book.fileHash);
      return true;
    },
  );
  migrateLibraryMetadata(context);
  migrateList(context, legacyWebStorageKeys.notes, 'notes', noteSchema);
  migrateList(
    context,
    legacyWebStorageKeys.annotations,
    'annotations',
    annotationSchema,
  );
  migrateList(
    context,
    legacyWebStorageKeys.bookmarks,
    'bookmarks',
    bookmarkSchema,
  );
  migrateList(
    context,
    legacyWebStorageKeys.readingSessions,
    'readingSessions',
    readingSessionSchema,
  );
  migrateReaderSettings(context);
  migrateAiSettings(context);
  for (const key of [
    legacyWebStorageKeys.bookContent,
    legacyWebStorageKeys.bookChunks,
  ]) {
    if (storage.getItem(key) !== null) context.completed.push(key);
  }
  return context.completed;
}

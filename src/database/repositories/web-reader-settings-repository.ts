import {
  defaultReaderSettings,
  readerDisplaySettingsSchema,
  readerSettingsOverrideSchema,
  readingStateSchema,
  type ReaderDisplaySettings,
  type ReaderSettingsOverride,
  type ReadingState,
} from '../../features/reader/domain/reader-settings';
import { AppError } from '../../lib/app-error';
import {
  bookLocatorSchema,
  type BookLocator,
} from '../../reader-engines/types';
import type { ReaderSettingsRepository } from './reader-settings-repository';

interface StoredReaderSettings {
  bookOverrides: Record<string, unknown>;
  global: unknown;
  readingStates: Record<string, unknown>;
}

const storageKey = 'light-reader-reader-settings';

function emptyStorage(): StoredReaderSettings {
  return {
    global: defaultReaderSettings,
    bookOverrides: {},
    readingStates: {},
  };
}

export class WebReaderSettingsRepository implements ReaderSettingsRepository {
  getGlobal(): Promise<ReaderDisplaySettings> {
    return this.run('READER_SETTINGS_READ_FAILED', () => {
      const stored = this.read().global;
      return readerDisplaySettingsSchema.parse({
        ...defaultReaderSettings,
        ...(typeof stored === 'object' && stored !== null ? stored : {}),
      });
    });
  }

  saveGlobal(value: ReaderDisplaySettings): Promise<ReaderDisplaySettings> {
    return this.run('READER_SETTINGS_WRITE_FAILED', () => {
      const settings = readerDisplaySettingsSchema.parse(value);
      const stored = this.read();
      stored.global = settings;
      this.write(stored);
      return settings;
    });
  }

  getBookOverride(bookId: string): Promise<ReaderSettingsOverride | null> {
    return this.run('READER_SETTINGS_READ_FAILED', () => {
      const value = this.read().bookOverrides[bookId];
      return value === undefined
        ? null
        : readerSettingsOverrideSchema.parse(value);
    });
  }

  saveBookOverride(
    bookId: string,
    value: ReaderSettingsOverride,
  ): Promise<ReaderSettingsOverride> {
    return this.run('READER_SETTINGS_WRITE_FAILED', () => {
      const settings = readerSettingsOverrideSchema.parse(value);
      const stored = this.read();
      stored.bookOverrides[bookId] = settings;
      this.write(stored);
      return settings;
    });
  }

  deleteBookOverride(bookId: string): Promise<void> {
    return this.run('READER_SETTINGS_WRITE_FAILED', () => {
      const stored = this.read();
      stored.bookOverrides = Object.fromEntries(
        Object.entries(stored.bookOverrides).filter(([id]) => id !== bookId),
      );
      this.write(stored);
    });
  }

  getReadingState(bookId: string): Promise<ReadingState | null> {
    return this.run('READER_SETTINGS_READ_FAILED', () => {
      const value = this.read().readingStates[bookId];
      return value === undefined ? null : readingStateSchema.parse(value);
    });
  }

  saveReadingState(bookId: string, value: BookLocator): Promise<ReadingState> {
    return this.run('READING_STATE_WRITE_FAILED', () => {
      const state = readingStateSchema.parse({
        bookId,
        locator: bookLocatorSchema.parse(value),
        updatedAt: Date.now(),
      });
      const stored = this.read();
      stored.readingStates[bookId] = state;
      this.write(stored);
      return state;
    });
  }

  private run<T>(
    code:
      | 'READER_SETTINGS_READ_FAILED'
      | 'READER_SETTINGS_WRITE_FAILED'
      | 'READING_STATE_WRITE_FAILED',
    action: () => T,
  ): Promise<T> {
    return Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        throw error instanceof AppError
          ? error
          : new AppError(code, { cause: error });
      });
  }

  private read(): StoredReaderSettings {
    try {
      const value = localStorage.getItem(storageKey);
      if (!value) return emptyStorage();
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null) return emptyStorage();
      const record = parsed as Record<string, unknown>;
      return {
        global: record.global ?? defaultReaderSettings,
        bookOverrides:
          typeof record.bookOverrides === 'object' &&
          record.bookOverrides !== null
            ? (record.bookOverrides as Record<string, unknown>)
            : {},
        readingStates:
          typeof record.readingStates === 'object' &&
          record.readingStates !== null
            ? (record.readingStates as Record<string, unknown>)
            : {},
      };
    } catch (error) {
      throw new AppError('READER_SETTINGS_READ_FAILED', { cause: error });
    }
  }

  private write(value: StoredReaderSettings): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
      throw new AppError('READER_SETTINGS_WRITE_FAILED', { cause: error });
    }
  }
}

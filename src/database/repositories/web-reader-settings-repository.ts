import { z } from 'zod';

import {
  defaultReaderSettings,
  readerDisplaySettingsSchema,
  readerSettingsOverrideSchema,
  readingStateSchema,
  type ReaderDisplaySettings,
  type ReaderSettingsOverride,
  type ReadingState,
} from '../../features/reader/domain/reader-settings';
import {
  bookLocatorSchema,
  type BookLocator,
} from '../../reader-engines/types';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { webSettingKeys } from '../web/web-records';
import { withAppError } from '../web/web-repository-support';
import type { ReaderSettingsRepository } from './reader-settings-repository';

const storedOverrideSchema = z.object({
  bookId: z.string(),
  settings: readerSettingsOverrideSchema,
});

export class WebReaderSettingsRepository implements ReaderSettingsRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  getGlobal(): Promise<ReaderDisplaySettings> {
    return withAppError('READER_SETTINGS_READ_FAILED', async () => {
      const stored = await this.database.get(
        'settings',
        webSettingKeys.readerGlobal,
      );
      return readerDisplaySettingsSchema.parse({
        ...defaultReaderSettings,
        ...(typeof stored === 'object' && stored !== null ? stored : {}),
      });
    });
  }

  saveGlobal(value: ReaderDisplaySettings): Promise<ReaderDisplaySettings> {
    return withAppError('READER_SETTINGS_WRITE_FAILED', async () => {
      const settings = readerDisplaySettingsSchema.parse(value);
      await this.database.write([
        {
          type: 'put',
          store: 'settings',
          key: webSettingKeys.readerGlobal,
          value: settings,
        },
      ]);
      return settings;
    });
  }

  getBookOverride(bookId: string): Promise<ReaderSettingsOverride | null> {
    return withAppError('READER_SETTINGS_READ_FAILED', async () => {
      const stored = await this.database.get('readerOverrides', bookId);
      return stored === undefined
        ? null
        : storedOverrideSchema.parse(stored).settings;
    });
  }

  saveBookOverride(
    bookId: string,
    value: ReaderSettingsOverride,
  ): Promise<ReaderSettingsOverride> {
    return withAppError('READER_SETTINGS_WRITE_FAILED', async () => {
      const settings = readerSettingsOverrideSchema.parse(value);
      await this.database.write([
        { type: 'put', store: 'readerOverrides', value: { bookId, settings } },
      ]);
      return settings;
    });
  }

  deleteBookOverride(bookId: string): Promise<void> {
    return withAppError('READER_SETTINGS_WRITE_FAILED', () =>
      this.database.write([
        { type: 'delete', store: 'readerOverrides', key: bookId },
      ]),
    );
  }

  getReadingState(bookId: string): Promise<ReadingState | null> {
    return withAppError('READER_SETTINGS_READ_FAILED', async () => {
      const stored = await this.database.get('readingStates', bookId);
      return stored === undefined ? null : readingStateSchema.parse(stored);
    });
  }

  saveReadingState(bookId: string, value: BookLocator): Promise<ReadingState> {
    return withAppError('READING_STATE_WRITE_FAILED', async () => {
      const state = readingStateSchema.parse({
        bookId,
        locator: bookLocatorSchema.parse(value),
        updatedAt: Date.now(),
      });
      await this.database.write([
        { type: 'put', store: 'readingStates', value: state },
      ]);
      return state;
    });
  }
}

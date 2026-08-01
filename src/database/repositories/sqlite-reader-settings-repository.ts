import {
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
import { getDatabase, type SqlDatabase } from '../client';
import {
  mapBookReaderSettingsRecord,
  mapReaderSettingsRecord,
  mapReadingStateRecord,
  validBookIdSchema,
  type BookReaderSettingsRecord,
  type ReaderSettingsRecord,
  type ReadingStateRecord,
} from '../schema/reader-settings-record';
import type { ReaderSettingsRepository } from './reader-settings-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

export class SqliteReaderSettingsRepository implements ReaderSettingsRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async getGlobal(): Promise<ReaderDisplaySettings> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<ReaderSettingsRecord[]>(
        `SELECT theme, font_size, line_height, content_width, margin
         FROM reader_settings WHERE id = 1 LIMIT 1`,
      );
      if (!rows[0]) throw new Error('Missing global reader settings');
      return mapReaderSettingsRecord(rows[0]);
    } catch (error) {
      throw new AppError('READER_SETTINGS_READ_FAILED', { cause: error });
    }
  }

  async saveGlobal(
    value: ReaderDisplaySettings,
  ): Promise<ReaderDisplaySettings> {
    const settings = readerDisplaySettingsSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO reader_settings (
          id, theme, font_size, line_height, content_width, margin, updated_at
        ) VALUES (1, $1, $2, $3, $4, $5, $6)
        ON CONFLICT(id) DO UPDATE SET
          theme = excluded.theme, font_size = excluded.font_size,
          line_height = excluded.line_height,
          content_width = excluded.content_width, margin = excluded.margin,
          updated_at = excluded.updated_at`,
        [
          settings.theme,
          settings.fontSize,
          settings.lineHeight,
          settings.contentWidth,
          settings.margin,
          Date.now(),
        ],
      );
      return settings;
    } catch (error) {
      throw new AppError('READER_SETTINGS_WRITE_FAILED', { cause: error });
    }
  }

  async getBookOverride(
    bookId: string,
  ): Promise<ReaderSettingsOverride | null> {
    const id = validBookIdSchema.parse(bookId);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<BookReaderSettingsRecord[]>(
        `SELECT theme, font_size, line_height, content_width, margin
         FROM book_reader_settings WHERE book_id = $1 LIMIT 1`,
        [id],
      );
      return rows[0] ? mapBookReaderSettingsRecord(rows[0]) : null;
    } catch (error) {
      throw new AppError('READER_SETTINGS_READ_FAILED', { cause: error });
    }
  }

  async saveBookOverride(
    bookId: string,
    value: ReaderSettingsOverride,
  ): Promise<ReaderSettingsOverride> {
    const id = validBookIdSchema.parse(bookId);
    const settings = readerSettingsOverrideSchema.parse(value);
    if (Object.keys(settings).length === 0) {
      await this.deleteBookOverride(id);
      return settings;
    }
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO book_reader_settings (
          book_id, theme, font_size, line_height, content_width, margin, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(book_id) DO UPDATE SET
          theme = excluded.theme, font_size = excluded.font_size,
          line_height = excluded.line_height,
          content_width = excluded.content_width, margin = excluded.margin,
          updated_at = excluded.updated_at`,
        [
          id,
          settings.theme ?? null,
          settings.fontSize ?? null,
          settings.lineHeight ?? null,
          settings.contentWidth ?? null,
          settings.margin ?? null,
          Date.now(),
        ],
      );
      return settings;
    } catch (error) {
      throw new AppError('READER_SETTINGS_WRITE_FAILED', { cause: error });
    }
  }

  async deleteBookOverride(bookId: string): Promise<void> {
    const id = validBookIdSchema.parse(bookId);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        'DELETE FROM book_reader_settings WHERE book_id = $1',
        [id],
      );
    } catch (error) {
      throw new AppError('READER_SETTINGS_WRITE_FAILED', { cause: error });
    }
  }

  async getReadingState(bookId: string): Promise<ReadingState | null> {
    const id = validBookIdSchema.parse(bookId);
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<ReadingStateRecord[]>(
        `SELECT book_id, locator_json, updated_at
         FROM reading_states WHERE book_id = $1 LIMIT 1`,
        [id],
      );
      return rows[0] ? mapReadingStateRecord(rows[0]) : null;
    } catch (error) {
      throw new AppError('READER_SETTINGS_READ_FAILED', { cause: error });
    }
  }

  async saveReadingState(
    bookId: string,
    value: BookLocator,
  ): Promise<ReadingState> {
    const id = validBookIdSchema.parse(bookId);
    const locator = bookLocatorSchema.parse(value);
    const state = readingStateSchema.parse({
      bookId: id,
      locator,
      updatedAt: Date.now(),
    });
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO reading_states (book_id, locator_json, progression, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(book_id) DO UPDATE SET
           locator_json = excluded.locator_json,
           progression = excluded.progression,
           updated_at = excluded.updated_at`,
        [
          id,
          JSON.stringify(locator),
          locator.progression ?? null,
          state.updatedAt,
        ],
      );
      return state;
    } catch (error) {
      throw new AppError('READING_STATE_WRITE_FAILED', { cause: error });
    }
  }
}

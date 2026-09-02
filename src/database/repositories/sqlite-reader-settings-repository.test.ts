import { describe, expect, it } from 'vitest';

import { defaultReaderSettings } from '../../features/reader/domain/reader-settings';
import type { SqlDatabase } from '../client';
import type {
  BookReaderSettingsRecord,
  ReaderSettingsRecord,
  ReadingStateRecord,
} from '../schema/reader-settings-record';
import { SqliteReaderSettingsRepository } from './sqlite-reader-settings-repository';

class FakeSettingsDatabase implements SqlDatabase {
  global: ReaderSettingsRecord = {
    theme: 'light',
    font_family: 'serif',
    font_weight: 400,
    font_size: 18,
    line_height: 1.6,
    content_width: 720,
    margin: 32,
  };
  overrides = new Map<string, BookReaderSettingsRecord>();
  states = new Map<string, ReadingStateRecord>();

  execute(query: string, values: unknown[] = []): Promise<unknown> {
    if (query.includes('INSERT INTO reader_settings')) {
      this.global = {
        theme: String(values[0]),
        font_family: String(values[1]),
        font_weight: Number(values[2]),
        font_size: Number(values[3]),
        line_height: Number(values[4]),
        content_width: Number(values[5]),
        margin: Number(values[6]),
      };
    } else if (query.includes('INSERT INTO book_reader_settings')) {
      this.overrides.set(String(values[0]), {
        theme: typeof values[1] === 'string' ? values[1] : null,
        font_family: typeof values[2] === 'string' ? values[2] : null,
        font_weight: typeof values[3] === 'number' ? values[3] : null,
        font_size: typeof values[4] === 'number' ? values[4] : null,
        line_height: typeof values[5] === 'number' ? values[5] : null,
        content_width: typeof values[6] === 'number' ? values[6] : null,
        margin: typeof values[7] === 'number' ? values[7] : null,
      });
    } else if (query.startsWith('DELETE FROM book_reader_settings')) {
      this.overrides.delete(String(values[0]));
    } else if (query.includes('INSERT INTO reading_states')) {
      this.states.set(String(values[0]), {
        book_id: String(values[0]),
        locator_json: String(values[1]),
        updated_at: Number(values[3]),
      });
    }
    return Promise.resolve({});
  }

  select<T>(query: string, values: unknown[] = []): Promise<T> {
    if (query.includes('FROM reader_settings')) {
      return Promise.resolve([this.global] as T);
    }
    if (query.includes('FROM book_reader_settings')) {
      const row = this.overrides.get(String(values[0]));
      return Promise.resolve((row ? [row] : []) as T);
    }
    const row = this.states.get(String(values[0]));
    return Promise.resolve((row ? [row] : []) as T);
  }
}

describe('SqliteReaderSettingsRepository', () => {
  it('persists global and per-book display settings', async () => {
    const database = new FakeSettingsDatabase();
    const repository = new SqliteReaderSettingsRepository(() =>
      Promise.resolve(database),
    );
    const global = { ...defaultReaderSettings, theme: 'sepia' as const };

    await repository.saveGlobal(global);
    await repository.saveBookOverride('book-1', {
      theme: 'dark',
      fontSize: 24,
    });

    await expect(repository.getGlobal()).resolves.toEqual(global);
    await expect(repository.getBookOverride('book-1')).resolves.toEqual({
      theme: 'dark',
      fontSize: 24,
    });
    await repository.deleteBookOverride('book-1');
    await expect(repository.getBookOverride('book-1')).resolves.toBeNull();
  });

  it('reads a versioned position after repository reinitialization', async () => {
    const database = new FakeSettingsDatabase();
    const locator = {
      version: 1 as const,
      format: 'epub' as const,
      cfi: 'epubcfi(/6/4)',
      progression: 0.4,
    };
    await new SqliteReaderSettingsRepository(() =>
      Promise.resolve(database),
    ).saveReadingState('book-1', locator);

    const reopened = new SqliteReaderSettingsRepository(() =>
      Promise.resolve(database),
    );
    await expect(reopened.getReadingState('book-1')).resolves.toMatchObject({
      bookId: 'book-1',
      locator,
    });
  });
});

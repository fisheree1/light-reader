import {
  installedDictionarySchema,
  type InstalledDictionary,
} from '../../features/dictionary/domain/dictionary';
import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import type { DictionaryRepository } from './dictionary-repository';

type DatabaseProvider = () => Promise<SqlDatabase>;

const dictionariesKey = 'dictionaries_v1';

/** Keeps the small dictionary registry as one JSON value in `app_meta`. */
export class SqliteDictionaryRepository implements DictionaryRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async list(): Promise<InstalledDictionary[]> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<{ value: string }[]>(
        'SELECT value FROM app_meta WHERE key = $1 LIMIT 1',
        [dictionariesKey],
      );
      if (!rows[0]) return [];
      return installedDictionarySchema.array().parse(JSON.parse(rows[0].value));
    } catch (error) {
      throw new AppError('DICTIONARY_READ_FAILED', { cause: error });
    }
  }

  async save(value: InstalledDictionary): Promise<InstalledDictionary> {
    const dictionary = installedDictionarySchema.parse(value);
    const current = await this.list();
    await this.write([
      ...current.filter((item) => item.id !== dictionary.id),
      dictionary,
    ]);
    return dictionary;
  }

  async delete(id: string): Promise<void> {
    await this.write((await this.list()).filter((item) => item.id !== id));
  }

  private async write(dictionaries: InstalledDictionary[]): Promise<void> {
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO app_meta (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [dictionariesKey, JSON.stringify(dictionaries)],
      );
    } catch (error) {
      throw new AppError('DICTIONARY_WRITE_FAILED', { cause: error });
    }
  }
}

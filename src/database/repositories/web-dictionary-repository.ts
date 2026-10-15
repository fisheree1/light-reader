import {
  installedDictionarySchema,
  type InstalledDictionary,
} from '../../features/dictionary/domain/dictionary';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { webSettingKeys } from '../web/web-records';
import { withAppError } from '../web/web-repository-support';
import type { DictionaryRepository } from './dictionary-repository';

export class WebDictionaryRepository implements DictionaryRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  list(): Promise<InstalledDictionary[]> {
    return withAppError('DICTIONARY_READ_FAILED', async () => {
      const stored = await this.database.get(
        'settings',
        webSettingKeys.dictionaries,
      );
      return stored === undefined
        ? []
        : installedDictionarySchema.array().parse(stored);
    });
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

  private write(dictionaries: InstalledDictionary[]): Promise<void> {
    return withAppError('DICTIONARY_WRITE_FAILED', () =>
      this.database.write([
        {
          type: 'put',
          store: 'settings',
          key: webSettingKeys.dictionaries,
          value: dictionaries,
        },
      ]),
    );
  }
}

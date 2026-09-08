import {
  aiSettingsSchema,
  defaultAiSettings,
  type AiSettings,
} from '../../features/ai-agent/domain/ai-settings';
import { AppError } from '../../lib/app-error';
import { getDatabase, type SqlDatabase } from '../client';
import type { AiSettingsRepository } from './ai-settings-repository';

interface AppMetaRow {
  value: string;
}

type DatabaseProvider = () => Promise<SqlDatabase>;

const settingsKey = 'ai_settings_v1';

export class SqliteAiSettingsRepository implements AiSettingsRepository {
  private readonly databaseProvider: DatabaseProvider;

  constructor(databaseProvider: DatabaseProvider = getDatabase) {
    this.databaseProvider = databaseProvider;
  }

  async get(): Promise<AiSettings> {
    try {
      const database = await this.databaseProvider();
      const rows = await database.select<AppMetaRow[]>(
        'SELECT value FROM app_meta WHERE key = $1 LIMIT 1',
        [settingsKey],
      );
      if (!rows[0]) return defaultAiSettings;
      const parsed: unknown = JSON.parse(rows[0].value);
      return aiSettingsSchema.parse(parsed);
    } catch (error) {
      throw new AppError('AI_SETTINGS_READ_FAILED', { cause: error });
    }
  }

  async save(value: AiSettings): Promise<AiSettings> {
    const settings = aiSettingsSchema.parse(value);
    try {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO app_meta (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [settingsKey, JSON.stringify(settings)],
      );
      return settings;
    } catch (error) {
      throw new AppError('AI_SETTINGS_WRITE_FAILED', { cause: error });
    }
  }
}

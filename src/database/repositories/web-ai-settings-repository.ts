import {
  aiSettingsSchema,
  defaultAiSettings,
  type AiSettings,
} from '../../features/ai-agent/domain/ai-settings';
import { getWebDatabase, type WebDatabase } from '../web/web-database';
import { webSettingKeys } from '../web/web-records';
import { withAppError } from '../web/web-repository-support';
import type { AiSettingsRepository } from './ai-settings-repository';

export class WebAiSettingsRepository implements AiSettingsRepository {
  private readonly database: WebDatabase;

  constructor(database: WebDatabase = getWebDatabase()) {
    this.database = database;
  }

  get(): Promise<AiSettings> {
    return withAppError('AI_SETTINGS_READ_FAILED', async () => {
      const stored = await this.database.get('settings', webSettingKeys.ai);
      return stored === undefined
        ? defaultAiSettings
        : aiSettingsSchema.parse(stored);
    });
  }

  async save(value: AiSettings): Promise<AiSettings> {
    const settings = aiSettingsSchema.parse(value);
    return withAppError('AI_SETTINGS_WRITE_FAILED', async () => {
      await this.database.write([
        {
          type: 'put',
          store: 'settings',
          key: webSettingKeys.ai,
          value: settings,
        },
      ]);
      return settings;
    });
  }
}

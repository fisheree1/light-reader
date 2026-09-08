import {
  aiSettingsSchema,
  defaultAiSettings,
  type AiSettings,
} from '../../features/ai-agent/domain/ai-settings';
import { AppError } from '../../lib/app-error';
import type { AiSettingsRepository } from './ai-settings-repository';

const storageKey = 'light-reader-ai-settings';

export class WebAiSettingsRepository implements AiSettingsRepository {
  get(): Promise<AiSettings> {
    return Promise.resolve().then(() => {
      try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) return defaultAiSettings;
        const parsed: unknown = JSON.parse(stored);
        return aiSettingsSchema.parse(parsed);
      } catch (error) {
        throw new AppError('AI_SETTINGS_READ_FAILED', { cause: error });
      }
    });
  }

  save(value: AiSettings): Promise<AiSettings> {
    return Promise.resolve().then(() => {
      const settings = aiSettingsSchema.parse(value);
      try {
        localStorage.setItem(storageKey, JSON.stringify(settings));
        return settings;
      } catch (error) {
        throw new AppError('AI_SETTINGS_WRITE_FAILED', { cause: error });
      }
    });
  }
}

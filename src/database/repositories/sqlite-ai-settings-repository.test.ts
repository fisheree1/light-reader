import { describe, expect, it, vi } from 'vitest';

import { defaultAiSettings } from '../../features/ai-agent/domain/ai-settings';
import type { SqlDatabase } from '../client';
import { SqliteAiSettingsRepository } from './sqlite-ai-settings-repository';

describe('SqliteAiSettingsRepository', () => {
  it('uses disabled local defaults when no setting has been saved', async () => {
    const database: SqlDatabase = {
      execute: vi.fn(),
      select: <T>() => Promise.resolve([] as T),
    };
    const repository = new SqliteAiSettingsRepository(() =>
      Promise.resolve(database),
    );

    await expect(repository.get()).resolves.toEqual(defaultAiSettings);
  });

  it('persists only validated non-secret AI configuration in app_meta', async () => {
    const execute = vi.fn(() => Promise.resolve({}));
    const database: SqlDatabase = {
      execute,
      select: <T>() => Promise.resolve([] as T),
    };
    const repository = new SqliteAiSettingsRepository(() =>
      Promise.resolve(database),
    );
    const settings = { ...defaultAiSettings, enabled: true };

    await expect(repository.save(settings)).resolves.toEqual(settings);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_meta'),
      ['ai_settings_v1', JSON.stringify(settings)],
    );
  });
});

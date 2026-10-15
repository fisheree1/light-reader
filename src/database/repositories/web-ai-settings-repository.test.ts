import { defaultAiSettings } from '../../features/ai-agent/domain/ai-settings';
import { createTestWebDatabase } from '../../test/fixtures/web-records';
import { WebAiSettingsRepository } from './web-ai-settings-repository';

describe('WebAiSettingsRepository', () => {
  it('uses disabled defaults and persists validated settings', async () => {
    const database = createTestWebDatabase();
    const repository = new WebAiSettingsRepository(database);
    await expect(repository.get()).resolves.toEqual(defaultAiSettings);

    await repository.save({ ...defaultAiSettings, enabled: true });
    await expect(
      new WebAiSettingsRepository(database).get(),
    ).resolves.toMatchObject({ enabled: true });
  });

  it('rejects corrupt stored settings', async () => {
    const database = createTestWebDatabase();
    await database.write([
      { type: 'put', store: 'settings', key: 'ai', value: { enabled: 1 } },
    ]);

    await expect(
      new WebAiSettingsRepository(database).get(),
    ).rejects.toMatchObject({ code: 'AI_SETTINGS_READ_FAILED' });
  });
});

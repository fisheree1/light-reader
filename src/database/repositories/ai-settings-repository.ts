import type { AiSettings } from '../../features/ai-agent/domain/ai-settings';

export interface AiSettingsRepository {
  get(): Promise<AiSettings>;
  save(settings: AiSettings): Promise<AiSettings>;
}

import { isTauri } from '@tauri-apps/api/core';

import { SqliteAiSettingsRepository } from '../../../database/repositories/sqlite-ai-settings-repository';
import { WebAiSettingsRepository } from '../../../database/repositories/web-ai-settings-repository';
import {
  FakeModelProvider,
  UnavailableModelProvider,
} from '../../../platform/ai/fake-model-provider';
import { OllamaModelProvider } from '../../../platform/ai/ollama-model-provider';
import { AgentFacade } from './agent-facade';

const repository = isTauri()
  ? new SqliteAiSettingsRepository()
  : new WebAiSettingsRepository();

const provider = isTauri()
  ? new OllamaModelProvider()
  : import.meta.env.VITE_AI_FAKE_PROVIDER === 'true'
    ? new FakeModelProvider()
    : new UnavailableModelProvider();

export const agentFacade = new AgentFacade(repository, provider);

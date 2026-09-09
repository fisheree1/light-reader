import { isTauri } from '@tauri-apps/api/core';

import { SqliteAiSettingsRepository } from '../../../database/repositories/sqlite-ai-settings-repository';
import { WebAiSettingsRepository } from '../../../database/repositories/web-ai-settings-repository';
import { SqliteBookChunkRepository } from '../../../database/repositories/sqlite-book-chunk-repository';
import { WebBookChunkRepository } from '../../../database/repositories/web-book-chunk-repository';
import {
  FakeModelProvider,
  UnavailableModelProvider,
} from '../../../platform/ai/fake-model-provider';
import { OllamaModelProvider } from '../../../platform/ai/ollama-model-provider';
import { TauriReaderBookSource } from '../../reader/services/reader-book-source';
import { WebReaderBookSource } from '../../reader/services/web-reader-book-source';
import { LocalBookTextExtractor } from '../retrieval/book-text-extractor';
import { BookRetrievalService } from '../retrieval/book-retrieval-service';
import { AgentFacade } from './agent-facade';
import { BookQaRunner } from './book-qa-runner';

const repository = isTauri()
  ? new SqliteAiSettingsRepository()
  : new WebAiSettingsRepository();

const provider = isTauri()
  ? new OllamaModelProvider()
  : import.meta.env.VITE_AI_FAKE_PROVIDER === 'true'
    ? new FakeModelProvider()
    : new UnavailableModelProvider();

const retrieval = new BookRetrievalService(
  isTauri() ? new SqliteBookChunkRepository() : new WebBookChunkRepository(),
  isTauri() ? new TauriReaderBookSource() : new WebReaderBookSource(),
  new LocalBookTextExtractor(),
);

export const agentFacade = new AgentFacade(
  repository,
  provider,
  undefined,
  undefined,
  new BookQaRunner(provider, retrieval),
);

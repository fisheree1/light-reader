import type { AiSettingsRepository } from '../../../database/repositories/ai-settings-repository';
import { AppError } from '../../../lib/app-error';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { Book } from '../../library/domain/book';
import type {
  AgentProviderEvent,
  ModelProviderGateway,
  ModelProviderStatus,
} from '../../../platform/ai/model-provider-gateway';
import { aiSettingsSchema, type AiSettings } from '../domain/ai-settings';
import type { SelectionAiAction } from '../domain/agent';
import {
  AgentConsentService,
  type PreparedSelectionRun,
} from './agent-consent-service';
import { AgentRunner, type AgentRunResult } from './agent-runner';
import type { BookIndexingProgress } from '../retrieval/book-indexing';
import {
  BookQaRunner,
  type BookQaEvent,
  type BookQaRunResult,
} from './book-qa-runner';
import { ResearchRunner, type ResearchEvent } from './research-runner';

export class AgentFacade {
  private readonly consentService: AgentConsentService;
  private readonly provider: ModelProviderGateway;
  private readonly runner: AgentRunner;
  private readonly settingsRepository: AiSettingsRepository;
  private readonly bookQaRunner: BookQaRunner | null;
  private readonly researchRunner: ResearchRunner | null;

  constructor(
    settingsRepository: AiSettingsRepository,
    provider: ModelProviderGateway,
    consentService = new AgentConsentService(),
    runner = new AgentRunner(provider),
    bookQaRunner: BookQaRunner | null = null,
    researchRunner: ResearchRunner | null = null,
  ) {
    this.bookQaRunner = bookQaRunner;
    this.researchRunner = researchRunner;
    this.consentService = consentService;
    this.provider = provider;
    this.runner = runner;
    this.settingsRepository = settingsRepository;
  }

  async runResearch(
    books: Book[],
    question: string,
    signal: AbortSignal,
    onEvent?: (event: ResearchEvent) => void,
  ): Promise<AgentRunResult> {
    if (!this.researchRunner) throw new AppError('AI_REQUEST_FAILED');
    const settings = await this.requireAvailableSettings();
    return this.researchRunner.run(books, question, settings, signal, onEvent);
  }

  async runBookQuestion(
    book: Book,
    question: string,
    signal: AbortSignal,
    onEvent?: (event: BookQaEvent) => void,
  ): Promise<BookQaRunResult> {
    if (!this.bookQaRunner) throw new AppError('AI_REQUEST_FAILED');
    const settings = await this.requireAvailableSettings();
    return this.bookQaRunner.run(book, question, settings, signal, onEvent);
  }

  async rebuildBookIndex(
    book: Book,
    signal: AbortSignal,
    onProgress?: (progress: BookIndexingProgress) => void,
  ): Promise<void> {
    if (!this.bookQaRunner) throw new AppError('AI_REQUEST_FAILED');
    const settings = await this.getSettings();
    if (!settings.enabled) throw new AppError('AI_DISABLED');
    await this.bookQaRunner.rebuildIndex(book, signal, onProgress);
  }

  getSettings(): Promise<AiSettings> {
    return this.settingsRepository.get();
  }

  saveSettings(settings: AiSettings): Promise<AiSettings> {
    return this.settingsRepository.save(aiSettingsSchema.parse(settings));
  }

  async checkProvider(settings?: AiSettings): Promise<ModelProviderStatus> {
    return this.provider.getStatus(settings ?? (await this.getSettings()));
  }

  async prepareSelection(input: {
    action: SelectionAiAction;
    bookId: string;
    bookTitle: string;
    instruction?: string;
    selection: ReaderTextSelection;
  }): Promise<PreparedSelectionRun> {
    const settings = await this.getSettings();
    if (!settings.enabled) throw new AppError('AI_DISABLED');
    return this.consentService.prepare({ ...input, settings });
  }

  async runSelection(
    prepared: PreparedSelectionRun,
    approvedText: string,
    signal: AbortSignal,
    onEvent?: (event: AgentProviderEvent) => void,
  ): Promise<AgentRunResult> {
    const settings = await this.getSettings();
    if (!settings.enabled) throw new AppError('AI_DISABLED');
    if (settings.model !== prepared.run.model) {
      throw new AppError('AI_MODEL_NOT_FOUND', {
        message: 'AI 设置已经变化，请重新打开助手。',
      });
    }
    const status = await this.provider.getStatus(settings);
    if (!status.available) throw new AppError('AI_PROVIDER_UNAVAILABLE');
    if (!status.models.includes(settings.model)) {
      throw new AppError('AI_MODEL_NOT_FOUND');
    }
    const approved = this.consentService.approve(prepared, approvedText);
    return this.runner.runSelection(approved, settings, signal, onEvent);
  }

  private async requireAvailableSettings(): Promise<AiSettings> {
    const settings = await this.getSettings();
    if (!settings.enabled) throw new AppError('AI_DISABLED');
    const status = await this.provider.getStatus(settings);
    if (!status.available) throw new AppError('AI_PROVIDER_UNAVAILABLE');
    if (!status.models.includes(settings.model)) {
      throw new AppError('AI_MODEL_NOT_FOUND');
    }
    return settings;
  }
}

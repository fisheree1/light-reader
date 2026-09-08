import type { AiSettingsRepository } from '../../../database/repositories/ai-settings-repository';
import { AppError } from '../../../lib/app-error';
import type { ReaderTextSelection } from '../../../reader-engines/types';
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

export class AgentFacade {
  private readonly consentService: AgentConsentService;
  private readonly provider: ModelProviderGateway;
  private readonly runner: AgentRunner;
  private readonly settingsRepository: AiSettingsRepository;

  constructor(
    settingsRepository: AiSettingsRepository,
    provider: ModelProviderGateway,
    consentService = new AgentConsentService(),
    runner = new AgentRunner(provider),
  ) {
    this.consentService = consentService;
    this.provider = provider;
    this.runner = runner;
    this.settingsRepository = settingsRepository;
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
}

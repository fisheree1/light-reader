import type { AiSettings } from '../../features/ai-agent/domain/ai-settings';
import type {
  AgentModelRequest,
  AgentProviderEvent,
  ModelProviderGateway,
  ModelProviderStatus,
} from './model-provider-gateway';

export class FakeModelProvider implements ModelProviderGateway {
  private readonly response: string;

  readonly capabilities = {
    streaming: true,
    structuredOutput: false,
    functionTools: false,
  };

  constructor(
    response = '这是本地 AI 测试草稿。它只基于你确认发送的选中文本生成。',
  ) {
    this.response = response;
  }

  getStatus(settings: AiSettings): Promise<ModelProviderStatus> {
    return Promise.resolve({
      available: true,
      errorCode: null,
      models: [settings.model, 'deepseek-r1:8b'],
    });
  }

  async *run(
    request: AgentModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    const response =
      request.prompt.includes('<USER_QUESTION>') &&
      !/\[S\d+\]/.test(this.response)
        ? `${this.response} [S1]`
        : this.response;
    const midpoint = Math.max(1, Math.floor(response.length / 2));
    for (const delta of [
      response.slice(0, midpoint),
      response.slice(midpoint),
    ]) {
      if (signal.aborted) return;
      await Promise.resolve();
      yield { type: 'output-delta', delta };
    }
    if (signal.aborted) return;
    yield { type: 'usage', inputTokens: 32, outputTokens: 24 };
    yield { type: 'completed' };
  }
}

export class UnavailableModelProvider implements ModelProviderGateway {
  readonly capabilities = {
    streaming: false,
    structuredOutput: false,
    functionTools: false,
  };

  getStatus(): Promise<ModelProviderStatus> {
    return Promise.resolve({
      available: false,
      errorCode: 'AI_PROVIDER_UNAVAILABLE',
      models: [],
    });
  }

  async *run(): AsyncIterable<AgentProviderEvent> {
    await Promise.resolve();
    yield {
      type: 'failed',
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'Ollama is only available in the desktop application.',
    };
  }
}

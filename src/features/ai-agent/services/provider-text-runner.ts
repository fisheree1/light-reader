import { AppError } from '../../../lib/app-error';
import type {
  AgentModelRequest,
  AgentProviderEvent,
  ModelProviderGateway,
} from '../../../platform/ai/model-provider-gateway';

export interface ProviderTextResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class ProviderTextRunner {
  private readonly provider: ModelProviderGateway;
  private readonly timeoutMs: number;

  constructor(provider: ModelProviderGateway, timeoutMs = 60_000) {
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }

  async run(
    request: AgentModelRequest,
    signal: AbortSignal,
    onEvent: (event: AgentProviderEvent) => void = () => undefined,
  ): Promise<ProviderTextResult> {
    let content = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let completed = false;
    const providerController = new AbortController();
    let timedOut = false;
    const forwardAbort = () => {
      providerController.abort();
    };
    signal.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      providerController.abort();
    }, this.timeoutMs);
    const abortResult = new Promise<never>((_resolve, reject) => {
      providerController.signal.addEventListener(
        'abort',
        () => {
          reject(
            new AppError(timedOut ? 'AI_REQUEST_TIMEOUT' : 'USER_CANCELLED'),
          );
        },
        { once: true },
      );
    });
    const providerEvents = this.provider.run(
      request,
      providerController.signal,
    );
    const events = providerEvents[Symbol.asyncIterator]();

    try {
      for (;;) {
        const next = await Promise.race([events.next(), abortResult]);
        if (next.done) break;
        const event = next.value;
        onEvent(event);
        if (event.type === 'output-delta') {
          if (content.length + event.delta.length > request.maxOutputChars) {
            throw new AppError('AI_OUTPUT_INVALID', {
              message: '模型输出超过允许长度，已停止生成。',
            });
          }
          content += event.delta;
        } else if (event.type === 'usage') {
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
        } else if (event.type === 'failed') {
          throw new AppError(mapProviderError(event.code), {
            message: event.message,
          });
        } else {
          completed = true;
        }
      }
      if (signal.aborted) throw new AppError('USER_CANCELLED');
      if (!completed || !content.trim())
        throw new AppError('AI_OUTPUT_INVALID');
      return { content: content.trim(), inputTokens, outputTokens };
    } catch (error) {
      if (signal.aborted) throw new AppError('USER_CANCELLED');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', forwardAbort);
      providerController.abort();
      void events.return?.();
    }
  }
}

function mapProviderError(code: string) {
  if (code === 'AI_REQUEST_TIMEOUT') return 'AI_REQUEST_TIMEOUT' as const;
  if (code === 'AI_MODEL_NOT_FOUND') return 'AI_MODEL_NOT_FOUND' as const;
  if (code === 'AI_PROVIDER_UNAVAILABLE') {
    return 'AI_PROVIDER_UNAVAILABLE' as const;
  }
  return 'AI_REQUEST_FAILED' as const;
}

import { Channel, invoke } from '@tauri-apps/api/core';

import type { AiSettings } from '../../features/ai-agent/domain/ai-settings';
import {
  agentModelRequestSchema,
  agentProviderEventSchema,
  type AgentModelRequest,
  type AgentProviderEvent,
  type ModelProviderGateway,
  type ModelProviderStatus,
} from './model-provider-gateway';

interface NativeOllamaStatus {
  available: boolean;
  models: string[];
}

interface PendingRead {
  reject: (reason?: unknown) => void;
  resolve: (value: IteratorResult<AgentProviderEvent>) => void;
}

class ProviderEventQueue {
  private readonly values: AgentProviderEvent[] = [];
  private readonly readers: PendingRead[] = [];
  private error: Error | undefined;
  private ended = false;

  push(value: AgentProviderEvent): void {
    const reader = this.readers.shift();
    if (reader) reader.resolve({ done: false, value });
    else this.values.push(value);
  }

  finish(): void {
    this.ended = true;
    this.flushReaders();
  }

  fail(error: unknown): void {
    this.error =
      error instanceof Error ? error : new Error('Ollama provider failed.');
    this.ended = true;
    this.flushReaders();
  }

  next(): Promise<IteratorResult<AgentProviderEvent>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.error) return Promise.reject(this.error);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.readers.push({ resolve, reject });
    });
  }

  private flushReaders(): void {
    for (const reader of this.readers.splice(0)) {
      if (this.error) reader.reject(this.error);
      else reader.resolve({ done: true, value: undefined });
    }
  }
}

const nativeErrorMessages: Record<string, string> = {
  AI_MODEL_NOT_FOUND: '所选 Ollama 模型未安装。',
  AI_PROVIDER_UNAVAILABLE: '无法连接本机 Ollama 服务。',
  AI_REQUEST_FAILED: '本地模型请求失败。',
  AI_REQUEST_TIMEOUT: '本地模型请求超时。',
};

function mapNativeError(error: unknown): AgentProviderEvent {
  const objectCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const stringCode =
    typeof error === 'string'
      ? Object.keys(nativeErrorMessages).find((code) => error.includes(code))
      : undefined;
  const code =
    typeof objectCode === 'string' && objectCode in nativeErrorMessages
      ? objectCode
      : (stringCode ?? 'AI_REQUEST_FAILED');
  return {
    type: 'failed',
    code,
    message: nativeErrorMessages[code] ?? nativeErrorMessages.AI_REQUEST_FAILED,
  };
}

export class OllamaModelProvider implements ModelProviderGateway {
  readonly capabilities = {
    streaming: true,
    structuredOutput: false,
    functionTools: false,
  };

  async getStatus(settings: AiSettings): Promise<ModelProviderStatus> {
    try {
      const status = await invoke<NativeOllamaStatus>('ai_ollama_status', {
        endpoint: settings.endpoint,
      });
      return {
        available: status.available,
        errorCode: status.available ? null : 'AI_PROVIDER_UNAVAILABLE',
        models: status.models,
      };
    } catch {
      return {
        available: false,
        errorCode: 'AI_PROVIDER_UNAVAILABLE',
        models: [],
      };
    }
  }

  async *run(
    value: AgentModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    const request = agentModelRequestSchema.parse(value);
    const queue = new ProviderEventQueue();
    const onEvent = new Channel<unknown>();
    onEvent.onmessage = (message) => {
      const parsed = agentProviderEventSchema.safeParse(message);
      if (parsed.success) queue.push(parsed.data);
      else queue.fail(new Error('Invalid Ollama provider event.'));
    };

    const cancel = () => {
      void invoke('ai_cancel_ollama_run', { runId: request.runId });
    };
    signal.addEventListener('abort', cancel, { once: true });

    void invoke('ai_ollama_chat', {
      request,
      onEvent,
    }).then(
      () => {
        queue.finish();
      },
      (error: unknown) => {
        queue.push(mapNativeError(error));
        queue.finish();
      },
    );

    try {
      while (!signal.aborted) {
        const next = await queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) cancel();
    }
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  latestChannel: null as { onmessage?: (message: unknown) => void } | null,
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage?: (message: unknown) => void;

    constructor() {
      mocks.latestChannel = this;
    }
  },
  invoke: mocks.invoke,
}));

import { defaultAiSettings } from '../../features/ai-agent/domain/ai-settings';
import { OllamaModelProvider } from './ollama-model-provider';

describe('OllamaModelProvider', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.latestChannel = null;
  });

  it('maps the native availability response without exposing platform details', async () => {
    mocks.invoke.mockResolvedValue({
      available: true,
      models: ['deepseek-r1:8b'],
    });
    const provider = new OllamaModelProvider();

    await expect(provider.getStatus(defaultAiSettings)).resolves.toEqual({
      available: true,
      errorCode: null,
      models: ['deepseek-r1:8b'],
    });
    expect(mocks.invoke).toHaveBeenCalledWith('ai_ollama_status', {
      endpoint: defaultAiSettings.endpoint,
    });
  });

  it('validates and streams only internal provider events', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== 'ai_ollama_chat') return Promise.resolve();
      queueMicrotask(() => {
        mocks.latestChannel?.onmessage?.({
          type: 'output-delta',
          delta: '安全草稿',
        });
        mocks.latestChannel?.onmessage?.({
          type: 'usage',
          inputTokens: 10,
          outputTokens: 4,
        });
        mocks.latestChannel?.onmessage?.({ type: 'completed' });
      });
      return Promise.resolve();
    });
    const provider = new OllamaModelProvider();
    const events = [];

    for await (const event of provider.run(
      {
        schemaVersion: 1,
        runId: 'run-1',
        endpoint: defaultAiSettings.endpoint,
        model: defaultAiSettings.model,
        systemPrompt: '安全规则',
        prompt: '公开测试文本',
        maxOutputChars: 8_000,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'output-delta', delta: '安全草稿' },
      { type: 'usage', inputTokens: 10, outputTokens: 4 },
      { type: 'completed' },
    ]);
  });

  it('maps native failures to stable provider errors without leaking details', async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'ai_ollama_chat') {
        return Promise.reject(
          Object.assign(new Error('/private/path and native transport details'), {
            code: 'AI_MODEL_NOT_FOUND',
          }),
        );
      }
      return Promise.resolve();
    });
    const provider = new OllamaModelProvider();
    const events = [];

    for await (const event of provider.run(
      {
        schemaVersion: 1,
        runId: 'run-2',
        endpoint: defaultAiSettings.endpoint,
        model: defaultAiSettings.model,
        systemPrompt: '安全规则',
        prompt: '公开测试文本',
        maxOutputChars: 8_000,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'failed',
        code: 'AI_MODEL_NOT_FOUND',
        message: '所选 Ollama 模型未安装。',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('/private/path');
  });
});

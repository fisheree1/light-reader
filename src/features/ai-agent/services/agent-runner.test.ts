import { describe, expect, it, vi } from 'vitest';

import { defaultAiSettings } from '../domain/ai-settings';
import type {
  AgentModelRequest,
  AgentProviderEvent,
  ModelProviderGateway,
} from '../../../platform/ai/model-provider-gateway';
import { FakeModelProvider } from '../../../platform/ai/fake-model-provider';
import { AgentConsentService } from './agent-consent-service';
import { AgentRunner } from './agent-runner';
import { AgentScopePolicy } from './agent-scope-policy';
import { AiDraftService } from './ai-draft-service';

const selection = {
  text: '一段公开的测试文本',
  textBefore: null,
  textAfter: null,
  locator: {
    version: 1 as const,
    format: 'epub' as const,
    chapterHref: 'chapter.xhtml',
    progression: 0.2,
  },
};

function prepare() {
  let nextId = 0;
  const consent = new AgentConsentService(
    () => `id-${String((nextId += 1))}`,
    () => 100,
  );
  const prepared = consent.prepare({
    action: 'summarize',
    bookId: 'book-1',
    bookTitle: '测试书',
    selection,
    settings: { ...defaultAiSettings, enabled: true },
  });
  return { consent, prepared };
}

describe('AgentRunner', () => {
  it('refuses to call the provider before consent', async () => {
    const { prepared } = prepare();
    const provider = new FakeModelProvider();
    const run = vi.spyOn(provider, 'run');
    const runner = new AgentRunner(provider);

    await expect(
      runner.runSelection(
        prepared,
        { ...defaultAiSettings, enabled: true },
        new AbortController().signal,
      ),
    ).rejects.toThrow('必须先确认发送内容');
    expect(run).not.toHaveBeenCalled();
  });

  it('creates an isolated draft from an approved bounded selection', async () => {
    const { consent, prepared } = prepare();
    const approved = consent.approve(prepared, '用户确认后的文本');
    const runner = new AgentRunner(
      new FakeModelProvider('安全的测试草稿'),
      new AgentScopePolicy(),
      new AiDraftService(
        () => 'draft-1',
        () => 102,
      ),
      () => 101,
    );

    const result = await runner.runSelection(
      approved,
      { ...defaultAiSettings, enabled: true },
      new AbortController().signal,
    );

    expect(result.run.status).toBe('completed');
    expect(result.draft.content).toBe('安全的测试草稿');
    expect(result.draft.status).toBe('draft');
    expect(result.draft.citations).toEqual([]);
    expect(result.draft.sourceSnapshotHash).not.toContain('用户确认后的文本');
  });

  it('keeps a custom request separate from untrusted book text', async () => {
    let nextId = 0;
    const consent = new AgentConsentService(
      () => `custom-${String((nextId += 1))}`,
      () => 100,
    );
    const prepared = consent.prepare({
      action: 'custom',
      bookId: 'book-1',
      bookTitle: '测试书',
      instruction: '分析作者的论证漏洞',
      selection,
      settings: { ...defaultAiSettings, enabled: true },
    });
    const approved = consent.approve(prepared, '用户确认后的文本');
    const capturedRequests: AgentModelRequest[] = [];
    const provider: ModelProviderGateway = {
      capabilities: {
        streaming: true,
        structuredOutput: false,
        functionTools: false,
      },
      getStatus: () =>
        Promise.resolve({ available: true, errorCode: null, models: [] }),
      async *run(request): AsyncIterable<AgentProviderEvent> {
        await Promise.resolve();
        capturedRequests.push(request);
        yield { type: 'output-delta', delta: '自定义草稿' };
        yield { type: 'completed' };
      },
    };

    const result = await new AgentRunner(
      provider,
      new AgentScopePolicy(),
      new AiDraftService(),
      () => 101,
    ).runSelection(
      approved,
      { ...defaultAiSettings, enabled: true },
      new AbortController().signal,
    );

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.prompt).toContain(
      '<USER_REQUEST>\n分析作者的论证漏洞\n</USER_REQUEST>',
    );
    expect(capturedRequests[0]?.prompt).toContain(
      '<UNTRUSTED_BOOK_TEXT>\n用户确认后的文本\n</UNTRUSTED_BOOK_TEXT>',
    );
    expect(result.draft.title).toBe('自定义需求：AI 阅读草稿');
  });

  it('stops without creating a draft after cancellation', async () => {
    const { consent, prepared } = prepare();
    const approved = consent.approve(prepared, prepared.text);
    const controller = new AbortController();
    const provider: ModelProviderGateway = {
      capabilities: {
        streaming: true,
        structuredOutput: false,
        functionTools: false,
      },
      getStatus: () =>
        Promise.resolve({ available: true, errorCode: null, models: [] }),
      async *run(): AsyncIterable<AgentProviderEvent> {
        await Promise.resolve();
        yield { type: 'output-delta', delta: '迟到内容' };
        yield { type: 'completed' };
      },
    };
    const runner = new AgentRunner(
      provider,
      new AgentScopePolicy(),
      new AiDraftService(
        () => 'draft-1',
        () => 102,
      ),
      () => 101,
    );

    await expect(
      runner.runSelection(
        approved,
        { ...defaultAiSettings, enabled: true },
        controller.signal,
        () => {
          controller.abort();
        },
      ),
    ).rejects.toMatchObject({ code: 'USER_CANCELLED' });
  });

  it('enforces the provider-independent total timeout', async () => {
    const { consent, prepared } = prepare();
    const approved = consent.approve(prepared, prepared.text);
    const provider: ModelProviderGateway = {
      capabilities: {
        streaming: true,
        structuredOutput: false,
        functionTools: false,
      },
      getStatus: () =>
        Promise.resolve({ available: true, errorCode: null, models: [] }),
      async *run(): AsyncIterable<AgentProviderEvent> {
        await new Promise(() => undefined);
        yield { type: 'completed' };
      },
    };
    const runner = new AgentRunner(
      provider,
      new AgentScopePolicy(),
      new AiDraftService(
        () => 'draft-1',
        () => 102,
      ),
      () => 101,
      5,
    );

    await expect(
      runner.runSelection(
        approved,
        { ...defaultAiSettings, enabled: true },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_REQUEST_TIMEOUT' });
  });

  it('maps provider failure without producing a draft', async () => {
    const { consent, prepared } = prepare();
    const approved = consent.approve(prepared, prepared.text);
    const provider: ModelProviderGateway = {
      capabilities: {
        streaming: true,
        structuredOutput: false,
        functionTools: false,
      },
      getStatus: () =>
        Promise.resolve({ available: false, errorCode: null, models: [] }),
      async *run(): AsyncIterable<AgentProviderEvent> {
        await Promise.resolve();
        yield {
          type: 'failed',
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: '本机服务不可用。',
        };
      },
    };
    const runner = new AgentRunner(
      provider,
      new AgentScopePolicy(),
      new AiDraftService(
        () => 'draft-1',
        () => 102,
      ),
      () => 101,
    );

    await expect(
      runner.runSelection(
        approved,
        { ...defaultAiSettings, enabled: true },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });
});

describe('AgentScopePolicy', () => {
  it('rejects expired, out-of-book, and oversized access', () => {
    const { consent, prepared } = prepare();
    const approved = consent.approve(prepared, prepared.text);
    const policy = new AgentScopePolicy();

    expect(
      policy.authorizeSelection(approved.grant, 'other-book', 'text', 101),
    ).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
    expect(
      policy.authorizeSelection(
        approved.grant,
        'book-1',
        'x'.repeat(12_001),
        101,
      ),
    ).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    expect(
      policy.authorizeSelection(
        approved.grant,
        'book-1',
        'text',
        approved.grant.expiresAt + 1,
      ),
    ).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
  });
});

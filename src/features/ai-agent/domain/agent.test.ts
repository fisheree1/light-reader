import { describe, expect, it } from 'vitest';

import {
  agentEventSchema,
  agentRunSchema,
  hashAgentText,
  transitionAgentRun,
} from './agent';

function createRun() {
  return agentRunSchema.parse({
    schemaVersion: 1,
    id: 'run-1',
    task: 'selection-assist',
    action: 'summarize',
    status: 'awaiting-consent',
    provider: 'ollama',
    model: 'deepseek-r1:8b',
    promptVersion: 'selection-assist-v1',
    scopeGrantId: 'grant-1',
    createdAt: 1,
    startedAt: null,
    completedAt: null,
    inputTokens: null,
    outputTokens: null,
    toolCallCount: 0,
    errorCode: null,
  });
}

describe('agent domain', () => {
  it('allows only valid run transitions and makes terminal states final', () => {
    const running = transitionAgentRun(createRun(), 'running', 2);
    const completed = transitionAgentRun(running, 'completed', 3);

    expect(running.startedAt).toBe(2);
    expect(completed.completedAt).toBe(3);
    expect(() => transitionAgentRun(completed, 'running', 4)).toThrow(
      'Invalid agent run transition',
    );
  });

  it('creates stable hashes without retaining source text', () => {
    expect(hashAgentText('公开测试文本')).toBe(hashAgentText('公开测试文本'));
    expect(hashAgentText('公开测试文本')).not.toBe(hashAgentText('其他文本'));
    expect(hashAgentText('公开测试文本')).not.toContain('公开测试文本');
  });

  it('rejects malformed or oversized internal provider events', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'output-delta',
        runId: 'run-1',
        delta: '安全内容',
      }).success,
    ).toBe(true);
    expect(
      agentEventSchema.safeParse({
        type: 'output-delta',
        runId: 'run-1',
        delta: 'x'.repeat(8_001),
      }).success,
    ).toBe(false);
    expect(
      agentEventSchema.safeParse({ type: 'execute-shell', runId: 'run-1' })
        .success,
    ).toBe(false);
  });
});

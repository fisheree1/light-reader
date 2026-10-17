import { invoke } from '@tauri-apps/api/core';

import {
  invokeCancellable,
  nativeErrorCode,
  responseBytes,
} from './cancellable-invoke';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const options = {
  cancelCommand: 'demo_cancel',
  timeoutMs: 1000,
  fallback: 'OPDS_UNREACHABLE',
} as const;

describe('cancellable native invoke', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('maps native errors exactly or by containment, with a fallback', () => {
    expect(nativeErrorCode('SOURCE_BUSY', 'exact', 'SOURCE_INVALID')).toBe(
      'SOURCE_BUSY',
    );
    expect(
      nativeErrorCode('failed: SOURCE_BUSY', 'exact', 'SOURCE_INVALID'),
    ).toBe('SOURCE_INVALID');
    expect(
      nativeErrorCode(
        new Error('failed: SOURCE_BUSY'),
        'contains',
        'SOURCE_INVALID',
      ),
    ).toBe('SOURCE_BUSY');
    expect(nativeErrorCode(42, 'contains', 'OPDS_UNREACHABLE')).toBe(
      'OPDS_UNREACHABLE',
    );
  });

  it('passes a request ID and turns rejections into discovery errors', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('ok');
    await expect(
      invokeCancellable(
        'demo',
        { a: 1 },
        options,
        new AbortController().signal,
      ),
    ).resolves.toBe('ok');
    expect(vi.mocked(invoke).mock.calls[0]).toEqual([
      'demo',
      { a: 1, requestId: expect.any(String) as string },
    ]);
    vi.mocked(invoke).mockRejectedValueOnce('SOURCE_RATE_LIMITED');
    await expect(
      invokeCancellable('demo', {}, options, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
  });

  it('stops the native request on cancellation and on timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockImplementation((command) =>
        command === 'demo'
          ? new Promise<never>(() => undefined)
          : Promise.resolve(),
      );
      const controller = new AbortController();
      const cancelled = expect(
        invokeCancellable('demo', {}, options, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await cancelled;
      const timedOut = expect(
        invokeCancellable('demo', {}, options, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1000);
      await timedOut;
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === 'demo_cancel'),
      ).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads binary responses', () => {
    expect(responseBytes(new Uint8Array([1]), 'SOURCE_IMAGE_FAILED')).toEqual(
      new Uint8Array([1]),
    );
    expect(
      responseBytes(new Uint8Array([2]).buffer, 'SOURCE_IMAGE_FAILED'),
    ).toEqual(new Uint8Array([2]));
    expect(() => responseBytes([1], 'SOURCE_IMAGE_FAILED')).toThrow(
      expect.objectContaining({ code: 'SOURCE_IMAGE_FAILED' }),
    );
  });
});

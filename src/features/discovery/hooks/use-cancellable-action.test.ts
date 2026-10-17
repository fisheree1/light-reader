import { act, renderHook, waitFor } from '@testing-library/react';

import { DiscoveryError } from '../domain/discovery-error';
import { useCancellableAction } from './use-cancellable-action';

describe('useCancellableAction', () => {
  it('reports errors, ignores aborted actions and runs the callbacks', async () => {
    const onStart = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useCancellableAction({ onStart, onSettled }),
    );

    await act(() =>
      result.current.perform(() =>
        Promise.reject(new DiscoveryError('SOURCE_ACCESS_DENIED')),
      ),
    );
    expect(result.current.error).toMatch(/^书源页面受限/);
    expect(result.current.busy).toBe(false);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);

    let first!: Promise<void>;
    act(() => {
      first = result.current.perform(
        (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('Cancelled', 'AbortError'));
            });
          }),
      );
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeNull();
    act(() => {
      result.current.abort();
    });
    await act(() => first);
    // An aborted action never shows an error, and only the latest settles.
    expect(result.current.error).toBeNull();
    expect(result.current.aborted()).toBe(true);
  });

  it('aborts the running action on unmount', async () => {
    let seen: AbortSignal | undefined;
    const { result, unmount } = renderHook(() => useCancellableAction());
    act(() => {
      void result.current.perform((signal) => {
        seen = signal;
        return new Promise<void>(() => undefined);
      });
    });
    await waitFor(() => {
      expect(seen).toBeDefined();
    });
    unmount();
    expect(seen?.aborted).toBe(true);
  });
});

import { withDeferredResizeObservers } from './deferred-resize-observer';

describe('withDeferredResizeObservers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers renderer resize notifications and restores the native constructor', async () => {
    let nativeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class NativeResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        nativeCallback = callback;
      }

      disconnect = disconnect;
      observe = observe;
      unobserve = unobserve;
    }
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('ResizeObserver', NativeResizeObserver);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const listener = vi.fn();

    await withDeferredResizeObservers(() => {
      const observer = new ResizeObserver(listener);
      observer.observe(document.body);
      nativeCallback?.(
        [{ target: document.body } as unknown as ResizeObserverEntry],
        observer,
      );

      expect(listener).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledWith(document.body, undefined);
      return Promise.resolve();
    });

    expect(globalThis.ResizeObserver).toBe(NativeResizeObserver);
    frames[0]?.(performance.now());
    expect(listener).toHaveBeenCalledWith(
      [expect.objectContaining({ target: document.body })],
      expect.any(Object),
    );
  });
});

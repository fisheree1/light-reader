type FrameScheduler = (callback: FrameRequestCallback) => number;
type FrameCanceller = (handle: number) => void;

let activeScopes = 0;
let installedObserver: typeof ResizeObserver | null = null;
let nativeObserver: typeof ResizeObserver | null = null;

function createDeferredResizeObserver(
  NativeResizeObserver: typeof ResizeObserver,
  scheduleFrame: FrameScheduler,
  cancelFrame: FrameCanceller,
): typeof ResizeObserver {
  return class DeferredResizeObserver implements ResizeObserver {
    private frameHandle: number | null = null;
    private readonly observer: ResizeObserver;
    private readonly pendingEntries = new Map<Element, ResizeObserverEntry>();

    constructor(callback: ResizeObserverCallback) {
      this.observer = new NativeResizeObserver((entries) => {
        for (const entry of entries) {
          this.pendingEntries.set(entry.target, entry);
        }
        if (this.frameHandle !== null) return;

        this.frameHandle = scheduleFrame(() => {
          this.frameHandle = null;
          const pending = [...this.pendingEntries.values()];
          this.pendingEntries.clear();
          if (pending.length > 0) callback(pending, this);
        });
      });
    }

    disconnect(): void {
      if (this.frameHandle !== null) {
        cancelFrame(this.frameHandle);
        this.frameHandle = null;
      }
      this.pendingEntries.clear();
      this.observer.disconnect();
    }

    observe(target: Element, options?: ResizeObserverOptions): void {
      this.observer.observe(target, options);
    }

    unobserve(target: Element): void {
      this.pendingEntries.delete(target);
      this.observer.unobserve(target);
    }
  };
}

/**
 * Foliate's renderers synchronously mutate their observed layout from inside
 * ResizeObserver callbacks. Chromium reports that feedback as an undelivered
 * notification loop. Defer observers created during renderer initialization
 * to the next animation frame without changing observers owned by the app.
 */
export async function withDeferredResizeObservers<T>(
  action: () => Promise<T>,
): Promise<T> {
  const observerCandidate: unknown = Reflect.get(globalThis, 'ResizeObserver');
  const scheduleCandidate: unknown = Reflect.get(
    globalThis,
    'requestAnimationFrame',
  );
  const cancelCandidate: unknown = Reflect.get(
    globalThis,
    'cancelAnimationFrame',
  );
  if (
    typeof observerCandidate !== 'function' ||
    typeof scheduleCandidate !== 'function' ||
    typeof cancelCandidate !== 'function'
  ) {
    return action();
  }
  const currentObserver = observerCandidate as typeof ResizeObserver;
  const scheduleFrame = scheduleCandidate.bind(globalThis) as FrameScheduler;
  const cancelFrame = cancelCandidate.bind(globalThis) as FrameCanceller;

  if (activeScopes === 0) {
    nativeObserver = currentObserver;
    const deferredObserver = createDeferredResizeObserver(
      currentObserver,
      scheduleFrame,
      cancelFrame,
    );
    installedObserver = deferredObserver;
    globalThis.ResizeObserver = deferredObserver;
  }
  activeScopes += 1;

  try {
    return await action();
  } finally {
    activeScopes -= 1;
    if (activeScopes === 0) {
      if (
        nativeObserver &&
        installedObserver &&
        globalThis.ResizeObserver === installedObserver
      ) {
        globalThis.ResizeObserver = nativeObserver;
      }
      nativeObserver = null;
      installedObserver = null;
    }
  }
}

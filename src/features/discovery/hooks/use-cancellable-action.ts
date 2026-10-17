import { useCallback, useEffect, useRef, useState } from 'react';

import { discoveryErrorMessage } from '../domain/discovery-error';

export interface CancellableActionOptions {
  /** Runs when an action starts, after the previous one was aborted. */
  onStart?: () => void;
  /** Runs when the latest action settles, while still mounted. */
  onSettled?: () => void;
}

/**
 * One cancellable request at a time for a discovery panel: starting an action
 * aborts the previous one, errors become a message (never for an aborted
 * action), and unmounting aborts whatever is running.
 */
export function useCancellableAction(options: CancellableActionOptions = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const perform = useCallback(
    async (action: (signal: AbortSignal) => Promise<void>) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setError(null);
      callbacks.current.onStart?.();
      try {
        await action(controller.signal);
      } catch (value) {
        if (!controller.signal.aborted && mounted.current)
          setError(discoveryErrorMessage(value));
      } finally {
        if (request.current === controller && mounted.current) {
          setBusy(false);
          callbacks.current.onSettled?.();
        }
      }
    },
    [],
  );

  const abort = useCallback(() => {
    request.current?.abort();
  }, []);

  /** Whether the latest action was aborted (a cancel or a newer action). */
  const aborted = useCallback(
    () => request.current?.signal.aborted ?? false,
    [],
  );

  return { aborted, abort, busy, error, mounted, perform, setError };
}

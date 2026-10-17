import { invoke } from '@tauri-apps/api/core';

import { createUuid } from '../../lib/id';
import {
  DiscoveryError,
  discoveryErrorKeys,
  throwIfCancelled,
  type DiscoveryErrorCode,
} from '../../features/discovery/domain/discovery-error';

export interface CancellableInvokeOptions {
  /** Native command that aborts the request with this request ID. */
  cancelCommand: string;
  /** Front-end limit on top of the native one, in milliseconds. */
  timeoutMs: number;
  /** Code for a native error that names no known code. */
  fallback: DiscoveryErrorCode;
  /**
   * How a native error names its code: most commands return the bare code;
   * the source window's messages may wrap it in other text.
   */
  match?: 'exact' | 'contains';
}

const codes = Object.keys(discoveryErrorKeys) as DiscoveryErrorCode[];

/** The discovery error a native command's rejection stands for. */
export function nativeErrorCode(
  error: unknown,
  match: 'exact' | 'contains',
  fallback: DiscoveryErrorCode,
): DiscoveryErrorCode {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return (
    codes.find((code) =>
      match === 'exact' ? message === code : message.includes(code),
    ) ?? fallback
  );
}

/**
 * Invokes a native request command with a request ID, so cancelling the
 * signal or hitting the timeout also stops the native side. The caller's
 * wait ends immediately either way; errors become `DiscoveryError`s.
 */
export async function invokeCancellable(
  command: string,
  arguments_: Record<string, unknown>,
  options: CancellableInvokeOptions,
  signal: AbortSignal,
): Promise<unknown> {
  throwIfCancelled(signal);
  const requestId = createUuid();
  let stopWaiting: (error: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    stopWaiting = reject;
  });
  const stopNative = () => {
    void invoke(options.cancelCommand, { requestId }).catch(() => undefined);
  };
  const cancel = () => {
    stopNative();
    stopWaiting(new DOMException('Cancelled', 'AbortError'));
  };
  const timer = setTimeout(() => {
    stopNative();
    stopWaiting(new DiscoveryError('SOURCE_TIMEOUT'));
  }, options.timeoutMs);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result: unknown = await Promise.race([
      invoke(command, { ...arguments_, requestId }),
      stopped,
    ]);
    throwIfCancelled(signal);
    return result;
  } catch (error) {
    throwIfCancelled(signal);
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError(
      nativeErrorCode(error, options.match ?? 'exact', options.fallback),
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/** Bytes from a binary command response (`tauri::ipc::Response`). */
export function responseBytes(
  result: unknown,
  failure: DiscoveryErrorCode,
): Uint8Array {
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  throw new DiscoveryError(failure);
}

/**
 * Runs requests one after another, so a search made while a download runs
 * waits its turn instead of hitting the native one-request limit.
 */
export function createRequestLane() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

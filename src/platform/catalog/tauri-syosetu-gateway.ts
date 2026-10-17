import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { createUuid } from '../../lib/id';
import {
  DiscoveryError,
  discoveryErrorKeys,
  throwIfCancelled,
  type DiscoveryErrorCode,
} from '../../features/discovery/domain/discovery-error';
import type { SyosetuGateway } from '../../features/discovery/syosetu/syosetu-service';

const responseSchema = z.object({ url: z.url(), text: z.string() });

/** Desktop access to なろう; pacing and host checks are native. */
export class TauriSyosetuGateway implements SyosetuGateway {
  readonly available = true;

  private async invokeCancellable(
    command: 'syosetu_search' | 'syosetu_page' | 'syosetu_image',
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    throwIfCancelled(signal);
    const requestId = createUuid();
    let stopWaiting: (error: Error) => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      stopWaiting = reject;
    });
    const stopNative = () => {
      void invoke('syosetu_cancel', { requestId }).catch(() => undefined);
    };
    const cancel = () => {
      stopNative();
      stopWaiting(new DOMException('Cancelled', 'AbortError'));
    };
    // Up to 2 s of native spacing plus 30 s per request; an illustration
    // may take three redirects.
    const timer = setTimeout(
      () => {
        stopNative();
        stopWaiting(new DiscoveryError('SOURCE_TIMEOUT'));
      },
      command === 'syosetu_image' ? 130_000 : 40_000,
    );
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
      const message = typeof error === 'string' ? error : '';
      const code = (
        Object.keys(discoveryErrorKeys) as DiscoveryErrorCode[]
      ).find((value) => message === value);
      throw new DiscoveryError(code ?? 'SOURCE_INVALID', { cause: error });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  private async text(
    command: 'syosetu_search' | 'syosetu_page',
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    return responseSchema.parse(
      await this.invokeCancellable(command, arguments_, signal),
    ).text;
  }

  search(query: string, page: number, signal: AbortSignal) {
    return this.text('syosetu_search', { query, page }, signal);
  }

  page(path: string, signal: AbortSignal) {
    return this.text('syosetu_page', { path }, signal);
  }

  async image(url: string, signal: AbortSignal): Promise<Uint8Array> {
    const result = await this.invokeCancellable(
      'syosetu_image',
      { url },
      signal,
    );
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    if (result instanceof Uint8Array) return result;
    throw new DiscoveryError('SOURCE_IMAGE_FAILED');
  }
}

export class UnavailableSyosetuGateway implements SyosetuGateway {
  readonly available = false;
  search(): Promise<string> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  page(): Promise<string> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  image(): Promise<Uint8Array> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
}

export function createSyosetuGateway(): SyosetuGateway {
  return isTauri()
    ? new TauriSyosetuGateway()
    : new UnavailableSyosetuGateway();
}

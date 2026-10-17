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

  private async request(
    command: 'syosetu_search' | 'syosetu_page',
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
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
    // Up to 2 s of native spacing plus the 30 s request limit.
    const timer = setTimeout(() => {
      stopNative();
      stopWaiting(new DiscoveryError('SOURCE_TIMEOUT'));
    }, 40_000);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result: unknown = await Promise.race([
        invoke(command, { ...arguments_, requestId }),
        stopped,
      ]);
      throwIfCancelled(signal);
      return responseSchema.parse(result).text;
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

  search(query: string, page: number, signal: AbortSignal) {
    return this.request('syosetu_search', { query, page }, signal);
  }

  page(path: string, signal: AbortSignal) {
    return this.request('syosetu_page', { path }, signal);
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
}

export function createSyosetuGateway(): SyosetuGateway {
  return isTauri()
    ? new TauriSyosetuGateway()
    : new UnavailableSyosetuGateway();
}

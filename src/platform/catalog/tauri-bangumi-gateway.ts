import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { createUuid } from '../../lib/id';
import {
  DiscoveryError,
  discoveryErrorKeys,
  throwIfCancelled,
  type DiscoveryErrorCode,
} from '../../features/discovery/domain/discovery-error';
import type { BangumiGateway } from '../../features/discovery/bangumi/bangumi-service';

const responseSchema = z.object({ text: z.string() });

/** Desktop access to the Bangumi API through the native, paced commands. */
export class TauriBangumiGateway implements BangumiGateway {
  readonly available = true;

  private async request(
    command: 'bangumi_search' | 'bangumi_subject',
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
      void invoke('bangumi_cancel', { requestId }).catch(() => undefined);
    };
    const cancel = () => {
      stopNative();
      stopWaiting(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      stopNative();
      stopWaiting(new DiscoveryError('SOURCE_TIMEOUT'));
    }, 30_000);
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

  search(keyword: string, signal: AbortSignal) {
    return this.request('bangumi_search', { keyword }, signal);
  }

  subject(id: number, signal: AbortSignal) {
    return this.request('bangumi_subject', { id }, signal);
  }
}

export class UnavailableBangumiGateway implements BangumiGateway {
  readonly available = false;
  search(): Promise<string> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  subject(): Promise<string> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
}

export function createBangumiGateway(): BangumiGateway {
  return isTauri()
    ? new TauriBangumiGateway()
    : new UnavailableBangumiGateway();
}

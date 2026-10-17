import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { createUuid } from '../../lib/id';
import {
  DiscoveryError,
  discoveryErrorKeys,
  throwIfCancelled,
  type DiscoveryErrorCode,
} from '../../features/discovery/domain/discovery-error';
import type { OpdsGateway } from '../../features/discovery/opds/opds-service';

const feedSchema = z.object({ url: z.url(), text: z.string() });

function toBytes(result: unknown): Uint8Array {
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  throw new DiscoveryError('OPDS_UNREACHABLE');
}

function errorCode(error: unknown): DiscoveryErrorCode {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return (
    (Object.keys(discoveryErrorKeys) as DiscoveryErrorCode[]).find(
      (code) => message === code,
    ) ?? 'OPDS_UNREACHABLE'
  );
}

/** Desktop OPDS access through the native, origin-checked request commands. */
export class TauriOpdsGateway implements OpdsGateway {
  readonly available = true;

  private async request(
    command: 'opds_read_feed' | 'opds_download',
    arguments_: Record<string, unknown>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    throwIfCancelled(signal);
    const requestId = createUuid();
    let stopWaiting: (error: Error) => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      stopWaiting = reject;
    });
    const stopNative = () => {
      void invoke('opds_cancel', { requestId }).catch(() => undefined);
    };
    const cancel = () => {
      stopNative();
      stopWaiting(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      stopNative();
      stopWaiting(new DiscoveryError('SOURCE_TIMEOUT'));
    }, timeoutMs);
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
      throw new DiscoveryError(errorCode(error), { cause: error });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  async readFeed(catalogUrl: string, url: string, signal: AbortSignal) {
    return feedSchema.parse(
      await this.request('opds_read_feed', { catalogUrl, url }, 50_000, signal),
    );
  }

  async download(
    catalogUrl: string,
    url: string,
    kind: 'image' | 'book',
    signal: AbortSignal,
  ) {
    return toBytes(
      await this.request(
        'opds_download',
        { catalogUrl, url, kind },
        kind === 'book' ? 16 * 60_000 : 50_000,
        signal,
      ),
    );
  }
}

export class UnavailableOpdsGateway implements OpdsGateway {
  readonly available = false;
  readFeed(): ReturnType<OpdsGateway['readFeed']> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  download(): ReturnType<OpdsGateway['download']> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
}

export function createOpdsGateway(): OpdsGateway {
  return isTauri() ? new TauriOpdsGateway() : new UnavailableOpdsGateway();
}

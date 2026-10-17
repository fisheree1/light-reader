import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { DiscoveryError } from '../../features/discovery/domain/discovery-error';
import { invokeCancellable, responseBytes } from './cancellable-invoke';
import type { OpdsGateway } from '../../features/discovery/opds/opds-service';

const feedSchema = z.object({ url: z.url(), text: z.string() });

/** Desktop OPDS access through the native, origin-checked request commands. */
export class TauriOpdsGateway implements OpdsGateway {
  readonly available = true;

  private request(
    command: 'opds_read_feed' | 'opds_download',
    arguments_: Record<string, unknown>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeCancellable(
      command,
      arguments_,
      { cancelCommand: 'opds_cancel', timeoutMs, fallback: 'OPDS_UNREACHABLE' },
      signal,
    );
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
    return responseBytes(
      await this.request(
        'opds_download',
        { catalogUrl, url, kind },
        kind === 'book' ? 16 * 60_000 : 50_000,
        signal,
      ),
      'OPDS_UNREACHABLE',
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

import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { DiscoveryError } from '../../features/discovery/domain/discovery-error';
import {
  createRequestLane,
  invokeCancellable,
  responseBytes,
} from './cancellable-invoke';
import type { SyosetuGateway } from '../../features/discovery/syosetu/syosetu-service';

const responseSchema = z.object({ url: z.url(), text: z.string() });

/** Desktop access to なろう; pacing and host checks are native. */
export class TauriSyosetuGateway implements SyosetuGateway {
  readonly available = true;

  // Downloads and searches share the native one-request queue.
  private readonly lane = createRequestLane();

  private invoke(
    command: 'syosetu_search' | 'syosetu_page' | 'syosetu_image',
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.lane(() =>
      invokeCancellable(
        command,
        arguments_,
        {
          cancelCommand: 'syosetu_cancel',
          // Up to 2 s of native spacing plus 30 s per request; an illustration
          // may take three redirects.
          timeoutMs: command === 'syosetu_image' ? 130_000 : 40_000,
          fallback: 'SOURCE_INVALID',
        },
        signal,
      ),
    );
  }

  private async text(
    command: 'syosetu_search' | 'syosetu_page',
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    return responseSchema.parse(await this.invoke(command, arguments_, signal))
      .text;
  }

  search(query: string, page: number, signal: AbortSignal) {
    return this.text('syosetu_search', { query, page }, signal);
  }

  page(path: string, signal: AbortSignal) {
    return this.text('syosetu_page', { path }, signal);
  }

  async image(url: string, signal: AbortSignal): Promise<Uint8Array> {
    return responseBytes(
      await this.invoke('syosetu_image', { url }, signal),
      'SOURCE_IMAGE_FAILED',
    );
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

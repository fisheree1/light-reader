import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';

import { DiscoveryError } from '../../features/discovery/domain/discovery-error';
import { invokeCancellable } from './cancellable-invoke';
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
    return responseSchema.parse(
      await invokeCancellable(
        command,
        arguments_,
        {
          cancelCommand: 'bangumi_cancel',
          timeoutMs: 30_000,
          fallback: 'SOURCE_INVALID',
        },
        signal,
      ),
    ).text;
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

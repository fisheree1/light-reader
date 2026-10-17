import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  pageSnapshotSchema,
  type NovelGateway,
  type NovelSource,
  type PageRequest,
} from '../../features/discovery/domain/catalog';
import {
  DiscoveryError,
  throwIfCancelled,
} from '../../features/discovery/domain/discovery-error';
import { sourceUrl } from '../../features/discovery/services/bilinovel-parser';
import { invokeCancellable, responseBytes } from './cancellable-invoke';

/** Minimum gap after any source request before the next page load. */
export const PAGE_REQUEST_GAP_MS = 2000;
/** Minimum gap after any source request before the next image download. */
export const IMAGE_REQUEST_GAP_MS = 1000;

export class TauriNovelGateway implements NovelGateway {
  readonly available = true;
  // Pages and images come from the same source, so they share one clock:
  // requests are strictly sequential and spaced, whatever their kind.
  private lastRequestFinished = 0;

  private async pace(gap: number, signal: AbortSignal): Promise<void> {
    throwIfCancelled(signal);
    const delay = Math.max(0, gap - (Date.now() - this.lastRequestFinished));
    if (!delay) return;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, delay);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  private request(
    command: string,
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeCancellable(
      command,
      arguments_,
      {
        cancelCommand: 'catalog_cancel',
        timeoutMs: command === 'catalog_read_image' ? 40_000 : 45_000,
        fallback: 'SOURCE_INVALID',
        // Source-window failures may wrap the code in other text.
        match: 'contains',
      },
      signal,
    );
  }

  async readPage(
    source: NovelSource,
    request: PageRequest,
    signal: AbortSignal,
  ) {
    await this.pace(PAGE_REQUEST_GAP_MS, signal);
    try {
      return pageSnapshotSchema.parse(
        await this.request('catalog_read_page', { source, request }, signal),
      );
    } finally {
      this.lastRequestFinished = Date.now();
    }
  }

  async readImage(
    source: NovelSource,
    url: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    await this.pace(IMAGE_REQUEST_GAP_MS, signal);
    let result: unknown;
    try {
      result = await this.request(
        'catalog_read_image',
        { source, url },
        signal,
      );
    } finally {
      this.lastRequestFinished = Date.now();
    }
    if (result instanceof ArrayBuffer || result instanceof Uint8Array)
      return responseBytes(result, 'SOURCE_IMAGE_FAILED');
    if (
      Array.isArray(result) &&
      result.length <= 10 * 1024 * 1024 &&
      result.every(
        (byte) =>
          typeof byte === 'number' &&
          Number.isInteger(byte) &&
          byte >= 0 &&
          byte <= 255,
      )
    ) {
      return Uint8Array.from(result as number[]);
    }
    throw new DiscoveryError('SOURCE_IMAGE_FAILED');
  }

  async openSource(source: NovelSource): Promise<void> {
    try {
      await invoke('catalog_open_source', { source });
    } catch (error) {
      throw new DiscoveryError('SOURCE_UNAVAILABLE', { cause: error });
    }
  }
}

export class UnavailableNovelGateway implements NovelGateway {
  readonly available = false;
  readPage(): ReturnType<NovelGateway['readPage']> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  readImage(): ReturnType<NovelGateway['readImage']> {
    return Promise.reject(new DiscoveryError('SOURCE_UNAVAILABLE'));
  }
  openSource(source: NovelSource): Promise<void> {
    window.open(sourceUrl(source), '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }
}

export function createNovelGateway(): NovelGateway {
  return isTauri() ? new TauriNovelGateway() : new UnavailableNovelGateway();
}

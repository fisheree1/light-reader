import { throwIfCancelled } from '../domain/discovery-error';
import {
  parseBangumiSearch,
  parseBangumiSubject,
  type BangumiCandidate,
  type TranslationInfo,
} from './bangumi';

export interface BangumiGateway {
  readonly available: boolean;
  search(keyword: string, signal: AbortSignal): Promise<string>;
  subject(id: number, signal: AbortSignal): Promise<string>;
}

/** Looks up a light novel's Chinese titles and editions on Bangumi. */
export class BangumiService {
  readonly gateway: BangumiGateway;

  constructor(gateway: BangumiGateway) {
    this.gateway = gateway;
  }

  async search(
    keyword: string,
    signal: AbortSignal,
  ): Promise<BangumiCandidate[]> {
    const text = await this.gateway.search(keyword.trim(), signal);
    throwIfCancelled(signal);
    return parseBangumiSearch(text);
  }

  async details(id: number, signal: AbortSignal): Promise<TranslationInfo> {
    const text = await this.gateway.subject(id, signal);
    throwIfCancelled(signal);
    return parseBangumiSubject(text);
  }
}

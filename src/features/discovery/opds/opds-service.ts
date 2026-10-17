import type { BookImporter } from '../../library/services/book-import-service';
import { DiscoveryError, throwIfCancelled } from '../domain/discovery-error';
import {
  preferredAcquisition,
  type OpdsCatalog,
  type OpdsEntry,
  type OpdsFeed,
} from './opds';
import {
  fillSearchTemplate,
  parseOpdsFeed,
  parseOpenSearch,
} from './opds-parser';

export interface OpdsGateway {
  readonly available: boolean;
  readFeed(
    catalogUrl: string,
    url: string,
    signal: AbortSignal,
  ): Promise<{ url: string; text: string }>;
  download(
    catalogUrl: string,
    url: string,
    kind: 'image' | 'book',
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

/** A file name the importer accepts, from an untrusted entry title. */
export function bookFileName(title: string, extension: string): string {
  const base =
    title
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'book';
  return `${base}.${extension}`;
}

export class OpdsService {
  readonly gateway: OpdsGateway;
  private readonly importer: BookImporter;
  // Search templates by OpenSearch description URL, fetched once per session.
  private readonly templates = new Map<string, string>();

  constructor(gateway: OpdsGateway, importer: BookImporter) {
    this.gateway = gateway;
    this.importer = importer;
  }

  async open(
    catalog: OpdsCatalog,
    url: string,
    signal: AbortSignal,
  ): Promise<OpdsFeed> {
    const page = await this.gateway.readFeed(catalog.url, url, signal);
    throwIfCancelled(signal);
    return parseOpdsFeed(page.text, page.url);
  }

  async search(
    catalog: OpdsCatalog,
    feed: OpdsFeed,
    query: string,
    signal: AbortSignal,
  ): Promise<OpdsFeed> {
    const search = feed.search;
    if (!search || !query.trim()) throw new DiscoveryError('OPDS_NO_SEARCH');
    let template =
      search.kind === 'template'
        ? search.template
        : this.templates.get(search.url);
    if (!template && search.kind === 'description') {
      const description = await this.gateway.readFeed(
        catalog.url,
        search.url,
        signal,
      );
      template = parseOpenSearch(description.text, description.url);
      this.templates.set(search.url, template);
    }
    if (!template) throw new DiscoveryError('OPDS_NO_SEARCH');
    return this.open(catalog, fillSearchTemplate(template, query), signal);
  }

  cover(
    catalog: OpdsCatalog,
    url: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    return this.gateway.download(catalog.url, url, 'image', signal);
  }

  async acquire(catalog: OpdsCatalog, entry: OpdsEntry, signal: AbortSignal) {
    const choice = preferredAcquisition(entry);
    if (!choice) throw new DiscoveryError('OPDS_NO_FORMAT');
    if (!this.importer.importBytes)
      throw new DiscoveryError('SOURCE_UNAVAILABLE');
    const bytes = await this.gateway.download(
      catalog.url,
      choice.url,
      'book',
      signal,
    );
    throwIfCancelled(signal);
    const result = await this.importer.importBytes(
      bookFileName(entry.title, choice.format),
      bytes,
    );
    return { ...result, format: choice.format };
  }
}

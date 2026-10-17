import { DiscoveryError } from '../domain/discovery-error';
import {
  formatForType,
  type OpdsAcquisition,
  type OpdsEntry,
  type OpdsFeed,
  type OpdsSearch,
} from './opds';

const MAX_ENTRIES = 500;
const MAX_SUMMARY = 600;
const ACQUISITION = 'http://opds-spec.org/acquisition';
// Acquisitions that cost money or need an account the app cannot use.
const UNSUPPORTED_ACQUISITION = /\/(buy|borrow|subscribe|sample|preview)$/;

function parseXml(text: string): Document {
  if (text.trimStart().startsWith('{'))
    throw new DiscoveryError('OPDS_UNSUPPORTED');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new DiscoveryError('OPDS_NOT_FEED');
  return document;
}

/** An absolute http(s) URL, or null for anything else. */
function resolve(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Child elements by local name, ignoring namespaces and nesting. */
function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(
    (child) => child.localName === name,
  );
}

function childText(parent: Element, name: string): string | null {
  const text = children(parent, name)[0]?.textContent.trim();
  return text ? text : null;
}

function plainText(element: Element | undefined): string | null {
  if (!element) return null;
  const type = element.getAttribute('type');
  const text =
    type === 'html'
      ? new DOMParser().parseFromString(element.textContent, 'text/html').body
          .textContent
      : element.textContent;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > MAX_SUMMARY
    ? `${normalized.slice(0, MAX_SUMMARY)}…`
    : normalized;
}

/**
 * Resolves a search template against `base`, keeping `{searchTerms}` and
 * dropping other OpenSearch parameters before URL encoding would mangle them.
 */
function resolveTemplate(template: string, base: string): string | null {
  const resolved = resolve(
    template
      .replace(/\{(?!searchTerms\})[^}]*\}/g, '')
      .replaceAll('{searchTerms}', 'SEARCHTERMS'),
    base,
  );
  return resolved ? resolved.replaceAll('SEARCHTERMS', '{searchTerms}') : null;
}

function rels(link: Element): string[] {
  return (link.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean);
}

function isFeedType(type: string | null): boolean {
  return (type ?? '').toLowerCase().includes('application/atom+xml');
}

function parseEntry(entry: Element, base: string): OpdsEntry | null {
  const title = childText(entry, 'title');
  if (!title) return null;
  const acquisitions: OpdsAcquisition[] = [];
  let cover: string | null = null;
  let thumbnail: string | null = null;
  let navigationUrl: string | null = null;
  for (const link of children(entry, 'link')) {
    const href = resolve(link.getAttribute('href'), base);
    if (!href) continue;
    const type = link.getAttribute('type') ?? '';
    const linkRels = rels(link);
    if (
      linkRels.some(
        (rel) =>
          rel.startsWith(ACQUISITION) && !UNSUPPORTED_ACQUISITION.test(rel),
      )
    ) {
      const format = formatForType(type);
      if (format)
        acquisitions.push({
          url: href,
          type: type.split(';')[0]?.trim().toLowerCase() ?? type,
          format,
        });
    } else if (linkRels.some((rel) => rel.endsWith('/image/thumbnail')))
      thumbnail ??= href;
    else if (linkRels.some((rel) => rel.endsWith('opds-spec.org/image')))
      cover ??= href;
    else if (
      isFeedType(type) &&
      (linkRels.length === 0 ||
        linkRels.some((rel) =>
          ['subsection', 'alternate', 'collection'].includes(rel),
        ) ||
        linkRels.some((rel) => rel.startsWith('http://opds-spec.org/sort/')))
    )
      navigationUrl ??= href;
  }
  return {
    id: childText(entry, 'id') ?? navigationUrl ?? title,
    title: title.slice(0, 500),
    authors: children(entry, 'author')
      .map((author) => childText(author, 'name'))
      .filter((name): name is string => name !== null)
      .slice(0, 10),
    summary: plainText(
      children(entry, 'summary')[0] ?? children(entry, 'content')[0],
    ),
    coverUrl: thumbnail ?? cover,
    acquisitions,
    // An entry with downloads is a book even when it also links a feed.
    navigationUrl: acquisitions.length ? null : navigationUrl,
  };
}

/** Parses an OPDS 1.x Atom feed fetched from `url` (after redirects). */
export function parseOpdsFeed(text: string, url: string): OpdsFeed {
  const root = parseXml(text).documentElement;
  if (root.localName !== 'feed') throw new DiscoveryError('OPDS_NOT_FEED');
  const link = (rel: string) => {
    const match = children(root, 'link').find((item) =>
      rels(item).includes(rel),
    );
    return resolve(match?.getAttribute('href') ?? null, url);
  };
  let search: OpdsSearch | null = null;
  for (const item of children(root, 'link')) {
    if (!rels(item).includes('search')) continue;
    const href = item.getAttribute('href') ?? '';
    const type = (item.getAttribute('type') ?? '').toLowerCase();
    if (isFeedType(type) && href.includes('{searchTerms}')) {
      const template = resolveTemplate(href, url);
      if (template) search = { kind: 'template', template };
      break;
    }
    if (type.includes('opensearchdescription')) {
      const resolved = resolve(href, url);
      if (resolved) search = { kind: 'description', url: resolved };
    }
  }
  return {
    url,
    title: childText(root, 'title') ?? url,
    entries: children(root, 'entry')
      .slice(0, MAX_ENTRIES)
      .map((entry) => parseEntry(entry, url))
      .filter((entry): entry is OpdsEntry => entry !== null),
    next: link('next'),
    previous: link('previous') ?? link('prev'),
    start: link('start'),
    search,
  };
}

/** The Atom search template from an OpenSearch description document. */
export function parseOpenSearch(text: string, url: string): string {
  const root = parseXml(text).documentElement;
  const templates = Array.from(root.getElementsByTagNameNS('*', 'Url'))
    .filter((item) => {
      const type = item.getAttribute('type') ?? '';
      return isFeedType(type) || type === '';
    })
    .map((item) => item.getAttribute('template') ?? '')
    .filter((template) => template.includes('{searchTerms}'));
  const template = templates[0];
  const resolved = template ? resolveTemplate(template, url) : null;
  if (!resolved) throw new DiscoveryError('OPDS_NO_SEARCH');
  return resolved;
}

/** Fills a template from `resolveTemplate` with the user's query. */
export function fillSearchTemplate(template: string, query: string): string {
  return template.replaceAll('{searchTerms}', encodeURIComponent(query.trim()));
}

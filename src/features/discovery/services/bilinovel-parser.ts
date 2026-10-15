import {
  sourceHosts,
  type NovelCatalogue,
  type NovelSource,
  type NovelSummary,
  type PageSnapshot,
  type ParsedChapter,
} from '../domain/catalog';
import { DiscoveryError } from '../domain/discovery-error';

function firstNonEmpty(...values: (string | null | undefined)[]): string {
  return values.find((value) => Boolean(value?.trim())) ?? '';
}

export function sourceUrl(source: NovelSource, path = '/'): string {
  return new URL(path, `https://${sourceHosts[source]}`).href;
}

export function pagePath(source: NovelSource, value: string): string {
  const url = new URL(value, sourceUrl(source));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    ![sourceHosts[source], sourceHosts[source].slice(4)].includes(
      url.hostname,
    ) ||
    !/^\/novel\/\d{1,10}(?:\.html|\/catalog|\/(?:vol_)?\d{1,10}(?:_\d{1,2})?\.html)$/.test(
      url.pathname,
    ) ||
    url.search
  )
    throw new DiscoveryError('SOURCE_INVALID');
  return url.pathname;
}

export function imageUrl(
  source: NovelSource,
  value: string,
  base: string,
): string {
  const url = new URL(value, base);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    ![
      sourceHosts[source],
      sourceHosts[source].slice(4),
      'img3.readpai.com',
    ].includes(url.hostname) ||
    !/\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)
  )
    throw new DiscoveryError('SOURCE_IMAGE_FAILED');
  url.hash = '';
  return url.href;
}

function parseDocument(snapshot: PageSnapshot): Document {
  if (snapshot.html.length > 2 * 1024 * 1024)
    throw new DiscoveryError('SOURCE_TOO_LARGE');
  const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
  if (
    document.querySelector('#challenge-form, #cf-challenge-running') ||
    /just a moment|attention required|access denied/i.test(document.title)
  ) {
    throw new DiscoveryError('SOURCE_ACCESS_DENIED');
  }
  return document;
}

export function isSearchPath(path: string): boolean {
  return path === '/search.html' || /^\/S\d{1,3}\/?$/.test(path);
}

export function parseSearch(
  source: NovelSource,
  snapshot: PageSnapshot,
): NovelSummary[] {
  const document = parseDocument(snapshot);
  const results = new Map<string, NovelSummary>();
  const self = new URL(snapshot.url);
  // A single exact match can redirect straight to the book detail page.
  const selfMatch = /^\/novel\/(\d{1,10})(?:\.html|\/catalog)$/.exec(
    self.pathname,
  );
  if (
    self.protocol !== 'https:' ||
    self.username ||
    self.password ||
    self.port ||
    ![sourceHosts[source], sourceHosts[source].slice(4)].includes(
      self.hostname,
    ) ||
    (!selfMatch && !isSearchPath(self.pathname))
  )
    throw new DiscoveryError('SOURCE_INVALID');
  const heading = document.querySelector('h1')?.textContent.trim();
  if (selfMatch && heading)
    return [
      {
        id: selfMatch[1],
        title: heading,
        url: sourceUrl(source, self.pathname),
      },
    ];
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let path: string;
    try {
      path = pagePath(source, link.getAttribute('href') ?? '');
    } catch {
      continue;
    }
    const match = /^\/novel\/(\d+)\.html$/.exec(path);
    const title = firstNonEmpty(
      link.querySelector('img')?.getAttribute('alt'),
      link.textContent,
    ).trim();
    if (match && title && title.length <= 300 && !results.has(match[1])) {
      results.set(match[1], {
        id: match[1],
        title,
        url: sourceUrl(source, path),
      });
    }
    if (results.size >= 40) break;
  }
  if (
    results.size === 0 &&
    !/没有|未找到|暂无|无相关|0\s*(?:条|本)|搜索结果|search/i.test(
      document.body.textContent,
    )
  ) {
    throw new DiscoveryError('SOURCE_INVALID');
  }
  return [...results.values()];
}

export function parseCatalogue(
  source: NovelSource,
  snapshot: PageSnapshot,
  id: string,
): NovelCatalogue {
  const document = parseDocument(snapshot);
  const title = document.querySelector('h1')?.textContent.trim();
  if (!title) throw new DiscoveryError('SOURCE_INVALID');
  const author = firstNonEmpty(
    document.querySelector('.book-meta a[href*="/authorarticle/"]')
      ?.textContent,
    document.querySelector('h2')?.textContent,
  )
    .replace(/^作者[：:]\s*/, '')
    .split(/[、,，]插画[：:]/)[0]
    .trim();
  const volumes: NovelCatalogue['volumes'] = [];
  for (const list of document.querySelectorAll(
    '.volume-chapters, .volume-list > .volume',
  )) {
    const heading =
      list.querySelector<HTMLAnchorElement>('h2 a[href*="/vol_"]') ??
      list.querySelector<HTMLAnchorElement>('a[href*="/vol_"]');
    if (!heading) continue;
    let volumePath: string;
    try {
      volumePath = pagePath(source, heading.getAttribute('href') ?? '');
    } catch {
      continue;
    }
    const match = /^\/novel\/(\d+)\/vol_(\d+)\.html$/.exec(volumePath);
    const volumeTitle = heading.textContent.trim();
    if (match?.[1] !== id || !volumeTitle) continue;
    const chapters: NovelCatalogue['volumes'][number]['chapters'] = [];
    let unavailableChapters = 0;
    const seen = new Set<string>();
    for (const link of list.querySelectorAll<HTMLAnchorElement>(
      '.jsChapter a, .chapter-list a',
    )) {
      const chapterTitle = link.textContent.trim();
      if (!chapterTitle) continue;
      try {
        const path = pagePath(source, link.getAttribute('href') ?? '');
        const chapter = /^\/novel\/(\d+)\/(\d+)(?:_\d+)?\.html$/.exec(path);
        if (chapter?.[1] !== id) throw new DiscoveryError('SOURCE_INVALID');
        if (!seen.has(chapter[2])) {
          seen.add(chapter[2]);
          chapters.push({ id: chapter[2], title: chapterTitle, path });
        }
      } catch {
        unavailableChapters += 1;
      }
    }
    if (chapters.length > 500) throw new DiscoveryError('SOURCE_TOO_LARGE');
    let coverUrl: string | null = null;
    const cover = list.querySelector('img');
    const coverSource = firstNonEmpty(
      cover?.getAttribute('data-src'),
      cover?.getAttribute('data-original'),
      cover?.getAttribute('src'),
    );
    if (coverSource) {
      try {
        coverUrl = imageUrl(source, coverSource, snapshot.url);
      } catch {
        /* optional cover */
      }
    }
    volumes.push({
      id: match[2],
      title: volumeTitle,
      chapters,
      unavailableChapters,
      coverUrl,
      contentKind: /画集|ART\s*WORKS|\[日版\]/i.test(volumeTitle)
        ? 'other'
        : 'novel',
    });
  }
  if (volumes.length === 0 || volumes.length > 200)
    throw new DiscoveryError('SOURCE_INVALID');
  return {
    id,
    title,
    author,
    url: sourceUrl(source, `/novel/${id}.html`),
    volumes,
  };
}

export function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] ?? character,
  );
}

export function parseChapter(
  source: NovelSource,
  snapshot: PageSnapshot,
  expectedPath: string,
): ParsedChapter {
  const document = parseDocument(snapshot);
  const actual = pagePath(source, snapshot.url);
  const expected = /^\/novel\/(\d+)\/(\d+)(?:_(\d+))?\.html$/.exec(
    expectedPath,
  );
  const current = /^\/novel\/(\d+)\/(\d+)(?:_(\d+))?\.html$/.exec(actual);
  if (
    !expected ||
    expected[1] !== current?.[1] ||
    expected[2] !== current[2] ||
    Number(expected.at(3) ?? 1) !== Number(current.at(3) ?? 1)
  )
    throw new DiscoveryError('SOURCE_INVALID');
  const content = document.querySelector('#acontent, .acontent, #TextContent');
  if (!content) throw new DiscoveryError('SOURCE_ACCESS_DENIED');
  const images: string[] = [];
  const allowed = new Set([
    'p',
    'div',
    'span',
    'br',
    'h2',
    'h3',
    'h4',
    'em',
    'strong',
    'b',
    'i',
    'ruby',
    'rt',
    'rp',
    'sup',
    'sub',
    'blockquote',
  ]);
  const excluded = new Set([
    'script',
    'style',
    'iframe',
    'noscript',
    'ins',
    'form',
    'button',
    'input',
    'svg',
    'video',
    'audio',
  ]);
  let nodes = 0;
  const clean = (node: Node, depth = 0): string => {
    if (++nodes > 30_000 || depth > 60)
      throw new DiscoveryError('SOURCE_TOO_LARGE');
    if (node.nodeType === Node.TEXT_NODE)
      return escapeXml(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (
      excluded.has(tag) ||
      node.hasAttribute('hidden') ||
      node.getAttribute('aria-hidden') === 'true' ||
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
        node.getAttribute('style') ?? '',
      ) ||
      /(?:^|\s)(?:adsbygoogle|google-auto-placed|advertisement)(?:\s|$)/i.test(
        node.className,
      )
    )
      return '';
    if (tag === 'img') {
      const raw = firstNonEmpty(
        node.getAttribute('data-src'),
        node.getAttribute('data-original'),
        node.getAttribute('src'),
      );
      if (!raw) throw new DiscoveryError('SOURCE_IMAGE_FAILED');
      const url = imageUrl(source, raw, snapshot.url);
      let index = images.indexOf(url);
      if (index < 0) {
        index = images.length;
        images.push(url);
      }
      if (images.length > 100) throw new DiscoveryError('SOURCE_TOO_LARGE');
      return `<img src="image:${String(index)}" alt="${escapeXml(node.getAttribute('alt') ?? '')}" />`;
    }
    const children = [...node.childNodes]
      .map((child) => clean(child, depth + 1))
      .join('');
    if (!allowed.has(tag)) return children;
    return tag === 'br' ? '<br />' : `<${tag}>${children}</${tag}>`;
  };
  const html = [...content.childNodes].map((node) => clean(node)).join('');
  const safeContent = new DOMParser().parseFromString(html, 'text/html');
  const text = safeContent.body.textContent;
  if ((!text.trim() && images.length === 0) || /[\uE000-\uF8FF]/u.test(text))
    throw new DiscoveryError('SOURCE_INCOMPLETE');
  if (html.length > 2 * 1024 * 1024)
    throw new DiscoveryError('SOURCE_TOO_LARGE');
  let nextPath: string | null = null;
  let nextIsChapter = false;
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement>(
      '#footlink a, .footlink a, .mlfy_page a, #next_url, #pb_next, a[rel="next"]',
    ),
  ];
  const metadataNext = document
    .querySelector('meta[name="lightreader-next"]')
    ?.getAttribute('content');
  const hasNextPage = links.some((link) =>
    /下一页|下一頁|下頁|next page/i.test(link.textContent),
  );
  const candidates = [
    ...(metadataNext
      ? [{ raw: metadataNext, next: true, chapterBoundary: false }]
      : []),
    ...links.map((link) => ({
      raw: link.getAttribute('href'),
      next: /下一页|下一頁|下頁|next page/i.test(link.textContent),
      chapterBoundary: Boolean(link.closest('.mlfy_page')),
    })),
  ];
  for (const link of candidates) {
    const raw = link.raw;
    if (!raw) continue;
    let path: string;
    try {
      path = pagePath(source, raw);
    } catch {
      continue;
    }
    const candidate = /^\/novel\/(\d+)\/(\d+)(?:_(\d+))?\.html$/.exec(path);
    // This desktop footer calls both chapter and page transitions "下一页".
    // Only its validated same-book, different-chapter URL is a boundary.
    if (
      link.next &&
      link.chapterBoundary &&
      candidate?.[1] === current[1] &&
      candidate[2] !== current[2]
    )
      nextIsChapter = true;
    if (
      candidate?.[1] === current[1] &&
      candidate[2] === current[2] &&
      link.next &&
      Number(candidate.at(3) ?? 1) <= Number(current.at(3) ?? 1)
    )
      throw new DiscoveryError('SOURCE_INCOMPLETE');
    if (
      candidate?.[1] === current[1] &&
      candidate[2] === current[2] &&
      Number(candidate.at(3) ?? 1) > Number(current.at(3) ?? 1)
    ) {
      if (Number(candidate[3]) !== Number(current.at(3) ?? 1) + 1)
        throw new DiscoveryError('SOURCE_INCOMPLETE');
      nextPath = path;
      break;
    }
  }
  if (hasNextPage && !nextPath && !nextIsChapter)
    throw new DiscoveryError('SOURCE_INCOMPLETE');
  const translators = [
    ...new Set(
      [...safeContent.querySelectorAll('p, div')]
        .flatMap((node) => [
          ...node.textContent.matchAll(/译者[：:]\s*([^\n\r<>]{1,100})/g),
        ])
        .map((match) => match[1].trim()),
    ),
  ].slice(0, 20);
  return {
    title: document.querySelector('#atitle, h1')?.textContent.trim() ?? '',
    html,
    images,
    nextPath,
    translators,
  };
}

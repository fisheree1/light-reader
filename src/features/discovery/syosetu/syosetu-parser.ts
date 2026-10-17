import { z } from 'zod';

import { DiscoveryError } from '../domain/discovery-error';
import { escapeXml } from '../services/bilinovel-parser';
import {
  ncodePattern,
  VOLUME_EPISODES,
  type SyosetuEpisode,
  type SyosetuEpisodeContent,
  type SyosetuSearchResult,
  type SyosetuVolume,
} from './syosetu';

const apiWorkSchema = z.object({
  ncode: z.string(),
  title: z.string(),
  writer: z.string().default(''),
  story: z.string().default(''),
  general_all_no: z.number().int().nonnegative().default(0),
  noveltype: z.number().int(),
  end: z.number().int(),
  general_lastup: z.string().nullable().default(null),
});

/** The API's JSON: a count object followed by the matching works. */
export function parseSearch(text: string): SyosetuSearchResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DiscoveryError('SOURCE_INVALID');
  }
  if (!Array.isArray(data) || data.length === 0)
    throw new DiscoveryError('SOURCE_INVALID');
  const [head, ...items] = data as unknown[];
  const total = z.object({ allcount: z.number() }).safeParse(head);
  if (!total.success) throw new DiscoveryError('SOURCE_INVALID');
  return {
    total: total.data.allcount,
    works: items.flatMap((item) => {
      const parsed = apiWorkSchema.safeParse(item);
      if (!parsed.success) return [];
      const work = parsed.data;
      const ncode = work.ncode.toLowerCase();
      if (!ncodePattern.test(ncode)) return [];
      return [
        {
          ncode,
          title: work.title.trim().slice(0, 300),
          author: work.writer.trim().slice(0, 100),
          story: work.story.trim().slice(0, 1000),
          episodes: work.general_all_no,
          short: work.noveltype === 2,
          // The API reports 0 for finished works and short stories.
          ended: work.end === 0,
          updatedAt: work.general_lastup,
        },
      ];
    }),
  };
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export type TocItem =
  { kind: 'section'; title: string } | ({ kind: 'episode' } & SyosetuEpisode);

export interface TocPage {
  title: string;
  author: string;
  summary: string;
  short: boolean;
  lastPage: number;
  items: TocItem[];
}

/** One table-of-contents page (100 episodes) of `ncode`. */
export function parseTocPage(html: string, ncode: string): TocPage {
  const document = parseHtml(html);
  const title = text(document.querySelector('.p-novel__title'));
  if (!title) throw new DiscoveryError('SOURCE_INVALID');
  const author = text(document.querySelector('.p-novel__author')).replace(
    /^作者[：:]\s*/,
    '',
  );
  const summary = text(
    document.querySelector('#novel_ex, .p-novel__summary'),
  ).slice(0, 2000);
  const list = document.querySelector('.p-eplist');
  if (!list) {
    // A short story has no episode list; its text is on this page.
    if (!document.querySelector('.p-novel__body .js-novel-text'))
      throw new DiscoveryError('SOURCE_INVALID');
    return {
      title,
      author,
      summary,
      short: true,
      lastPage: 1,
      items: [{ kind: 'episode', number: 0, title }],
    };
  }
  const items: TocItem[] = [];
  for (const child of Array.from(list.children)) {
    if (child.classList.contains('p-eplist__chapter-title')) {
      const sectionTitle = text(child);
      if (sectionTitle) items.push({ kind: 'section', title: sectionTitle });
      continue;
    }
    const link = child.querySelector<HTMLAnchorElement>('a.p-eplist__subtitle');
    const match = new RegExp(`^/${ncode}/(\\d{1,5})/$`).exec(
      link?.getAttribute('href') ?? '',
    );
    if (!link || !match) continue;
    items.push({
      kind: 'episode',
      number: Number(match[1]),
      title: text(link).slice(0, 300) || `#${match[1]}`,
    });
  }
  const last = /[?&]p=(\d{1,4})$/.exec(
    document.querySelector('.c-pager__item--last')?.getAttribute('href') ?? '',
  );
  return {
    title,
    author,
    summary,
    short: false,
    lastPage: last ? Number(last[1]) : 1,
    items,
  };
}

function rangeTitle(episodes: SyosetuEpisode[]): string {
  const first = episodes[0]?.number ?? 0;
  const last = episodes.at(-1)?.number ?? first;
  return `第${String(first)}–${String(last)}話`;
}

/**
 * Groups episodes into volumes: one per 部, with long ones (and works without
 * sections) split every `VOLUME_EPISODES` episodes.
 */
export function groupVolumes(
  items: readonly TocItem[],
  workTitle: string,
): SyosetuVolume[] {
  const sections: { title: string | null; episodes: SyosetuEpisode[] }[] = [];
  for (const item of items) {
    if (item.kind === 'section') {
      sections.push({ title: item.title, episodes: [] });
      continue;
    }
    let current = sections.at(-1);
    if (!current) {
      current = { title: null, episodes: [] };
      sections.push(current);
    }
    current.episodes.push({ number: item.number, title: item.title });
  }
  const filled = sections.filter((section) => section.episodes.length);
  const volumes = filled.flatMap((section) => {
    const parts: SyosetuEpisode[][] = [];
    for (
      let start = 0;
      start < section.episodes.length;
      start += VOLUME_EPISODES
    )
      parts.push(section.episodes.slice(start, start + VOLUME_EPISODES));
    return parts.map((episodes) => ({
      id: String(episodes[0]?.number ?? 0),
      title:
        episodes.length === 1 && episodes[0]?.number === 0
          ? workTitle
          : section.title
            ? parts.length > 1
              ? `${section.title}（${rangeTitle(episodes)}）`
              : section.title
            : rangeTitle(episodes),
      episodes,
    }));
  });
  // A short work without sections is one volume named after the work.
  if (volumes.length === 1 && filled[0]?.title === null)
    volumes[0].title = workTitle;
  return volumes;
}

const kept = new Set(['ruby', 'rb', 'rt', 'rp', 'em', 'strong', 'b', 'i']);

/** The みてみん address episode pages embed for an illustration. */
const illustrationPattern =
  /^https:\/\/\d{1,10}\.mitemin\.net\/userpageimage\/viewimagebig\/icode\/i\d{1,12}\/$/;
const MAX_EPISODE_IMAGES = 50;

interface CleanContext {
  nodes: number;
  images: string[];
}

/** An absolute address for a (possibly protocol-relative) image source. */
function imageAddress(source: string): string | null {
  try {
    // Pages embed protocol-relative addresses (`//47160.mitemin.net/…`).
    return new URL(source, 'https://ncode.syosetu.com/').href;
  } catch {
    return null;
  }
}

function illustration(element: Element, context: CleanContext): string {
  const url = imageAddress(element.getAttribute('src') ?? '');
  if (!url || !illustrationPattern.test(url)) return '［挿絵］';
  let index = context.images.indexOf(url);
  if (index < 0) {
    if (context.images.length >= MAX_EPISODE_IMAGES) return '［挿絵］';
    index = context.images.length;
    context.images.push(url);
  }
  return `<img src="image:${String(index)}" alt="挿絵" />`;
}

function clean(node: Node, budget: CleanContext): string {
  if (++budget.nodes > 50_000) throw new DiscoveryError('SOURCE_TOO_LARGE');
  if (node.nodeType === Node.TEXT_NODE)
    return escapeXml(node.textContent ?? '');
  if (!(node instanceof Element)) return '';
  const tag = node.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return '';
  if (tag === 'img') return illustration(node, budget);
  if (tag === 'br') return '<br />';
  const inner = Array.from(node.childNodes)
    .map((child) => clean(child, budget))
    .join('');
  return kept.has(tag) ? `<${tag}>${inner}</${tag}>` : inner;
}

function paragraphs(block: Element, budget: CleanContext): string {
  return Array.from(block.querySelectorAll(':scope > p'))
    .map((paragraph) => {
      const inner = clean(paragraph, budget);
      // The site marks blank lines as <p><br /></p>.
      return inner.replace(/<br \/>/g, '').trim()
        ? `<p>${inner}</p>`
        : '<p class="blank"><br /></p>';
    })
    .join('');
}

/** An episode page, checked against the episode that was requested. */
export function parseEpisode(
  html: string,
  ncode: string,
  number: number,
): SyosetuEpisodeContent {
  const document = parseHtml(html);
  const body = document.querySelector('.p-novel__body');
  if (!body) throw new DiscoveryError('SOURCE_INVALID');
  if (number > 0) {
    const position = /^(\d+)\s*\/\s*\d+$/.exec(
      text(document.querySelector('.p-novel__number')),
    );
    if (position && Number(position[1]) !== number)
      throw new DiscoveryError('SOURCE_INVALID');
  }
  const budget: CleanContext = { nodes: 0, images: [] };
  const blocks = Array.from(body.querySelectorAll(':scope > .js-novel-text'));
  const main = blocks.find(
    (block) =>
      !block.classList.contains('p-novel__text--preface') &&
      !block.classList.contains('p-novel__text--afterword'),
  );
  if (!main) throw new DiscoveryError('SOURCE_INCOMPLETE');
  const note = (kind: 'preface' | 'afterword') => {
    const block = blocks.find((item) =>
      item.classList.contains(`p-novel__text--${kind}`),
    );
    return block
      ? `<div class="${kind}">${paragraphs(block, budget)}</div>`
      : '';
  };
  const content = paragraphs(main, budget);
  if (!content) throw new DiscoveryError('SOURCE_INCOMPLETE');
  const result = `${note('preface')}${content}${note('afterword')}`;
  if (result.length > 2 * 1024 * 1024)
    throw new DiscoveryError('SOURCE_TOO_LARGE');
  return {
    title:
      text(document.querySelector('.p-novel__title')).slice(0, 300) ||
      `${ncode} #${String(number)}`,
    html: result,
    images: budget.images,
  };
}

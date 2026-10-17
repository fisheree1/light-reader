import { z } from 'zod';

import type { BookOrigin } from './book-origin';
import { readingStatus } from './reading-status';

/** A book's place in a series; `index` orders volumes and may be fractional. */
export const bookSeriesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  index: z.number().min(0).max(100000).nullable(),
});

export type BookSeries = z.infer<typeof bookSeriesSchema>;

interface SeriesBook {
  id: string;
  title: string;
  metadata: { series?: BookSeries | null; origin?: BookOrigin };
}

export interface SeriesGroup<T extends SeriesBook> {
  kind: 'series';
  key: string;
  title: string;
  books: T[];
}

export type LibraryEntry<T extends SeriesBook> =
  { kind: 'book'; book: T } | SeriesGroup<T>;

/** Parses a series position such as "3", "2.5" or "３"; anything else is null. */
export function parseSeriesIndex(
  value: string | null | undefined,
): number | null {
  const text = (value ?? '').normalize('NFKC').trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(text)) return null;
  const index = Number(text);
  return index <= 100000 ? index : null;
}

/** Series names match ignoring width, case, punctuation and spacing. */
export function seriesKey(title: string): string {
  return `title:${title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}]+/gu, '')}`;
}

const volumeSuffix =
  /[\s\p{P}]*(?:第\s*[\d一二三四五六七八九十百零〇两]+\s*[卷部集册巻]|vol(?:ume)?\.?\s*\d+|[上中下]卷)[\s\S]*$/iu;

/** The work title from a volume title such as "作品名 第三卷 副标题". */
export function seriesTitleFromVolume(title: string): string {
  const stripped = title.replace(volumeSuffix, '').trim();
  return stripped || title;
}

function originKey(origin: BookOrigin): string {
  return `origin:${origin.source}:${origin.novelId}`;
}

function compareVolumes(left: SeriesBook, right: SeriesBook): number {
  const leftIndex = left.metadata.series?.index ?? null;
  const rightIndex = right.metadata.series?.index ?? null;
  if (leftIndex !== rightIndex) {
    if (leftIndex === null) return 1;
    if (rightIndex === null) return -1;
    return leftIndex - rightIndex;
  }
  const leftVolume = Number(left.metadata.origin?.volumeId ?? NaN);
  const rightVolume = Number(right.metadata.origin?.volumeId ?? NaN);
  if (
    Number.isFinite(leftVolume) &&
    Number.isFinite(rightVolume) &&
    leftVolume !== rightVolume
  )
    return leftVolume - rightVolume;
  return left.title.localeCompare(right.title, undefined, { numeric: true });
}

/**
 * Groups books of the same series, keeping the order of `books` for where each
 * series appears (at its first member). A book's own series wins; volumes
 * fetched from the same online work that predate series metadata join that
 * work's series.
 * A series with a single book on the shelf stays a plain book.
 */
export function groupBySeries<T extends SeriesBook>(
  books: readonly T[],
): LibraryEntry<T>[] {
  const keyForOrigin = new Map<string, { key: string; title: string }>();
  for (const book of books) {
    const { series, origin } = book.metadata;
    if (series && origin && !keyForOrigin.has(originKey(origin)))
      keyForOrigin.set(originKey(origin), {
        key: seriesKey(series.title),
        title: series.title,
      });
  }
  const identify = (book: T) => {
    const { series, origin } = book.metadata;
    if (series) return { key: seriesKey(series.title), title: series.title };
    // `null` means no series (a file without one, or removed by the user);
    // only books saved before series existed fall back to their origin.
    if (series === null || !origin) return null;
    return (
      keyForOrigin.get(originKey(origin)) ?? {
        key: originKey(origin),
        title: seriesTitleFromVolume(book.title),
      }
    );
  };

  const groups = new Map<string, SeriesGroup<T>>();
  const order: (T | SeriesGroup<T>)[] = [];
  for (const book of books) {
    const identity = identify(book);
    if (!identity) {
      order.push(book);
      continue;
    }
    let group = groups.get(identity.key);
    if (!group) {
      group = {
        kind: 'series',
        key: identity.key,
        title: identity.title,
        books: [],
      };
      groups.set(identity.key, group);
      order.push(group);
    }
    group.books.push(book);
  }
  return order.map((item) => {
    if (!('kind' in item)) return { kind: 'book', book: item };
    if (item.books.length === 1) return { kind: 'book', book: item.books[0] };
    return { ...item, books: [...item.books].sort(compareVolumes) };
  });
}

/**
 * The volume to continue: the one read most recently, or the next unfinished
 * volume after it once it is finished; the first volume when none was read.
 * `books` must be in series order.
 */
export function continueVolume<
  T extends { lastReadAt: number | null; progress: number | null },
>(books: readonly T[]): T | null {
  let latest = -1;
  books.forEach((book, index) => {
    const at = book.lastReadAt;
    if (at !== null && at > (books[latest]?.lastReadAt ?? -1)) latest = index;
  });
  if (latest === -1) return books.at(0) ?? null;
  const current = books[latest];
  if (readingStatus(current) !== 'finished') return current;
  return (
    books
      .slice(latest + 1)
      .find((book) => readingStatus(book) !== 'finished') ?? current
  );
}

/**
 * The discovery page for the online work a series was fetched from, where new
 * volumes can be checked. Null when no volume came from a light-novel source.
 */
export function seriesUpdateLink(
  books: readonly { metadata: { origin?: BookOrigin } }[],
): string | null {
  const origin = books.find((book) => book.metadata.origin)?.metadata.origin;
  if (!origin) return null;
  const query = new URLSearchParams({
    source: origin.source,
    novel: origin.novelId,
  });
  return `/discover?${query.toString()}`;
}

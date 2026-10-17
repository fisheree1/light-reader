import { z } from 'zod';

import { DiscoveryError } from '../domain/discovery-error';

/** A light-novel work from a Bangumi search. */
export interface BangumiCandidate {
  id: number;
  /** Original (usually Japanese) title. */
  name: string;
  nameCn: string | null;
  /** A whole series rather than a single volume. */
  series: boolean;
  author: string | null;
  label: string | null;
  date: string | null;
}

/** An official Chinese edition recorded on Bangumi (e.g. `版本:东立版`). */
export interface ChineseEdition {
  label: string;
  title: string | null;
  language: '简体中文' | '繁体中文';
  publisher: string | null;
  producer: string | null;
  translators: string | null;
  date: string | null;
  volumes: string | null;
}

export interface TranslationInfo {
  id: number;
  name: string;
  nameCn: string | null;
  author: string | null;
  label: string | null;
  /** Chinese titles to search the sources with, most likely first. */
  chineseNames: string[];
  editions: ChineseEdition[];
  url: string;
}

const textValue = z.union([
  z.string(),
  z.array(z.object({ k: z.string().optional(), v: z.string() })),
]);
const infoboxSchema = z
  .array(z.object({ key: z.string(), value: textValue }))
  .catch([]);
const subjectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  name_cn: z.string().default(''),
  platform: z.string().default(''),
  series: z.boolean().default(false),
  nsfw: z.boolean().default(false),
  date: z.string().nullable().default(null),
  infobox: infoboxSchema.default([]),
});

type Subject = z.infer<typeof subjectSchema>;
type Infobox = z.infer<typeof infoboxSchema>;

const MAX_NAMES = 6;
const cjk = /[\p{Script=Han}]/u;
const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new DiscoveryError('SOURCE_INVALID');
  }
}

/** All string values of an infobox entry, plain or `{ k, v }` lists. */
function values(infobox: Infobox, key: string): string[] {
  return infobox
    .filter((item) => item.key === key)
    .flatMap((item) =>
      typeof item.value === 'string'
        ? [item.value]
        : item.value.map((entry) => entry.v),
    )
    .map((value) => value.trim())
    .filter(Boolean);
}

function first(infobox: Infobox, key: string): string | null {
  return values(infobox, key)[0] ?? null;
}

/** A light novel: Bangumi's book platform "小说", never adult content. */
function isNovel(subject: Subject): boolean {
  return subject.platform === '小说' && !subject.nsfw;
}

function candidate(subject: Subject): BangumiCandidate {
  return {
    id: subject.id,
    name: subject.name.trim(),
    nameCn: subject.name_cn.trim() || null,
    series: subject.series,
    author: first(subject.infobox, '作者'),
    label: first(subject.infobox, '文库'),
    date: subject.date,
  };
}

/**
 * Light-novel works for a search, series entries first; single volumes of a
 * series also listed are dropped when the series itself is present.
 */
export function parseBangumiSearch(text: string): BangumiCandidate[] {
  const data = z
    .object({ data: z.array(z.unknown()).default([]) })
    .safeParse(parseJson(text));
  if (!data.success) throw new DiscoveryError('SOURCE_INVALID');
  const subjects = data.data.data.flatMap((item) => {
    const parsed = subjectSchema.safeParse(item);
    return parsed.success && isNovel(parsed.data) ? [parsed.data] : [];
  });
  // Volume titles often differ from the series only in width (! vs ！).
  const comparable = (name: string) =>
    name.normalize('NFKC').replace(/\s+/g, '');
  const seriesNames = subjects
    .filter((item) => item.series)
    .map((item) => comparable(item.name));
  return subjects
    .filter(
      (item) =>
        item.series ||
        !seriesNames.some((name) => comparable(item.name).startsWith(name)),
    )
    .map(candidate)
    .sort((left, right) => Number(right.series) - Number(left.series));
}

function edition(label: string, entries: { k?: string; v: string }[]) {
  const field = (key: string) => {
    // Empty strings count as missing.
    const value = entries.find((entry) => entry.k === key)?.v.trim() ?? '';
    return value.length > 0 ? value : null;
  };
  const language = field('语言');
  if (language !== '简体中文' && language !== '繁体中文') return null;
  return {
    label,
    title: field('版本名'),
    language,
    publisher: field('出版社'),
    producer: field('出品方'),
    translators: field('译者'),
    date: field('发售日'),
    volumes: field('册数'),
    aliases: entries
      .filter((entry) => entry.k === '别名')
      .map((entry) => entry.v.trim()),
  } satisfies ChineseEdition & { aliases: string[] };
}

/** Chinese titles, official editions and aliases for one subject. */
export function parseBangumiSubject(text: string): TranslationInfo {
  const parsed = subjectSchema.safeParse(parseJson(text));
  if (!parsed.success) throw new DiscoveryError('SOURCE_INVALID');
  const subject = parsed.data;
  if (subject.nsfw) throw new DiscoveryError('SOURCE_INVALID');
  const editions = subject.infobox.flatMap((item) => {
    if (!item.key.startsWith('版本:') || typeof item.value === 'string')
      return [];
    const found = edition(item.key.slice(3).trim(), item.value);
    return found ? [found] : [];
  });
  // Official edition titles first: those are what translations go by.
  const names = [
    ...editions.flatMap((item) => [item.title, ...item.aliases]),
    subject.name_cn,
    ...values(subject.infobox, '中文名'),
    ...values(subject.infobox, '别名'),
  ]
    .map((name) => name?.trim() ?? '')
    // Chinese names only: Han characters and no kana.
    .filter((name) => name && cjk.test(name) && !kana.test(name));
  return {
    id: subject.id,
    name: subject.name.trim(),
    nameCn: subject.name_cn.trim() || null,
    author: first(subject.infobox, '作者'),
    label: first(subject.infobox, '文库'),
    chineseNames: [...new Set(names)].slice(0, MAX_NAMES),
    editions: editions.map((item) => ({
      label: item.label,
      title: item.title,
      language: item.language,
      publisher: item.publisher,
      producer: item.producer,
      translators: item.translators,
      date: item.date,
      volumes: item.volumes,
    })),
    url: `https://bgm.tv/subject/${String(subject.id)}`,
  };
}

/**
 * Distinct titles to search the sources with. The sources' search already
 * tries the other script, so names differing only in script collapse into
 * their simplified form.
 */
export function searchNames(
  names: readonly string[],
  toSimplified: (value: string) => string,
  limit = 3,
): string[] {
  return [...new Set(names.map((name) => toSimplified(name)))].slice(0, limit);
}

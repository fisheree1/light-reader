import { toSimplified } from './chinese-script';

export type VolumeKind = 'main' | 'side-story' | 'collection' | 'unknown';
export type TranslationMethod = 'human' | 'machine' | 'mixed' | 'unknown';

/**
 * Classifies a volume from its title. Order matters: a "短篇集" is a
 * collection, not a side story, and "第8.5卷" is still a main volume.
 */
export function classifyVolumeKind(title: string): VolumeKind {
  const value = toSimplified(title.normalize('NFKC'));
  if (/短篇集|合集|精选集|作品集/.test(value)) return 'collection';
  if (/外传|番外|短篇|特典|附录|后记|\bSS\b/i.test(value)) return 'side-story';
  if (
    /第\s*[\d零一二三四五六七八九十百〇两]+(?:\.\d+)?\s*[卷集册部]|\bvol(?:ume)?\.?\s*\d|卷\s*\d|^\s*\d+(?:\.\d+)?\s*$/i.test(
      value,
    )
  )
    return 'main';
  return 'unknown';
}

const editionLabels: [RegExp, string][] = [
  [/文库版/, '文库版'],
  [/web\s*版|网络版|网路版/i, 'Web 版'],
  [/新装版/, '新装版'],
  [/重制版/, '重制版'],
  [/修订版/, '修订版'],
  [/完全版/, '完全版'],
  [/单行本/, '单行本'],
];

/** An explicit edition label in the title, normalized to simplified text. */
export function detectEdition(title: string): string | null {
  const value = toSimplified(title.normalize('NFKC'));
  return editionLabels.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

// A declaration line such as "译者：某某（机翻）" or "翻译方式：人工翻译".
const declarationLine =
  /(?:^|\n)\s*(?:译者|翻译|翻译方式|译本|来源)\s*[：:][^\n]*/g;

/**
 * The translation method stated in declaration lines. Wording elsewhere in
 * the text is never used: without an explicit statement the result is
 * `unknown`, not a guess.
 */
export function detectTranslationMethod(text: string): TranslationMethod {
  const declarations = toSimplified(text).match(declarationLine) ?? [];
  let machine = false;
  let human = false;
  for (const line of declarations) {
    if (/机翻|机器翻译|AI\s*翻译|自动翻译/i.test(line)) machine = true;
    if (/人工翻译|人工翻|手翻|人工校对后?发布/.test(line)) human = true;
  }
  if (machine && human) return 'mixed';
  if (machine) return 'machine';
  if (human) return 'human';
  return 'unknown';
}

/** Combines methods from several pages; disagreeing statements are mixed. */
export function combineTranslationMethods(
  methods: readonly TranslationMethod[],
): TranslationMethod {
  const known = new Set(methods.filter((method) => method !== 'unknown'));
  if (known.size === 0) return 'unknown';
  if (known.size > 1 || known.has('mixed')) return 'mixed';
  return [...known][0];
}

/** Translator names from "译者：…" / "譯者：…" declaration lines. */
export function extractTranslators(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/[译譯]者\s*[：:]\s*([^\n\r<>（(]{1,100})/g)].map(
        (match) => match[1].trim(),
      ),
    ),
  ]
    .filter(Boolean)
    .slice(0, 20);
}
